import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { createKey, keyId, loadKey, sealRecoveryKey, unsealRecoveryKey } from "./backup/crypto.js";
import { emulatorOrigin, firestoreClient } from "./backup/firestore-source.js";
import { createSnapshot, outside, readConfiguration, restoreVerifiedSnapshot, verifySnapshot } from "./backup/snapshot.js";

const PROJECT = "kusk-network-manager";
const BUCKET = "kusk-network-manager.firebasestorage.app";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  config: { type: "string" }, "key-file": { type: "string" }, snapshot: { type: "string" }, project: { type: "string" },
  "recovery-file": { type: "string" }
} });
const action = positionals[0];
async function externalFile(file) {
  if (!file || !outside(file, projectRoot)) { throw new Error("Key files must be outside the project"); }
  const parent = await realpath(path.dirname(file));
  if (!outside(parent, await realpath(projectRoot))) { throw new Error("Key directory resolves inside the project"); }
}
let app;
try {
  if (action === "init-key") {
    await externalFile(values["key-file"]);
    console.log("Recovery key created. ID: " + await createKey(values["key-file"]));
  } else if (action === "run") {
    if (!values.config || !outside(values.config, projectRoot)) { throw new Error("Use a private configuration outside the project"); }
    const config = JSON.parse((await readFile(values.config, "utf8")).replace(/^\uFEFF/, ""));
    if (config.projectId !== PROJECT || config.bucket !== BUCKET || !config.destination || !config.keyFile) {
      throw new Error("Invalid production backup configuration");
    }
    const destination = await realpath(config.destination);
    const keyFile = await realpath(config.keyFile);
    const workspace = await realpath(projectRoot);
    if (!outside(destination, workspace) || !outside(keyFile, workspace) || !outside(keyFile, destination)) {
      throw new Error("Backups and recovery key must be outside the project and separate from each other");
    }
    const key = await loadKey(keyFile);
    const credential = applicationDefault();
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
      throw new Error("Production backup cannot run with emulator settings");
    }
    app = initializeApp({ credential, projectId: PROJECT, storageBucket: BUCKET });
    const firestore = firestoreClient({ projectId: PROJECT, accessToken: async () => (await credential.getAccessToken()).access_token });
    const summary = await createSnapshot({ directory: destination, key, projectId: PROJECT, bucket: getStorage(app).bucket(),
      firestore, configuration: await readConfiguration(projectRoot), onProgress: console.log });
    console.log(JSON.stringify({ status: "verified", ...summary }));
  } else if (action === "seal-key" || action === "recover-key") {
    if (!values["key-file"] || !values["recovery-file"] || !outside(values["key-file"], projectRoot) ||
      !outside(values["recovery-file"], projectRoot)) { throw new Error("Key files must be outside the project"); }
    await externalFile(values["key-file"]);
    await externalFile(values["recovery-file"]);
    const input = [];
    let inputBytes = 0;
    for await (const chunk of process.stdin) {
      inputBytes += chunk.length;
      if (inputBytes > 8192) { throw new Error("Recovery password input is too large"); }
      input.push(chunk);
    }
    const password = Buffer.concat(input).toString("utf8").replace(/\r?\n$/, "");
    if (action === "seal-key") {
      const id = await sealRecoveryKey(values["key-file"], values["recovery-file"], password);
      console.log("Password-protected recovery key verified. ID: " + id);
    } else {
      const key = await unsealRecoveryKey(values["recovery-file"], password);
      try {
        await writeFile(values["key-file"], JSON.stringify({ format: "network-backup-key-v1", id: keyId(key), key: key.toString("base64") }),
          { flag: "wx", mode: 0o600 });
      } finally { key.fill(0); }
      console.log("Recovery key restored without overwriting an existing file.");
    }
  } else if (action === "verify" || action === "restore-test") {
    if (!values.snapshot || !values["key-file"]) { throw new Error("Specify --snapshot and --key-file"); }
    const key = await loadKey(values["key-file"]);
    if (action === "verify") {
      const snapshot = await verifySnapshot(values.snapshot, key);
      console.log(JSON.stringify({ status: "verified", documents: snapshot.documents.length, objects: snapshot.objects.length }));
    } else {
      const targetProject = values.project || "demo-network-restore";
      if (!/^demo-[a-z0-9-]+$/.test(targetProject)) { throw new Error("Restoration is restricted to a demo emulator project"); }
      const origin = emulatorOrigin(process.env.FIRESTORE_EMULATOR_HOST);
      emulatorOrigin(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
      app = initializeApp({ projectId: targetProject, storageBucket: targetProject + ".appspot.com" });
      const target = firestoreClient({ projectId: targetProject, origin, accessToken: async () => "owner" });
      const result = await restoreVerifiedSnapshot({ file: values.snapshot, key, target, bucket: getStorage(app).bucket() });
      console.log(JSON.stringify({ status: "restore-test-passed", ...result }));
    }
  } else { throw new Error("Use init-key, run, verify, restore-test, seal-key, or recover-key. Production restore is intentionally unavailable."); }
} catch (error) {
  console.error("Backup operation failed:", error.message);
  process.exitCode = 1;
} finally { if (app) { await deleteApp(app); } }
