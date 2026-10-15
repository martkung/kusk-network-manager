import assert from "node:assert/strict";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { recordObservation } from "../status-store.js";

test("restoring within a sweep rejects old Ping results and starts a new incident lifecycle", async () => {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Use only the local emulator");
    const app = initializeApp({ projectId: "demo-network-audit" }, "restored-monitoring");
    const db = getFirestore(app);
    const root = db.collection("_monitoringVerification").doc();
    const scoped = { collection: (name) => root.collection(name), runTransaction: (callback) => db.runTransaction(callback) };
    const deviceRef = scoped.collection("switches").doc("restored");
    const stateRef = scoped.collection("monitoringState").doc("restored");
    try {
        await deviceRef.set({ name: "Restored", brand: "Test", model: "Test", lifecycleId: "original" });
        await scoped.collection("switchPrivate").doc("restored").set({ ip: "192.0.2.1" });
        const observe = (status, lifecycleId) => recordObservation(scoped, { deviceId: "restored", host: "192.0.2.1", status,
            expectedLifecycleId: lifecycleId });
        await observe("offline", "original");
        const state = await stateRef.get();
        await stateRef.update({ consecutiveOffline: 2, offlineSince: Timestamp.fromMillis(state.readTime.toMillis() - 601000),
            lastObservedAt: Timestamp.fromMillis(state.readTime.toMillis() - 300000) });
        await observe("offline", "original");
        const incidentId = (await stateRef.get()).data().activeIncidentId;
        assert.ok(incidentId);
        await deviceRef.update({ lifecycleId: "restored", lastSeen: "", status: "offline" });
        assert.equal(await observe("online", "original"), false);
        assert.equal((await deviceRef.get()).data().lastSeen, "");
        await observe("offline", "restored");
        const incident = (await scoped.collection("networkIncidents").doc(incidentId).get()).data();
        assert.equal(incident.status, "closed");
        assert.equal(incident.resolution, "device_restored");
        const next = (await stateRef.get()).data();
        assert.equal(next.consecutiveOffline, 1);
        assert.equal(next.activeIncidentId, null);
        const history = await scoped.collection("statusHistory").where("kind", "==", "device_restored").get();
        assert.equal(history.size, 1);
    } finally {
        await db.recursiveDelete(root);
        await deleteApp(app);
    }
});
