import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonical, createKey, decryptFile, encryptFile, loadKey, readManifest, sealRecoveryKey, unsealRecoveryKey, verifyFile } from "../backup/crypto.js";
import { emulatorOrigin, firestoreClient } from "../backup/firestore-source.js";
import { createSnapshot, FORMAT, outside, remapReferences, restoreVerifiedSnapshot, validateManifest, verifySnapshot } from "../backup/snapshot.js";

async function temporary(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nm-backup-test-"));
  try { return await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function fixture() {
  const bytes = Buffer.from("Private fixture image bytes");
  let downloads = 0;
  const bucket = { name: "fixture-bucket", getFiles: async () => [[{
    name: "device-images/device-a/photo", metadata: { size: String(bytes.length), generation: "123", contentType: "image/png",
      metadata: { firebaseStorageDownloadTokens: "never-copy-public-token" } }
  }]], file: (name, options) => {
    assert.equal(name, "device-images/device-a/photo");
    assert.equal(options.generation, "123");
    return { createReadStream: () => { downloads += 1; return Readable.from([bytes]); } };
  } };
  const documents = [{ path: "switches/device-a", fields: { name: { stringValue: "Private fixture device" },
    mainImage: { stringValue: "device-images/device-a/photo" }, count: { integerValue: "9223372036854775806" },
    checked: { timestampValue: "2026-10-15T03:00:00.123456Z" } } }];
  return { bucket, documents, firestore: { snapshot: async () => ({ readTime: "2026-10-15T03:00:00.123456Z", documents }) },
    configuration: { "firestore.rules": "rules fixture" }, downloads: () => downloads };
}

test("encrypted files round-trip without exposing contents and reject tampering and wrong keys", () => temporary(async (directory) => {
  const key = randomBytes(32);
  const data = Buffer.from("private network data");
  const file = path.join(directory, "encrypted.nmbak");
  const checksum = await encryptFile(Readable.from([data]), file, key);
  assert.equal((await readFile(file)).includes(data), false);
  await verifyFile(file, key, checksum);
  await assert.rejects(verifyFile(file, randomBytes(32), checksum));
  const bytes = await readFile(file);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(file, bytes);
  await assert.rejects(verifyFile(file, key, checksum));
}));

test("empty payloads authenticate and truncated files are rejected", () => temporary(async (directory) => {
  const key = randomBytes(32);
  const file = path.join(directory, "empty.nmbak");
  const checksum = await encryptFile(Readable.from([]), file, key);
  await verifyFile(file, key, checksum);
  await writeFile(file, Buffer.from("NMBACKUP1"));
  await assert.rejects(async () => { for await (const _chunk of decryptFile(file, key)) { /* Consume authentication. */ } });
}));

test("password-protected recovery keys survive a separate-file round-trip and refuse wrong passwords", () => temporary(async (directory) => {
  const keyFile = path.join(directory, "key.json");
  const recovery = path.join(directory, "key.nmrecovery");
  const password = "fixture-only-long-recovery-password";
  await createKey(keyFile);
  const key = await loadKey(keyFile);
  await sealRecoveryKey(keyFile, recovery, password);
  assert.equal((await readFile(recovery, "utf8")).includes(key.toString("base64")), false);
  assert.deepEqual(await unsealRecoveryKey(recovery, password), key);
  await assert.rejects(unsealRecoveryKey(recovery, "another-long-but-wrong-password"));
  await assert.rejects(sealRecoveryKey(keyFile, recovery, password), { code: "EEXIST" });
  await assert.rejects(sealRecoveryKey(keyFile, path.join(directory, "weak"), "short"));
  await assert.rejects(createKey(keyFile), { code: "EEXIST" });
}));

test("incremental snapshots reuse verified generations and retain exact typed database values", () => temporary(async (directory) => {
  const key = randomBytes(32);
  const setup = fixture();
  const options = { ...setup, directory, key, projectId: "fixture-project" };
  const first = await createSnapshot(options);
  assert.equal(first.copied, 1);
  const second = await createSnapshot(options);
  assert.equal(second.copied, 0);
  assert.equal(second.reused, 1);
  assert.equal(setup.downloads(), 1);
  const manifest = await verifySnapshot(path.join(directory, second.filename), key);
  assert.deepEqual(manifest.documents, setup.documents);
  assert.equal(JSON.stringify(manifest).includes("never-copy-public-token"), false);
}));

test("a corrupt stored object is not reused and a new source copy repairs the next snapshot", () => temporary(async (directory) => {
  const key = randomBytes(32);
  const setup = fixture();
  const options = { ...setup, directory, key, projectId: "fixture-project" };
  const first = await createSnapshot(options);
  const original = await readManifest(path.join(directory, first.filename), key);
  const corrupt = path.join(directory, ...original.objects[0].blob.split("/"));
  await writeFile(corrupt, Buffer.from("damaged"));
  const second = await createSnapshot(options);
  assert.equal(second.copied, 1);
  assert.equal(setup.downloads(), 2);
  const verified = await verifySnapshot(path.join(directory, second.filename), key);
  assert.notEqual(verified.objects[0].blob, original.objects[0].blob);
  assert.equal((await readFile(corrupt)).toString(), "damaged");
}));

test("missing referenced images and failed source streams never publish a completed snapshot", () => temporary(async (directory) => {
  const key = randomBytes(32);
  const setup = fixture();
  setup.bucket.getFiles = async () => [[]];
  await assert.rejects(createSnapshot({ ...setup, directory, key, projectId: "fixture-project" }), /missing/);
  assert.equal((await readdir(directory)).filter((name) => name.startsWith("snapshot-")).length, 0);
  const next = fixture();
  next.bucket.file = () => ({ createReadStream: () => Readable.from((async function* () { yield Buffer.from("part"); throw new Error("source unavailable"); })()) });
  await assert.rejects(createSnapshot({ ...next, directory, key, projectId: "fixture-project" }), /source unavailable/);
  assert.equal((await readdir(directory)).filter((name) => name.startsWith("snapshot-")).length, 0);
}));

test("backup manifests reject traversal, duplicate documents and missing gallery objects", async () => {
  const base = { format: FORMAT, projectId: "fixture-project", readTime: "2026-10-15T03:00:00Z", documents: [], objects: [], configuration: {} };
  assert.throws(() => validateManifest({ ...base, documents: [{ path: "../data", fields: {} }] }));
  assert.throws(() => validateManifest({ ...base, documents: [{ path: "devices/a", fields: {} }, { path: "devices/a", fields: {} }] }));
  assert.throws(() => validateManifest({ ...base, objects: [{ blob: "../outside.nmbak" }] }));
  assert.throws(() => validateManifest({ ...base, documents: [{ path: "trash/a", fields: { device: { mapValue: { fields: {
    galleryImages: { arrayValue: { values: [{ stringValue: "missing-photo" }] } }
  } } } } }] }), /missing/);
  assert.equal(outside(path.join(os.tmpdir(), "outside"), path.join(os.tmpdir(), "project")), true);
  assert.equal(outside(path.join(os.tmpdir(), "project", "public"), path.join(os.tmpdir(), "project")), false);
});

test("reference remapping changes only typed references within the source project", () => {
  const value = { link: { referenceValue: "projects/source/databases/(default)/documents/devices/a" },
    text: { stringValue: "projects/source/databases/(default)/documents/devices/a" },
    list: { arrayValue: { values: [{ referenceValue: "projects/elsewhere/databases/(default)/documents/devices/a" }] } } };
  const remapped = remapReferences(value, "projects/source/databases/(default)/documents", "projects/demo-test/databases/(default)/documents");
  assert.match(remapped.link.referenceValue, /^projects\/demo-test\//);
  assert.equal(remapped.text.stringValue, value.text.stringValue);
  assert.equal(remapped.list.arrayValue.values[0].referenceValue, value.list.arrayValue.values[0].referenceValue);
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
});

test("restore guards reject production and non-loopback emulator endpoints before writing", async () => {
  for (const host of ["example.com:8080", "127.0.0.1:8080/path", "localhost:70000", "127.0.0.1", "user@localhost:8080"]) {
    assert.throws(() => emulatorOrigin(host));
  }
  assert.equal(emulatorOrigin("127.0.0.1:8188"), "http://127.0.0.1:8188");
  await assert.rejects(restoreVerifiedSnapshot({ target: { root: "projects/production/databases/(default)/documents", emulator: false },
    bucket: { name: "production" } }), /restricted/);
});

test("database discovery uses one server readTime, pagination and missing ancestor traversal", async () => {
  const requests = [];
  const time = "2026-10-15T03:00:00.123456Z";
  const root = "projects/fixture-project/databases/(default)/documents";
  const client = firestoreClient({ projectId: "fixture-project", accessToken: async () => "fixture-token", fetchImpl: async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    requests.push({ url, body, options });
    let value;
    if (url.pathname.endsWith(":runQuery")) { value = [{ readTime: time }]; }
    else if (url.pathname.endsWith("/documents:listCollectionIds")) { value = { collectionIds: ["items"] }; }
    else if (url.pathname.endsWith("/items/missing:listCollectionIds")) { value = { collectionIds: ["nested"] }; }
    else if (url.pathname.endsWith(":listCollectionIds")) { value = {}; }
    else if (url.pathname.endsWith("/documents/items") && !url.searchParams.has("pageToken")) {
      value = { documents: [{ name: root + "/items/missing" }], nextPageToken: "next-page" };
    } else if (url.pathname.endsWith("/documents/items")) {
      value = { documents: [{ name: root + "/items/empty", fields: {}, createTime: time }] };
    } else { value = { documents: [{ name: root + "/items/missing/nested/a", fields: { count: { integerValue: "9223372036854775806" } }, createTime: time }] }; }
    return new Response(JSON.stringify(value), { status: 200 });
  } });
  const result = await client.snapshot();
  assert.equal(result.documents.length, 2);
  assert.equal(result.documents.find((item) => item.path.endsWith("/a")).fields.count.integerValue, "9223372036854775806");
  for (const request of requests.slice(1)) { assert.equal(request.body.readTime || request.url.searchParams.get("readTime"), time); }
  assert.ok(requests.some((request) => request.url.searchParams.get("pageToken") === "next-page"));
  assert.ok(requests.every((request) => request.options.redirect === "error"));
});

test("Windows launcher skips only the covered monthly cutoff and releases its exclusive lock", { skip: process.platform !== "win32" },
  () => temporary(async (directory) => {
    const config = path.join(directory, "config.json");
    const state = path.join(directory, "status.json");
    const launcher = fileURLToPath(new URL("../start-backup.ps1", import.meta.url));
    await writeFile(config, "{}");
    const args = ["-NoProfile", "-NonInteractive", "-File", launcher, "-ConfigPath", config,
      "-CredentialPath", path.join(directory, "missing-credential"), "-NodePath", process.execPath, "-DailyTime", "00:00"];
    const run = () => spawnSync("powershell.exe", args, { encoding: "utf8", timeout: 30000 });
    await writeFile(state, JSON.stringify({ lastSuccessfulBackupAt: new Date().toISOString() }));
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);
    const old = new Date(new Date().getFullYear(), new Date().getMonth(), 0, 12);
    await writeFile(state, JSON.stringify({ lastSuccessfulBackupAt: old.toISOString() }));
    assert.notEqual(run().status, 0);
    const failed = JSON.parse(await readFile(state, "utf8").then((value) => value.replace(/^\uFEFF/, "")));
    assert.equal(failed.phase, "failed");
    assert.equal(failed.lastSuccessfulBackupAt, old.toISOString());
    await writeFile(state, JSON.stringify({ lastSuccessfulBackupAt: new Date(Date.now() + 86400000).toISOString() }));
    assert.notEqual(run().status, 0);
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const command = `$lock = [System.IO.File]::Open(${quote(path.join(directory, "backup.lock"))}, 'OpenOrCreate', 'ReadWrite', 'None'); ` +
      `try { & powershell.exe ${args.map(quote).join(" ")}; exit $LASTEXITCODE } finally { $lock.Dispose() }`;
    const locked = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", timeout: 30000 });
    assert.notEqual(locked.status, 0);
    assert.match(locked.stderr, /Another backup/);
  }));

test("monthly and quarterly cutoffs handle calendar boundaries and never reduce months to fixed day counts", { skip: process.platform !== "win32" }, () => {
  const schedule = fileURLToPath(new URL("../backup-schedule.ps1", import.meta.url));
  const cases = [
    { now: "2026-10-15T12:00:00", interval: 1, expected: "2026-10-01T02:00:00" },
    { now: "2026-11-01T01:59:59", interval: 1, expected: "2026-10-01T02:00:00" },
    { now: "2026-11-01T02:00:00", interval: 1, expected: "2026-11-01T02:00:00" },
    { now: "2027-01-01T01:59:59", interval: 1, expected: "2026-12-01T02:00:00" },
    { now: "2028-03-01T01:59:59", interval: 1, expected: "2028-02-01T02:00:00" },
    { now: "2028-02-29T12:00:00", interval: 1, expected: "2028-02-01T02:00:00" },
    { now: "2026-11-15T12:00:00", interval: 3, expected: "2026-10-01T02:00:00" },
    { now: "2027-01-01T01:59:59", interval: 3, expected: "2026-10-01T02:00:00" },
    { now: "2027-01-01T02:00:00", interval: 3, expected: "2027-01-01T02:00:00" },
    { now: "2027-04-01T01:59:59", interval: 3, expected: "2027-01-01T02:00:00" },
    { now: "2027-07-31T12:00:00", interval: 3, expected: "2027-07-01T02:00:00" }
  ];
  const command = `. '${schedule.replaceAll("'", "''")}'; ` +
    "$cases = [Console]::In.ReadToEnd() | ConvertFrom-Json; " +
    "@($cases | ForEach-Object { (Get-BackupScheduleDue -Now ([datetime]::Parse($_.now)) -IntervalMonths $_.interval).ToString('yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture) }) | ConvertTo-Json -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
    { input: JSON.stringify(cases), encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), cases.map((item) => item.expected));
});

test("Windows accepts monthly and quarterly task XML with limited privileges, catch-up and escaped paths", { skip: process.platform !== "win32" }, () => {
  const schedule = fileURLToPath(new URL("../backup-schedule.ps1", import.meta.url));
  const command = "$ErrorActionPreference = 'Stop'; " + `. '${schedule.replaceAll("'", "''")}'; ` +
    "$service = New-Object -ComObject 'Schedule.Service'; $service.Connect(); " +
    "@(1,3 | ForEach-Object { " +
    "$xml = New-BackupTaskXml -Execute 'C:\\Program Files\\nodejs\\node.exe' -Arguments '--config \"C:\\private\\a & b.json\"' " +
    "-WorkingDirectory 'C:\\work\\a & b' -UserId 'school\\fixture' -Now ([datetime]::Parse('2026-10-15T12:00:00')) -IntervalMonths $_; " +
    "$task = $service.NewTask(0); $task.XmlText = $xml; " +
    "[pscustomobject]@{ Months=$task.Triggers.Item(1).MonthsOfYear; Day=$task.Triggers.Item(1).DaysOfMonth; " +
    "Boundary=$task.Triggers.Item(1).StartBoundary; Logon=$task.Triggers.Item(2).Type; " +
    "RunLevel=$task.Principal.RunLevel; LogonType=$task.Principal.LogonType; CatchUp=$task.Settings.StartWhenAvailable; " +
    "Overlap=$task.Settings.MultipleInstances; Retries=$task.Settings.RestartCount; " +
    "Arguments=$task.Actions.Item(1).Arguments; Directory=$task.Actions.Item(1).WorkingDirectory } " +
    "}) | ConvertTo-Json -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const definitions = JSON.parse(result.stdout);
  assert.deepEqual(definitions.map((item) => item.Months), [4095, 585]);
  for (const item of definitions) {
    assert.equal(item.Day, 1);
    assert.equal(item.Boundary, "2026-10-01T02:00:00");
    assert.equal(item.Logon, 9);
    assert.equal(item.RunLevel, 0);
    assert.equal(item.LogonType, 3);
    assert.equal(item.CatchUp, true);
    assert.equal(item.Overlap, 2);
    assert.equal(item.Retries, 3);
    assert.equal(item.Arguments, '--config "C:\\private\\a & b.json"');
    assert.equal(item.Directory, 'C:\\work\\a & b');
  }
});

test("Windows masked key helper preserves Unicode passwords through its pipe for protection and recovery", { skip: process.platform !== "win32" },
  () => temporary(async (directory) => {
    const keyFile = path.join(directory, "key.json");
    const helper = fileURLToPath(new URL("../protect-backup-key.ps1", import.meta.url));
    const id = await createKey(keyFile);
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    // Synthetic test password only; Read-Host remains masked in the real operator helper.
    const run = (args) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$secure = New-Object System.Security.SecureString; 1..20 | ForEach-Object { $secure.AppendChar([char]0x0E01) }; " +
      "function Read-Host { $secure.Copy() }; " + `& ${quote(helper)} ${args.map((value, index) => index % 2 ? quote(value) : value).join(" ")}`],
    { encoding: "utf8", timeout: 30000 });
    const protectedResult = run(["-KeyFile", keyFile, "-RecoveryDirectory", directory]);
    assert.equal(protectedResult.status, 0, protectedResult.stderr);
    const recovery = path.join(directory, "NetworkManager-recovery-" + id + ".nmrecovery");
    assert.deepEqual(await unsealRecoveryKey(recovery, "\u0e01".repeat(20)), await loadKey(keyFile));
    const restoredFile = path.join(directory, "recovered.json");
    const recoveredResult = run(["-KeyFile", restoredFile, "-RecoveryFile", recovery]);
    assert.equal(recoveredResult.status, 0, recoveredResult.stderr);
    assert.deepEqual(await loadKey(restoredFile), await loadKey(keyFile));
  }));
