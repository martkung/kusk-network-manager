import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const PROJECT_ID = "kusk-network-manager";
const STORAGE_BUCKET = "kusk-network-manager.firebasestorage.app";
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const sourceBackupPath = process.env.MIGRATION_SOURCE_BACKUP;

if (!credentialPath) {
  throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required");
}

const resolvedCredentialPath = resolve(credentialPath);
const serviceAccount = JSON.parse(readFileSync(resolvedCredentialPath, "utf8"));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID,
  storageBucket: STORAGE_BUCKET
});

const db = getFirestore(app);
const bucket = getStorage(app).bucket();
const sensitiveFields = ["ip", "mac", "serialNumber", "configUrl"];
const networkLinks = {
  zyxel: "https://nebula.zyxel.com/",
  unifi: "https://10.60.23.8:8443/manage/account/login?redirect=%2Fmanage",
  cambium: "https://cloud.cambiumnetworks.com/#/",
  cisco: "https://10.60.23.188/",
  tplink: "https://omada.tplinkcloud.com"
};

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sourceStoragePath(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  if (value.startsWith("device-images/")) {
    return value;
  }

  try {
    const url = new URL(value);

    if (url.hostname === "firebasestorage.googleapis.com") {
      const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      return match && decodeURIComponent(match[1]) === STORAGE_BUCKET
        ? decodeURIComponent(match[2])
        : "";
    }

    if (url.hostname === "storage.googleapis.com") {
      const prefix = `/${STORAGE_BUCKET}/`;
      return url.pathname.startsWith(prefix)
        ? decodeURIComponent(url.pathname.slice(prefix.length))
        : "";
    }

    if (url.hostname === `${STORAGE_BUCKET}.storage.googleapis.com`) {
      return decodeURIComponent(url.pathname.slice(1));
    }
  } catch {
    return "";
  }

  return "";
}

function imageDescriptor(value, deviceId) {
  const sourcePath = sourceStoragePath(value);
  const nestedPrefix = `device-images/${deviceId}/`;
  const legacyPrefix = `device-images/${deviceId}_`;
  let targetPath = "";

  if (sourcePath.startsWith(nestedPrefix)) {
    const imageId = sourcePath.slice(nestedPrefix.length);
    if (imageId && !imageId.includes("/")) {
      targetPath = sourcePath;
    }
  } else if (sourcePath.startsWith(legacyPrefix)) {
    const fileName = sourcePath.slice("device-images/".length);
    if (fileName && !fileName.includes("/")) {
      targetPath = `${nestedPrefix}${fileName}`;
    }
  }

  return targetPath ? { sourcePath, targetPath } : null;
}

function sourceImages(data) {
  return [
    data.mainImage,
    ...(Array.isArray(data.galleryImages) ? data.galleryImages : [])
  ];
}

function publicSwitchData(data, deviceId, protectedTargets) {
  const targetFor = (value) => {
    const descriptor = imageDescriptor(value, deviceId);
    return descriptor && protectedTargets.has(descriptor.targetPath)
      ? descriptor.targetPath
      : "";
  };
  const galleryImages = Array.isArray(data.galleryImages)
    ? [...new Set(data.galleryImages.map(targetFor).filter(Boolean))].slice(0, 20)
    : [];
  const mainImage = targetFor(data.mainImage);

  return {
    name: asString(data.name) || deviceId,
    brand: asString(data.brand),
    model: asString(data.model),
    location: asString(data.location),
    status: data.status === "online" ? "online" : "offline",
    lastSeen: typeof data.lastSeen === "string" ||
      data.lastSeen instanceof Timestamp
      ? data.lastSeen
      : new Date().toISOString(),
    mainImage: mainImage || galleryImages[0] || "",
    galleryImages
  };
}

function privateSwitchData(publicData, existingPrivate, deviceId) {
  const source = {
    ...existingPrivate,
    ...Object.fromEntries(sensitiveFields
      .filter((field) => typeof publicData[field] === "string")
      .map((field) => [field, publicData[field]]))
  };
  const ip = asString(source.ip);

  if (!ip) {
    throw new Error(`Switch ${deviceId} has no IP address`);
  }

  return {
    ip,
    mac: asString(source.mac).replaceAll("-", ":").toUpperCase(),
    serialNumber: asString(source.serialNumber),
    configUrl: `http://${ip}`
  };
}

async function createBackup(publicSnapshot, privateSnapshot) {
  const backupDirectory = join(dirname(resolvedCredentialPath), "backups");
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = join(backupDirectory, `switch-data-before-split-${timestamp}.json`);

  await mkdir(backupDirectory, { recursive: true });
  await writeFile(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    switches: publicSnapshot.docs.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.data()
    })),
    switchPrivate: privateSnapshot.docs.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.data()
    }))
  }, null, 2), { encoding: "utf8", mode: 0o600 });

  return backupPath;
}

function sourceDataById(publicSnapshot) {
  if (!sourceBackupPath) {
    return new Map(publicSnapshot.docs.map((snapshot) => [
      snapshot.id,
      snapshot.data()
    ]));
  }

  const backup = JSON.parse(readFileSync(resolve(sourceBackupPath), "utf8"));

  if (backup.projectId !== PROJECT_ID || !Array.isArray(backup.switches)) {
    throw new Error("The migration source backup is invalid");
  }

  return new Map(backup.switches.map((entry) => [entry.id, entry.data]));
}

async function protectImage({ sourcePath, targetPath }) {
  const sourceFile = bucket.file(sourcePath);
  const targetFile = bucket.file(targetPath);

  if (sourcePath !== targetPath) {
    const [targetExists] = await targetFile.exists();
    if (!targetExists) {
      await sourceFile.copy(targetFile);
    }
  }

  await targetFile.setMetadata({
    metadata: {
      firebaseStorageDownloadTokens: null
    }
  });
}

async function protectImages(descriptors) {
  const protectedTargets = new Set();

  for (let start = 0; start < descriptors.length; start += 20) {
    const chunk = descriptors.slice(start, start + 20);
    const results = await Promise.allSettled(chunk.map(protectImage));

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        protectedTargets.add(chunk[index].targetPath);
      }
    });

    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new Error(`${failures.length} image files could not be protected`);
    }
  }

  return protectedTargets;
}

async function removeLegacyImages(descriptors) {
  const legacyPaths = [...new Set(descriptors
    .filter(({ sourcePath, targetPath }) => sourcePath !== targetPath)
    .map(({ sourcePath }) => sourcePath))];
  const results = await Promise.allSettled(legacyPaths.map((path) => (
    bucket.file(path).delete({ ignoreNotFound: true })
  )));

  return results.filter((result) => result.status === "rejected").length;
}

async function migrate() {
  const [publicSnapshot, privateSnapshot] = await Promise.all([
    db.collection("switches").get(),
    db.collection("switchPrivate").get()
  ]);
  const sourceData = sourceDataById(publicSnapshot);
  const existingPrivate = new Map(privateSnapshot.docs.map((snapshot) => [
    snapshot.id,
    snapshot.data()
  ]));
  const backupPath = await createBackup(publicSnapshot, privateSnapshot);
  const descriptorMap = new Map();

  publicSnapshot.docs.forEach((snapshot) => {
    const original = sourceData.get(snapshot.id) || snapshot.data();
    sourceImages(original).forEach((value) => {
      const descriptor = imageDescriptor(value, snapshot.id);
      if (descriptor) {
        descriptorMap.set(descriptor.targetPath, descriptor);
      }
    });
  });

  const descriptors = [...descriptorMap.values()];
  const protectedTargets = await protectImages(descriptors);
  const batch = db.batch();

  for (const snapshot of publicSnapshot.docs) {
    const original = sourceData.get(snapshot.id) || snapshot.data();
    const publicData = publicSwitchData(original, snapshot.id, protectedTargets);
    const privateData = privateSwitchData(
      original,
      existingPrivate.get(snapshot.id) || {},
      snapshot.id
    );

    batch.set(snapshot.ref, publicData);
    batch.set(
      db.collection("publicSwitches").doc(snapshot.id),
      {
        brand: publicData.brand,
        model: publicData.model,
        status: publicData.status,
        lastSeen: publicData.lastSeen
      }
    );
    batch.set(db.collection("switchPrivate").doc(snapshot.id), privateData);
  }

  Object.entries(networkLinks).forEach(([id, url]) => {
    batch.set(db.collection("networkLinks").doc(id), { url });
  });

  await batch.commit();
  const legacyDeleteFailures = await removeLegacyImages(descriptors);

  const [verifiedPublic, verifiedPrivate] = await Promise.all([
    db.collection("switches").get(),
    db.collection("switchPrivate").get()
  ]);
  const publicSensitiveCount = verifiedPublic.docs.filter((snapshot) => (
    sensitiveFields.some((field) => field in snapshot.data())
  )).length;
  const publicUrlImageCount = verifiedPublic.docs.filter((snapshot) => {
    const data = snapshot.data();
    return sourceImages(data)
      .some((value) => typeof value === "string" && /^https?:\/\//.test(value));
  }).length;
  const protectedReferenceCount = verifiedPublic.docs.reduce((count, snapshot) => {
    return count + sourceImages(snapshot.data()).filter(Boolean).length;
  }, 0);

  if (
    publicSensitiveCount !== 0 ||
    publicUrlImageCount !== 0 ||
    verifiedPrivate.size !== verifiedPublic.size ||
    (descriptors.length > 0 && protectedReferenceCount === 0)
  ) {
    throw new Error("Migration verification failed");
  }

  console.log(`Backup created outside the project: ${backupPath}`);
  console.log(`Migrated ${verifiedPublic.size} switches into public and private data`);
  console.log(`Protected ${protectedTargets.size} image objects`);

  if (legacyDeleteFailures) {
    console.warn(`${legacyDeleteFailures} legacy image objects could not be removed`);
  }
}

try {
  await migrate();
} finally {
  await deleteApp(app);
}
