import {
  applicationDefault,
  deleteApp,
  initializeApp
} from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const PROJECT_ID = "kusk-network-manager";
const STORAGE_BUCKET = "kusk-network-manager.firebasestorage.app";

const app = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
  storageBucket: STORAGE_BUCKET
});

const bucket = getStorage(app).bucket();

await bucket.setCorsConfiguration([
  {
    origin: [
      "https://kusk-network-manager.web.app",
      "https://kusk-network-manager.firebaseapp.com",
      "http://127.0.0.1:4173",
      "http://localhost:4173"
    ],
    method: ["GET", "HEAD"],
    responseHeader: [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges"
    ],
    maxAgeSeconds: 3600
  }
]);

console.log("Storage CORS restricted to approved application origins");
await deleteApp(app);
