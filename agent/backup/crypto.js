import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("NMBACKUP1\n");
const HEADER_SIZE = MAGIC.length + 16 + 12;

export function keyId(key) { return createHash("sha256").update(key).digest("hex").slice(0, 16); }
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

export async function createKey(file) {
  const key = randomBytes(32);
  await writeFile(file, JSON.stringify({ format: "network-backup-key-v1", id: keyId(key), key: key.toString("base64") }),
    { flag: "wx", mode: 0o600 });
  return keyId(key);
}

export async function loadKey(file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  const key = Buffer.from(value.key || "", "base64");
  if (value.format !== "network-backup-key-v1" || key.length !== 32 || value.id !== keyId(key)) {
    throw new Error("Invalid backup recovery key");
  }
  return key;
}

export async function encryptFile(source, file, key) {
  const header = Buffer.concat([MAGIC, Buffer.from(keyId(key)), randomBytes(12)]);
  const cipher = createCipheriv("aes-256-gcm", key, header.subarray(-12));
  cipher.setAAD(header);
  const hash = createHash("sha256");
  let size = 0;
  async function* chunks() {
    yield header;
    for await (const chunk of source) {
      hash.update(chunk);
      size += chunk.length;
      yield cipher.update(chunk);
    }
    yield cipher.final();
    yield cipher.getAuthTag();
  }
  await pipeline(Readable.from(chunks()), createWriteStream(file, { flags: "wx", mode: 0o600 }));
  const handle = await open(file, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
  return { sha256: hash.digest("hex"), size };
}

export async function* decryptFile(file, key) {
  const info = await stat(file);
  if (!info.isFile() || info.size < HEADER_SIZE + 16) { throw new Error("Incomplete encrypted backup"); }
  const handle = await open(file, "r");
  const header = Buffer.alloc(HEADER_SIZE);
  const tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, 16, info.size - 16);
  } finally { await handle.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC) ||
    header.subarray(MAGIC.length, MAGIC.length + 16).toString() !== keyId(key)) {
    throw new Error("Backup format or recovery key does not match");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(-12));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  if (info.size > HEADER_SIZE + 16) {
    for await (const chunk of createReadStream(file, { start: HEADER_SIZE, end: info.size - 17 })) {
      yield decipher.update(chunk);
    }
  }
  yield decipher.final();
}

export async function verifyFile(file, key, expected) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of decryptFile(file, key)) { hash.update(chunk); size += chunk.length; }
  if (size !== expected.size || hash.digest("hex") !== expected.sha256) { throw new Error("Backup file checksum mismatch"); }
}

export async function readManifest(file, key) {
  const chunks = [];
  let size = 0;
  for await (const chunk of decryptFile(file, key)) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) { throw new Error("Backup manifest exceeds the safety limit"); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function canonical(value) {
  if (Array.isArray(value)) { return "[" + value.map(canonical).join(",") + "]"; }
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function passwordKey(password, salt) {
  if (typeof password !== "string" || [...password].length < 16 || Buffer.byteLength(password) > 4096) {
    throw new Error("Recovery password must contain at least 16 characters");
  }
  return scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}

export async function sealRecoveryKey(keyFile, recoveryFile, password) {
  const key = await loadKey(keyFile);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const derived = passwordKey(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", derived, nonce);
    cipher.setAAD(Buffer.from("NM-RECOVERY-1"));
    const data = Buffer.from(JSON.stringify({ format: "network-backup-key-v1", id: keyId(key), key: key.toString("base64") }));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    await writeFile(recoveryFile, JSON.stringify({ format: "network-recovery-key-v1", kdf: "scrypt-131072-8-1",
      salt: salt.toString("base64"), nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64") }), { flag: "wx", mode: 0o600 });
    const recovered = await unsealRecoveryKey(recoveryFile, password);
    if (!recovered.equals(key)) { throw new Error("Recovery key verification failed"); }
    return keyId(key);
  } finally { derived.fill(0); key.fill(0); }
}

export async function unsealRecoveryKey(recoveryFile, password) {
  const info = await stat(recoveryFile);
  if (!info.isFile() || info.size > 8192) { throw new Error("Invalid recovery key file"); }
  const value = JSON.parse(await readFile(recoveryFile, "utf8"));
  const salt = Buffer.from(value.salt || "", "base64");
  const nonce = Buffer.from(value.nonce || "", "base64");
  const tag = Buffer.from(value.tag || "", "base64");
  if (value.format !== "network-recovery-key-v1" || value.kdf !== "scrypt-131072-8-1" ||
    salt.length !== 16 || nonce.length !== 12 || tag.length !== 16) { throw new Error("Invalid recovery key file"); }
  const derived = passwordKey(password, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", derived, nonce);
    decipher.setAAD(Buffer.from("NM-RECOVERY-1"));
    decipher.setAuthTag(tag);
    const restored = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext || "", "base64")), decipher.final()]).toString());
    const key = Buffer.from(restored.key || "", "base64");
    if (restored.format !== "network-backup-key-v1" || key.length !== 32 || keyId(key) !== restored.id) { throw new Error("Invalid recovered key"); }
    return key;
  } finally { derived.fill(0); }
}
