import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as firestore from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import { publicSwitchData } from "../../public/js/switch/publicSwitch.js";

const OWNER = "Bnnm2NUV8rUQ0Am2NxBuJxnCxFi1";
const source = await readFile(new URL("../../public/js/switch/device-store.js", import.meta.url), "utf8");
const fields = { name: "Test device", brand: "Test", model: "Test", location: "Test room",
    ip: "192.0.2.1", mac: "", serialNumber: "", configUrl: "http://192.0.2.1", status: "online" };
let env;

// Move plain VM objects to the SDK realm without cloning Timestamp/FieldValue instances.
function sdkData(value) {
    if (Array.isArray(value)) { return Array.from(value, sdkData); }
    if (value?.constructor?.name === "Object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sdkData(item)]));
    }
    return value;
}

before(async () => {
    firestore.setLogLevel("silent");
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Run only in the Firebase emulators");
    env = await initializeTestEnvironment({ projectId: "demo-network-audit" });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
        for (const role of ["admin", "editor", "viewer", "default"]) {
            await firestore.setDoc(firestore.doc(context.firestore(), "users", role), { role });
        }
    });
});

async function client(role = "editor", tamper = (data) => data) {
    const uid = role === "owner" ? OWNER : role;
    const email = role + "@example.invalid";
    const context = role === "guest" ? env.unauthenticatedContext() : env.authenticatedContext(uid, { email });
    const db = context.firestore();
    const sandbox = createContext({ console, Error });
    const synthetic = (exports) => new SyntheticModule(Object.keys(exports), function () {
        Object.entries(exports).forEach(([name, value]) => this.setExport(name, value));
    }, { context: sandbox });
    const module = new SourceTextModule(source, { context: sandbox });
    await module.link((specifier) => {
        if (specifier.includes("firebase-config")) { return synthetic({ db }); }
        if (specifier.includes("permissions")) {
            return synthetic({
                canEditDevices: (value) => ["owner", "admin", "editor"].includes(value),
                canManageUsers: (value) => ["owner", "admin"].includes(value),
                getCurrentUserContext: async () => ({ role, user: { uid, email } })
            });
        }
        if (specifier.includes("publicSwitch")) { return synthetic({ publicSwitchData }); }
        return synthetic({ ...firestore, runTransaction: (_db, callback) => firestore.runTransaction(db, (tx) => callback({
            get: (reference) => tx.get(reference),
            set: (reference, data) => tx.set(reference, sdkData(reference.path.startsWith("deviceAudit/") ? tamper(data) : data)),
            delete: (reference) => tx.delete(reference)
        })) });
    });
    await module.evaluate();
    return { db, storage: context.storage(), change: module.namespace.changeDevice, uid };
}

async function value(db, path) { return (await firestore.getDoc(firestore.doc(db, path))).data(); }
async function events(db) { return (await firestore.getDocs(firestore.collection(db, "deviceAudit"))).docs.map((doc) => doc.data()); }

test("editor creates the device, redacted guest copy and immutable receipt atomically", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    const current = await value(actor.db, "switches/" + id);
    const log = (await events(actor.db))[0];
    assert.equal(current.name, fields.name);
    assert.equal(current.lastSeen, "");
    assert.equal(current.lifecycleId, current.auditId);
    assert.equal(log.before, null);
    assert.equal(log.actorUid, actor.uid);
    assert.equal(log.actorEmail, "editor@example.invalid");
    assert.ok(log.occurredAt.toMillis() > 0);
    assert.deepEqual(log.after, current);
    assert.deepEqual(Object.keys(await value(actor.db, "publicSwitches/" + id)).sort(), ["brand", "lastSeen", "model", "status"]);
});

test("edits record exact previous and next values without losing images or Agent timestamps", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    await env.withSecurityRulesDisabled(async (context) => {
        await firestore.updateDoc(firestore.doc(context.firestore(), "switches", id), {
            lastSeen: firestore.Timestamp.fromMillis(100000), galleryImages: ["device-images/" + id + "/image"]
        });
    });
    const before = await value(actor.db, "switches/" + id);
    await actor.change("update", id, { ...fields, name: "Renamed" });
    const log = (await events(actor.db)).find((event) => event.action === "update");
    assert.deepEqual(log.before, before);
    assert.equal(log.after.name, "Renamed");
    assert.equal(log.after.lastSeen.toMillis(), 100000);
    assert.deepEqual(log.after.galleryImages, before.galleryImages);
    assert.equal(log.privateBefore.ip, fields.ip);
});

test("legacy devices can be edited with their original snapshot retained", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    await env.withSecurityRulesDisabled(async (context) => {
        await firestore.updateDoc(firestore.doc(context.firestore(), "switches", id), {
            auditId: firestore.deleteField(), lifecycleId: firestore.deleteField()
        });
    });
    await actor.change("update", id, { ...fields, location: "New room" });
    assert.equal((await value(actor.db, "switches/" + id)).location, "New room");
});

test("direct browser writes cannot skip the audit on any inventory collection", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    for (const [name, patch] of [["switches", { name: "Bypass" }], ["switchPrivate", { serialNumber: "Bypass" }],
        ["publicSwitches", { model: "Bypass" }]]) {
        await assertFails(firestore.updateDoc(firestore.doc(actor.db, name, id), patch));
        await assertFails(firestore.deleteDoc(firestore.doc(actor.db, name, id)));
    }
});

test("audited writes still enforce IP, MAC and redacted guest validation", async () => {
    const actor = await client();
    await assertFails(actor.change("create", null, { ...fields, ip: "999.1.1.1", configUrl: "http://999.1.1.1" }));
    await assertFails(actor.change("create", null, { ...fields, mac: "invalid" }));
    const id = await actor.change("create", null, fields);
    await assertFails(actor.change("update", id, { ...fields, configUrl: "https://unrelated.example.invalid" }));
    await assertFails(actor.change("images", id, { add: ["device-images/another-device/image"] }));
});

test("forged actor, timestamp, snapshots and standalone receipts are rejected", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    for (const patch of [{ actorUid: "someone-else" }, { actorEmail: "forged@example.invalid" }, { occurredAt: firestore.Timestamp.fromMillis(1) },
        { before: { name: "Fake" } }, { privateBefore: { ip: "192.0.2.5" } }, { privateAfter: { ip: "192.0.2.6" } }]) {
        const attacker = await client("editor", (data) => ({ ...data, ...patch }));
        await assertFails(attacker.change("update", id, { ...fields, name: "Rejected" }));
    }
    const log = (await events(actor.db))[0];
    await assertFails(firestore.setDoc(firestore.doc(actor.db, "deviceAudit", "standalone"), {
        ...log, occurredAt: firestore.serverTimestamp()
    }));
    assert.equal((await value(actor.db, "switches/" + id)).name, fields.name);
    assert.equal((await events(actor.db)).length, 1);
});

test("deletion retains exact snapshots and reason while removing all active copies", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    const original = await value(actor.db, "switches/" + id);
    await assert.rejects(actor.change("delete", id, {}, " "));
    await actor.change("delete", id, {}, "Retired for repair");
    const trash = await value(actor.db, "deviceTrash/" + id);
    assert.deepEqual(trash.device, original);
    assert.equal(trash.privateDevice.ip, fields.ip);
    assert.equal(trash.reason, "Retired for repair");
    for (const name of ["switches", "switchPrivate", "publicSwitches"]) {
        assert.equal(await value(actor.db, name + "/" + id), undefined);
    }
    await assert.rejects(actor.change("delete", id, {}, "Again"));
});

test("only managers restore the same ID with retained images and a new pending-check lifecycle", async () => {
    const editor = await client();
    const id = await editor.change("create", null, fields);
    await editor.change("images", id, { add: ["device-images/" + id + "/image"] });
    await editor.change("delete", id, {}, "Test deletion");
    await assert.rejects(editor.change("restore", id));
    const manager = await client("admin");
    await manager.change("restore", id);
    const restored = await value(manager.db, "switches/" + id);
    assert.equal(restored.name, fields.name);
    assert.equal(restored.status, "offline");
    assert.equal(restored.lastSeen, "");
    assert.equal(restored.auditId, restored.lifecycleId);
    assert.deepEqual(restored.galleryImages, ["device-images/" + id + "/image"]);
    assert.equal(await value(manager.db, "deviceTrash/" + id), undefined);
    await assert.rejects(manager.change("restore", id));
    assert.equal((await events(manager.db)).length, 4);
});

test("rules reject restore by editor even when the client permission guard is bypassed", async () => {
    const editor = await client();
    const id = await editor.change("create", null, fields);
    await editor.change("delete", id, {}, "Test deletion");
    const fakeManager = await client("admin");
    // Evaluate a manager-shaped client module using an editor-authenticated database.
    const trash = await value(editor.db, "deviceTrash/" + id);
    const auditRef = firestore.doc(firestore.collection(editor.db, "deviceAudit"));
    const after = { ...trash.device, auditId: auditRef.id, lifecycleId: auditRef.id, status: "offline", lastSeen: "" };
    const batch = firestore.writeBatch(editor.db);
    batch.set(firestore.doc(editor.db, "switches", id), after);
    batch.set(firestore.doc(editor.db, "switchPrivate", id), trash.privateDevice);
    batch.set(firestore.doc(editor.db, "publicSwitches", id), publicSwitchData(after));
    batch.delete(firestore.doc(editor.db, "deviceTrash", id));
    batch.set(auditRef, { deviceId: id, action: "restore", actorUid: "editor", actorEmail: "editor@example.invalid", occurredAt: firestore.serverTimestamp(),
        reason: "", before: null, after, privateBefore: null, privateAfter: trash.privateDevice, sourceEventId: trash.auditId });
    await assertFails(batch.commit());
    assert.equal((await value(fakeManager.db, "deviceTrash/" + id)).auditId, trash.auditId);
});

test("viewer, default and guest cannot read private history or trash", async () => {
    const editor = await client();
    const id = await editor.change("create", null, fields);
    await editor.change("delete", id, {}, "Test deletion");
    for (const role of ["viewer", "default", "guest"]) {
        const actor = await client(role);
        await assertFails(firestore.getDoc(firestore.doc(actor.db, "deviceTrash", id)));
        await assertFails(firestore.getDocs(firestore.collection(actor.db, "deviceAudit")));
        await assertFails(firestore.getDocs(firestore.collection(actor.db, "deviceTrash")));
        await assert.rejects(actor.change("create", null, fields));
    }
});

test("even the owner cannot edit or erase audit receipts, purge trash, or tamper with its snapshot", async () => {
    const owner = await client("owner");
    const id = await owner.change("create", null, fields);
    const auditId = (await value(owner.db, "switches/" + id)).auditId;
    await assertFails(firestore.updateDoc(firestore.doc(owner.db, "deviceAudit", auditId), { reason: "Edited" }));
    await assertFails(firestore.deleteDoc(firestore.doc(owner.db, "deviceAudit", auditId)));
    await owner.change("delete", id, {}, "Test deletion");
    await assertFails(firestore.updateDoc(firestore.doc(owner.db, "deviceTrash", id), { reason: "Edited" }));
    await assertFails(firestore.deleteDoc(firestore.doc(owner.db, "deviceTrash", id)));
});

test("restore cannot overwrite an active ID or alter the archived network fields", async () => {
    const actor = await client("owner");
    const id = await actor.change("create", null, fields);
    await actor.change("delete", id, {}, "Test deletion");
    const forged = await client("owner", (data) => ({ ...data, privateAfter: { ...data.privateAfter, ip: "192.0.2.9" } }));
    await assertFails(forged.change("restore", id));
    await env.withSecurityRulesDisabled(async (context) => {
        await firestore.setDoc(firestore.doc(context.firestore(), "switches", id), { name: "Conflicting device" });
    });
    await assert.rejects(actor.change("restore", id));
    assert.equal((await value(actor.db, "switches/" + id)).name, "Conflicting device");
    assert.ok(await value(actor.db, "deviceTrash/" + id));
});

test("concurrent edits retry and preserve a complete before-after chain", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    await Promise.all([
        actor.change("update", id, { ...fields, name: "First edit" }),
        actor.change("update", id, { ...fields, name: "Second edit" })
    ]);
    const log = await events(actor.db);
    const current = await value(actor.db, "switches/" + id);
    const latest = log.find((item) => item.after.auditId === current.auditId);
    const previous = log.find((item) => item.after.auditId === latest.before.auditId);
    assert.ok(previous);
    assert.deepEqual(previous.after, latest.before);
    assert.equal(log.length, 3);
});

test("photos survive deletion, are hidden from viewers in trash and return after recovery", async () => {
    const actor = await client();
    const id = await actor.change("create", null, fields);
    const path = "device-images/" + id + "/preserved-image";
    const photo = ref(actor.storage, path);
    await uploadBytes(photo, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    await actor.change("images", id, { add: [path] });
    const viewer = await client("viewer");
    assert.equal((await getBytes(ref(viewer.storage, path))).byteLength, 3);
    await assertFails(deleteObject(photo));
    await assertFails(uploadBytes(photo, new Uint8Array([4]), { contentType: "image/png" }));
    await actor.change("delete", id, {}, "Test deletion");
    await assertFails(getBytes(ref(viewer.storage, path)));
    assert.equal((await getBytes(photo)).byteLength, 3);
    const owner = await client("owner");
    await owner.change("restore", id);
    assert.equal((await getBytes(ref(viewer.storage, path))).byteLength, 3);
    await assertFails(uploadBytes(ref(actor.storage, "device-images/nonexistent/image"), new Uint8Array([1]), { contentType: "image/png" }));
});
