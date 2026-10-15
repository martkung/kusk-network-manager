import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import net from "node:net";
import ping from "ping";
import { startMonitor } from "./monitor.js";
import { interruptObservation, recordObservation, reconcileRemovedDevices } from "./status-store.js";

const PROJECT_ID = "kusk-network-manager";

const app = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID
});

const db = getFirestore(app);
const healthRef = db.collection("monitoring").doc("networkAgent");
let needsStreakReset = true;

async function checkDevices(isStopping) {
  try {
    return await checkDevicesOnce(isStopping);
  } catch (error) {
    needsStreakReset = true;
    throw error;
  }
}

async function checkDevicesOnce(isStopping) {
  const [publicSnapshot, privateSnapshot] = await Promise.all([
    db.collection("switches").get(),
    db.collection("switchPrivate").get()
  ]);
  if (needsStreakReset) {
    for (const device of publicSnapshot.docs) {
      await interruptObservation(db, device.id);
    }
    needsStreakReset = false;
  }
  const publicDevices = new Map(publicSnapshot.docs.map((snapshot) => [
    snapshot.id,
    snapshot
  ]));
  const privateIds = new Set(privateSnapshot.docs.map((snapshot) => snapshot.id));
  const resultCounts = {
    total: publicSnapshot.size,
    checked: 0,
    failed: 0,
    skipped: publicSnapshot.docs.filter((snapshot) => (
      !privateIds.has(snapshot.id)
    )).length
  };
  for (const device of publicSnapshot.docs) {
    if (!privateIds.has(device.id)) {
      await interruptObservation(db, device.id);
    }
  }

  for (const privateDocument of privateSnapshot.docs) {
    if (isStopping()) {
      break;
    }
    const publicDocument = publicDevices.get(privateDocument.id);
    const privateData = privateDocument.data();
    const host = String(privateData.ip || "").trim();

    if (!publicDocument) {
      console.warn(`Skipping device without public data: ${privateDocument.id}`);
      continue;
    }

    if (net.isIP(host) === 0) {
      console.warn(`Skipping invalid IP for device ${privateDocument.id}`);
      resultCounts.skipped += 1;
      await interruptObservation(db, privateDocument.id);
      continue;
    }

    try {
      const result = await ping.promise.probe(host, { timeout: 10 });
      if (isStopping()) {
        break;
      }
      const status = result.alive ? "online" : "offline";
      const publicData = publicDocument.data();
      const recorded = await recordObservation(db, {
        deviceId: privateDocument.id,
        host,
        status
      });
      if (!recorded) {
        resultCounts.skipped += 1;
        await interruptObservation(db, privateDocument.id);
        continue;
      }
      resultCounts.checked += 1;
      console.log(`${publicData.name || privateDocument.id} => ${status}`);
    } catch (error) {
      resultCounts.failed += 1;
      console.error(`Unable to check device ${privateDocument.id}:`, error.message);
      try {
        await interruptObservation(db, privateDocument.id);
      } catch (trackingError) {
        needsStreakReset = true;
        console.error("Unable to interrupt status observation:", trackingError.message);
      }
    }
  }
  if (!isStopping()) {
    await reconcileRemovedDevices(db, publicDevices);
  }
  return resultCounts;
}

const monitor = await startMonitor({
  checkDevices,
  publishHealth: (data) => healthRef.set(data, { merge: true }),
  timestamp: () => FieldValue.serverTimestamp()
});
let shutdownPromise;

function shutdown() {
  shutdownPromise ??= (async () => {
    await monitor.stop();
    await deleteApp(app);
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
