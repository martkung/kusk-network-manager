import assert from "node:assert/strict";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { interruptObservation, recordObservation, reconcileRemovedDevices } from "./status-store.js";

const app = initializeApp({ credential: applicationDefault(), projectId: "kusk-network-manager" });
const db = getFirestore(app);
const root = db.collection("_monitoringVerification").doc();
const scopedDb = {
  collection: (name) => root.collection(name),
  runTransaction: (callback) => db.runTransaction(callback)
};
const deviceId = "isolated-check";
const deviceRef = scopedDb.collection("switches").doc(deviceId);
const privateRef = scopedDb.collection("switchPrivate").doc(deviceId);
const stateRef = scopedDb.collection("monitoringState").doc(deviceId);
const host = "192.0.2.1";

try {
  await Promise.all([
    deviceRef.set({ name: "Isolated verification", brand: "Test", model: "Test", location: "Test" }),
    privateRef.set({ ip: host, mac: "private", serialNumber: "private", configUrl: "private" })
  ]);
  assert.equal(await recordObservation(scopedDb, { deviceId, host, status: "offline" }), true);
  assert.equal((await scopedDb.collection("networkIncidents").get()).size, 0);
  assert.equal((await scopedDb.collection("statusHistory").get()).size, 1);
  console.log("Real transaction records baseline without immediate alert: passed");

  const previous = await stateRef.get();
  const now = previous.readTime.toMillis();
  await stateRef.update({
    consecutiveOffline: 2,
    offlineSince: Timestamp.fromMillis(now - 601000),
    lastObservedAt: Timestamp.fromMillis(now - 300000)
  });
  await Promise.all([
    recordObservation(scopedDb, { deviceId, host, status: "offline" }),
    recordObservation(scopedDb, { deviceId, host, status: "offline" })
  ]);
  await recordObservation(scopedDb, { deviceId, host, status: "offline" });
  const incidents = await scopedDb.collection("networkIncidents").get();
  assert.equal(incidents.size, 1);
  assert.equal(incidents.docs[0].data().status, "open");
  console.log("Concurrent and repeat Offline observations open exactly one incident: passed");

  const allowedFields = new Set(["deviceId", "deviceName", "brand", "model", "location",
    "status", "offlineSince", "openedAt", "lastObservedAt", "resolvedAt", "resolution",
    "acknowledgedAt", "acknowledgedBy", "hasObservationGap"]);
  assert.ok(Object.keys(incidents.docs[0].data()).every((field) => allowedFields.has(field)));
  const guestFields = Object.keys((await scopedDb.collection("publicSwitches").doc(deviceId).get()).data());
  assert.deepEqual(guestFields.sort(), ["brand", "lastSeen", "model", "status"]);
  console.log("Incident and public records exclude private network data: passed");

  await interruptObservation(scopedDb, deviceId);
  await recordObservation(scopedDb, { deviceId, host, status: "offline" });
  assert.equal((await incidents.docs[0].ref.get()).data().hasObservationGap, true);
  console.log("Interrupted monitoring is marked as an observation gap: passed");

  await recordObservation(scopedDb, { deviceId, host, status: "online" });
  assert.equal((await incidents.docs[0].ref.get()).data().status, "resolved");
  assert.equal((await scopedDb.collection("statusHistory").get()).size, 2);
  console.log("Online resolves the incident and appends a transition: passed");

  await interruptObservation(scopedDb, deviceId);
  await recordObservation(scopedDb, { deviceId, host, status: "offline" });
  assert.equal((await stateRef.get()).data().consecutiveOffline, 1);
  await privateRef.update({ ip: "192.0.2.2" });
  assert.equal(await recordObservation(scopedDb, { deviceId, host, status: "online" }), false);
  console.log("Failed checks and concurrent IP edits cannot create false observations: passed");

  const state = await stateRef.get();
  await stateRef.update({
    consecutiveOffline: 2,
    offlineSince: Timestamp.fromMillis(state.readTime.toMillis() - 601000),
    lastObservedAt: Timestamp.fromMillis(state.readTime.toMillis() - 300000)
  });
  await privateRef.update({ ip: host });
  await recordObservation(scopedDb, { deviceId, host, status: "offline" });
  const secondIncidentId = (await stateRef.get()).data().activeIncidentId;
  await deviceRef.delete();
  await reconcileRemovedDevices(scopedDb, new Map());
  const closed = await scopedDb.collection("networkIncidents").doc(secondIncidentId).get();
  assert.equal(closed.data().status, "closed");
  assert.equal(closed.data().resolution, "device_removed");
  assert.equal((await stateRef.get()).exists, false);
  console.log("Removed devices close their incident without fabricating an Online recovery: passed");
} finally {
  await db.recursiveDelete(root);
  await deleteApp(app);
}
