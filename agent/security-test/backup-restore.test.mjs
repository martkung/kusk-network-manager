import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { emulatorOrigin, firestoreClient } from "../backup/firestore-source.js";
import { createSnapshot, restoreVerifiedSnapshot } from "../backup/snapshot.js";

test("encrypted database and images restore exactly into a separate emulator and never overwrite an existing target", async () => {
  const origin = emulatorOrigin(process.env.FIRESTORE_EMULATOR_HOST);
  emulatorOrigin(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
  const directory = await mkdtemp(path.join(os.tmpdir(), "nm-backup-drill-"));
  const sourceProject = "demo-network-audit";
  const targetProject = "demo-network-restore";
  const sourceApp = initializeApp({ projectId: sourceProject, storageBucket: sourceProject + ".appspot.com" }, "backup-source");
  const targetApp = initializeApp({ projectId: targetProject, storageBucket: targetProject + ".appspot.com" }, "backup-target");
  try {
    const source = firestoreClient({ projectId: sourceProject, origin, accessToken: async () => "owner" });
    const target = firestoreClient({ projectId: targetProject, origin, accessToken: async () => "owner" });
    const imagePath = "device-images/device-a/photo";
    const image = Buffer.alloc(2 * 1024 * 1024, 0x59);
    const bucket = getStorage(sourceApp).bucket();
    await bucket.file(imagePath).save(image, { resumable: false, metadata: {
      contentType: "image/png", metadata: { firebaseStorageDownloadTokens: "do-not-restore-public-token" }
    } });
    const documents = [
      { path: "switches/device-a", fields: { name: { stringValue: "Fixture" }, mainImage: { stringValue: imagePath } } },
      { path: "switchPrivate/device-a", fields: { ip: { stringValue: "192.0.2.1" } } },
      { path: "types/fixture", fields: { integer: { integerValue: "9223372036854775806" }, checked: { timestampValue: "2026-10-15T03:00:00.123456Z" },
        bytes: { bytesValue: "AQID" }, geo: { geoPointValue: { latitude: 13.7, longitude: 100.5 } }, nil: { nullValue: "NULL_VALUE" },
        reference: { referenceValue: source.root + "/switches/device-a" }, map: { mapValue: { fields: { value: { booleanValue: true } } } },
        array: { arrayValue: { values: [{ doubleValue: 1.5 }, { stringValue: "fixture" }] } } } },
      { path: "orphan/missing/nested/fixture", fields: { name: { stringValue: "Missing ancestor retained" } } },
      { path: "deviceTrash/deleted", fields: { device: { mapValue: { fields: { mainImage: { stringValue: imagePath } } } } } }
    ];
    await source.request(source.root + ":commit", { method: "POST", body: { writes: documents.map((document) => ({
      update: { name: source.root + "/" + document.path, fields: document.fields }, currentDocument: { exists: false }
    })) } });
    const key = randomBytes(32);
    const result = await createSnapshot({ directory, key, projectId: sourceProject, bucket, firestore: source,
      configuration: { "firestore.rules": "fixture rules" } });
    assert.equal(result.documents, documents.length);
    assert.equal(result.objects, 1);
    const file = path.join(directory, result.filename);
    const restored = await restoreVerifiedSnapshot({ file, key, target, bucket: getStorage(targetApp).bucket() });
    assert.deepEqual(restored, { documents: documents.length, objects: 1, bytes: image.length });
    const [metadata] = await getStorage(targetApp).bucket().file(imagePath).getMetadata();
    assert.equal(metadata.metadata?.firebaseStorageDownloadTokens, undefined);
    await assert.rejects(restoreVerifiedSnapshot({ file, key, target, bucket: getStorage(targetApp).bucket() }), /completely empty/);
  } finally {
    await deleteApp(sourceApp);
    await deleteApp(targetApp);
    await rm(directory, { recursive: true, force: true });
  }
});
