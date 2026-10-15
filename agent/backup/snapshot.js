import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, readdir, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { canonical, decryptFile, encryptFile, keyId, readManifest, sha256, verifyFile } from "./crypto.js";

export const FORMAT = "kusk-network-backup-v1";

export function outside(candidate, forbidden) {
  const relative = path.relative(path.resolve(forbidden), path.resolve(candidate));
  return relative !== "" && (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative));
}

function objectPath(root, object) {
  if (!/^objects\/[a-f0-9]{64}-[a-f0-9]{16}\.nmbak$/.test(object.blob || "")) {
    throw new Error("Invalid backup object path");
  }
  return path.join(root, ...object.blob.split("/"));
}

export function validateManifest(manifest) {
  if (manifest.format !== FORMAT || !/^[a-z0-9-]+$/.test(manifest.projectId || "") ||
    !Array.isArray(manifest.documents) || !Array.isArray(manifest.objects) || !manifest.configuration ||
    !Number.isFinite(Date.parse(manifest.readTime))) { throw new Error("Invalid backup manifest"); }
  const documentIds = new Set();
  for (const document of manifest.documents) {
    const segments = typeof document.path === "string" ? document.path.split("/") : [];
    if (!segments.length || segments.length % 2 || segments.some((part) => !part || [".", ".."].includes(part)) ||
      documentIds.has(document.path) || !document.fields || typeof document.fields !== "object" || Array.isArray(document.fields)) {
      throw new Error("Invalid or duplicate backup document");
    }
    documentIds.add(document.path);
  }
  const names = new Set();
  for (const object of manifest.objects) {
    objectPath(".", object);
    if (typeof object.name !== "string" || !object.name || names.has(object.name) ||
      !Number.isSafeInteger(object.size) || object.size < 0 || !/^[a-f0-9]{64}$/.test(object.sha256 || "")) {
      throw new Error("Invalid or duplicate backup object");
    }
    names.add(object.name);
  }
  for (const document of manifest.documents) {
    function checkImages(fields) {
      for (const [name, value] of Object.entries(fields)) {
        if (name === "mainImage" && value.stringValue && !names.has(value.stringValue)) { throw new Error("A referenced image is missing from Storage"); }
        if (name === "galleryImages") {
          for (const image of value.arrayValue?.values || []) {
            if (image.stringValue && !names.has(image.stringValue)) { throw new Error("A gallery image is missing from Storage"); }
          }
        }
        if (value.mapValue?.fields) { checkImages(value.mapValue.fields); }
      }
    }
    checkImages(document.fields);
  }
}

export async function verifySnapshot(file, key) {
  const root = await realpath(path.dirname(file));
  const manifest = await readManifest(file, key);
  validateManifest(manifest);
  for (const object of manifest.objects) {
    const candidate = objectPath(root, object);
    const resolved = await realpath(candidate);
    if (outside(resolved, root)) { throw new Error("Backup object escaped its directory"); }
    await verifyFile(resolved, key, object);
  }
  return manifest;
}

export async function createSnapshot({ directory, key, projectId, bucket, firestore, configuration, onProgress = () => {} }) {
  await access(directory);
  const root = await realpath(directory);
  await mkdir(path.join(root, "objects"), { recursive: true });
  if (outside(await realpath(path.join(root, "objects")), root)) { throw new Error("Backup objects directory escaped its root"); }
  const candidates = (await readdir(root)).filter((name) => /^snapshot-[0-9TZ-]+-[a-f0-9]{16}\.nmbak$/.test(name)).sort().reverse();
  let previous;
  for (const candidate of candidates) {
    try {
      const value = await readManifest(path.join(root, candidate), key);
      validateManifest(value);
      if (value.projectId === projectId && value.bucket === bucket.name && value.keyId === keyId(key)) { previous = value; break; }
    } catch { onProgress("Previous snapshot could not be reused; preparing a fresh copy"); }
  }
  onProgress("Reading a consistent database snapshot");
  const database = await firestore.snapshot();
  const objects = [];
  const [files] = await bucket.getFiles();
  const previousObjects = new Map((previous?.objects || []).map((object) => [object.name + ":" + object.generation, object]));
  let copied = 0;
  let reused = 0;
  for (const file of files) {
    const metadata = file.metadata;
    const size = Number(metadata.size);
    if (!metadata.generation || !Number.isSafeInteger(size) || size < 0) { throw new Error("Invalid Storage metadata"); }
    const prior = previousObjects.get(file.name + ":" + metadata.generation);
    let object;
    if (prior && prior.size === size) {
      try {
        const saved = await realpath(objectPath(root, prior));
        if (outside(saved, root)) { throw new Error("Backup object escaped its directory"); }
        await verifyFile(saved, key, prior);
        object = { ...prior, contentType: metadata.contentType || "application/octet-stream", cacheControl: metadata.cacheControl || "" };
        reused += 1;
      } catch { onProgress("A saved object failed validation; copying a fresh source generation"); }
    }
    if (!object) {
      const nameHash = sha256(projectId + "/" + bucket.name + "/" + file.name + "/" + metadata.generation + "/" + keyId(key));
      const blob = "objects/" + nameHash + "-" + randomBytes(8).toString("hex") + ".nmbak";
      const source = bucket.file(file.name, { generation: metadata.generation }).createReadStream({ validation: "crc32c" });
      const checksum = await encryptFile(source, path.join(root, ...blob.split("/")), key);
      if (checksum.size !== size) { throw new Error("Storage source size changed during backup"); }
      object = { name: file.name, generation: metadata.generation, size, sha256: checksum.sha256, blob,
        contentType: metadata.contentType || "application/octet-stream", cacheControl: metadata.cacheControl || "" };
      await verifyFile(objectPath(root, object), key, object);
      copied += 1;
    }
    objects.push(object);
    if (objects.length % 20 === 0) { onProgress("Validated " + objects.length + " of " + files.length + " Storage objects"); }
  }
  const id = new Date().toISOString().replace(/[.:]/g, "-") + "-" + randomBytes(8).toString("hex");
  const manifest = { format: FORMAT, projectId, bucket: bucket.name, keyId: keyId(key), createdAt: new Date().toISOString(),
    ...database, configuration, objects, copied, reused };
  validateManifest(manifest);
  const filename = "snapshot-" + id + ".nmbak";
  const temporary = path.join(root, filename + ".partial");
  const serialized = Buffer.from(JSON.stringify(manifest));
  const expected = await encryptFile(Readable.from([serialized]), temporary, key);
  await verifyFile(temporary, key, expected);
  await rename(temporary, path.join(root, filename));
  onProgress("Snapshot complete");
  return { filename, documents: manifest.documents.length, objects: objects.length,
    bytes: objects.reduce((total, object) => total + object.size, 0), copied, reused, readTime: manifest.readTime };
}

export async function readConfiguration(projectRoot) {
  const configuration = {};
  for (const name of ["firestore.rules", "storage.rules", "firestore.indexes.json", "firebase.json"]) {
    configuration[name] = await readFile(path.join(projectRoot, name), "utf8");
  }
  return configuration;
}

export function remapReferences(value, sourceRoot, targetRoot) {
  if (Array.isArray(value)) { return value.map((item) => remapReferences(item, sourceRoot, targetRoot)); }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name,
      name === "referenceValue" && typeof item === "string" && item.startsWith(sourceRoot + "/")
        ? targetRoot + item.slice(sourceRoot.length) : remapReferences(item, sourceRoot, targetRoot)]));
  }
  return value;
}

export async function restoreVerifiedSnapshot({ file, key, target, bucket }) {
  // Authenticate every byte before any writes. This entry point deliberately has no production restore target.
  if (!target.root.startsWith("projects/demo-") || !target.emulator || !bucket.name.startsWith("demo-")) {
    throw new Error("Restoration is restricted to an isolated emulator");
  }
  const manifest = await verifySnapshot(file, key);
  const existing = await target.request(target.root + ":listCollectionIds", { method: "POST", body: { pageSize: 1 } });
  const [files] = await bucket.getFiles({ maxResults: 1 });
  if ((existing.collectionIds || []).length || files.length) { throw new Error("Restore target must be completely empty"); }
  const sourceRoot = `projects/${manifest.projectId}/databases/(default)/documents`;
  const documents = manifest.documents.map((document) => ({ ...document,
    fields: remapReferences(document.fields, sourceRoot, target.root) }));
  for (let index = 0; index < documents.length; index += 200) {
    await target.request(target.root + ":commit", { method: "POST", body: {
      writes: documents.slice(index, index + 200).map((document) => ({ update: {
        name: target.root + "/" + document.path, fields: document.fields }, currentDocument: { exists: false } }))
    } });
  }
  for (const object of manifest.objects) {
    await pipeline(Readable.from(decryptFile(objectPath(path.dirname(file), object), key)),
      bucket.file(object.name).createWriteStream({ resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: object.contentType, cacheControl: object.cacheControl || "private, max-age=0" } }));
  }
  const restored = await target.snapshot();
  if (canonical(restored.documents) !== canonical(documents.slice().sort((a, b) => a.path.localeCompare(b.path)))) {
    throw new Error("Restored database does not match the source snapshot");
  }
  for (const object of manifest.objects) {
    const hash = await streamHash(bucket.file(object.name).createReadStream());
    if (hash.size !== object.size || hash.sha256 !== object.sha256) { throw new Error("Restored Storage object does not match"); }
  }
  return { documents: documents.length, objects: manifest.objects.length, bytes: manifest.objects.reduce((sum, object) => sum + object.size, 0) };
}

async function streamHash(source) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of source) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest("hex") };
}
