import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import net from "node:net";
import ping from "ping";

const PROJECT_ID = "kusk-network-manager";

const app = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID
});

const db = getFirestore(app);
const checkIntervalMs = 300000;
let checkInProgress = false;

async function checkDevices() {
  const [publicSnapshot, privateSnapshot] = await Promise.all([
    db.collection("switches").get(),
    db.collection("switchPrivate").get()
  ]);
  const publicDevices = new Map(publicSnapshot.docs.map((snapshot) => [
    snapshot.id,
    snapshot
  ]));

  for (const privateDocument of privateSnapshot.docs) {
    const publicDocument = publicDevices.get(privateDocument.id);
    const privateData = privateDocument.data();
    const host = String(privateData.ip || "").trim();

    if (!publicDocument) {
      console.warn(`Skipping device without public data: ${privateDocument.id}`);
      continue;
    }

    if (net.isIP(host) === 0) {
      console.warn(`Skipping invalid IP for device ${privateDocument.id}`);
      continue;
    }

    try {
      const result = await ping.promise.probe(host, { timeout: 10 });
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
      console.log(`${publicData.name || privateDocument.id} => ${status}`);
    } catch (error) {
      console.error(`Unable to check device ${privateDocument.id}:`, error.message);
    }
  }
}

async function runDeviceCheck() {
  if (checkInProgress) {
    console.warn("Skipping device check because the previous run is still active");
    return;
  }

  checkInProgress = true;

  try {
    await checkDevices();
  } catch (error) {
    console.error("Device check failed:", error);
  } finally {
    checkInProgress = false;
  }
}

void runDeviceCheck();
setInterval(runDeviceCheck, checkIntervalMs);
