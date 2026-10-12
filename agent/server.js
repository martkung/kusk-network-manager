import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import net from "node:net";
import ping from "ping";
import { startMonitor } from "./monitor.js";

const PROJECT_ID = "kusk-network-manager";

const app = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID
});

const db = getFirestore(app);
const healthRef = db.collection("monitoring").doc("networkAgent");

async function checkDevices(isStopping) {
  const [publicSnapshot, privateSnapshot] = await Promise.all([
    db.collection("switches").get(),
    db.collection("switchPrivate").get()
  ]);
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
      continue;
    }

    try {
      const result = await ping.promise.probe(host, { timeout: 10 });
      if (isStopping()) {
        break;
      }
      const status = result.alive ? "online" : "offline";
      const lastSeen = FieldValue.serverTimestamp();
      const publicData = publicDocument.data();
      const batch = db.batch();

      batch.update(publicDocument.ref, {
        status,
        lastSeen
      });
      batch.set(db.collection("publicSwitches").doc(privateDocument.id), {
        brand: typeof publicData.brand === "string" ? publicData.brand : "",
        model: typeof publicData.model === "string" ? publicData.model : "",
        status,
        lastSeen
      });

      await batch.commit();
      resultCounts.checked += 1;
      console.log(`${publicData.name || privateDocument.id} => ${status}`);
    } catch (error) {
      resultCounts.failed += 1;
      console.error(`Unable to check device ${privateDocument.id}:`, error.message);
    }
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
