import {
  applicationDefault,
  deleteApp,
  initializeApp
} from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "kusk-network-manager";

const app = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID
});

const db = getFirestore(app);
const snapshot = await db.collection("switches").get();
const documentsToClean = snapshot.docs.filter((documentSnapshot) => {
  const data = documentSnapshot.data();
  return Object.hasOwn(data, "username") || Object.hasOwn(data, "password");
});

for (let start = 0; start < documentsToClean.length; start += 400) {
  const batch = db.batch();
  const chunk = documentsToClean.slice(start, start + 400);

  chunk.forEach((documentSnapshot) => {
    batch.update(documentSnapshot.ref, {
      username: FieldValue.delete(),
      password: FieldValue.delete()
    });
  });

  await batch.commit();
}

console.log(`Removed legacy credentials from ${documentsToClean.length} device records`);
await deleteApp(app);
