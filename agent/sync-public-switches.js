import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const PROJECT_ID = "kusk-network-manager";
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!credentialPath) {
  throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required");
}

const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf8"));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID
});

function publicSwitchData(data) {
  return {
    brand: typeof data.brand === "string" ? data.brand.trim() : "",
    model: typeof data.model === "string" ? data.model.trim() : "",
    status: data.status === "online" ? "online" : "offline",
    lastSeen: typeof data.lastSeen === "string" ||
      data.lastSeen instanceof Timestamp
      ? data.lastSeen
      : ""
  };
}

const db = getFirestore(app);

try {
  const [sourceSnapshot, publicSnapshot] = await Promise.all([
    db.collection("switches").get(),
    db.collection("publicSwitches").get()
  ]);
  const sourceIds = new Set(sourceSnapshot.docs.map((snapshot) => snapshot.id));
  const operations = [
    ...sourceSnapshot.docs.map((snapshot) => ({
      type: "set",
      reference: db.collection("publicSwitches").doc(snapshot.id),
      data: publicSwitchData(snapshot.data())
    })),
    ...publicSnapshot.docs
      .filter((snapshot) => !sourceIds.has(snapshot.id))
      .map((snapshot) => ({
        type: "delete",
        reference: snapshot.ref
      }))
  ];

  for (let start = 0; start < operations.length; start += 450) {
    const batch = db.batch();

    operations.slice(start, start + 450).forEach((operation) => {
      if (operation.type === "set") {
        batch.set(operation.reference, operation.data);
      } else {
        batch.delete(operation.reference);
      }
    });

    await batch.commit();
  }

  console.log(`Published ${sourceSnapshot.size} redacted switch records`);
} finally {
  await deleteApp(app);
}
