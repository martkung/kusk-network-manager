import {
  applicationDefault,
  deleteApp,
  initializeApp
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = "kusk-network-manager";
const OWNER_UID = "Bnnm2NUV8rUQ0Am2NxBuJxnCxFi1";
const VALID_ROLES = new Set([
  "owner",
  "admin",
  "editor",
  "viewer",
  "default"
]);

const app = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID
});

const auth = getAuth(app);
const db = getFirestore(app);
const authUsers = [];
let pageToken;

do {
  const page = await auth.listUsers(1000, pageToken);
  authUsers.push(...page.users);
  pageToken = page.pageToken;
} while (pageToken);

const existingSnapshot = await db.collection("users").get();
const existingProfiles = new Map(
  existingSnapshot.docs.map((documentSnapshot) => [
    documentSnapshot.id,
    documentSnapshot.data()
  ])
);

function timestampFrom(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : Timestamp.fromDate(date);
}

let createdCount = 0;
let updatedCount = 0;
const writes = [];

authUsers.forEach((user) => {
  const existing = existingProfiles.get(user.uid);
  const isOwner = user.uid === OWNER_UID;
  const identity = {
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || ""
  };

  if (!existing) {
    const createdAt = timestampFrom(user.metadata.creationTime);
    const lastLoginAt = timestampFrom(user.metadata.lastSignInTime);

    writes.push({
      reference: db.collection("users").doc(user.uid),
      data: {
        ...identity,
        role: isOwner ? "owner" : "default",
        ...(createdAt ? { createdAt } : {}),
        ...(lastLoginAt ? { lastLoginAt } : {}),
        roleUpdatedAt: FieldValue.serverTimestamp(),
        roleUpdatedBy: "system"
      }
    });
    createdCount += 1;
    return;
  }

  const nextRole = isOwner
    ? "owner"
    : (VALID_ROLES.has(existing.role) && existing.role !== "owner"
      ? existing.role
      : "default");

  writes.push({
    reference: db.collection("users").doc(user.uid),
    data: {
      ...identity,
      role: nextRole,
      ...(nextRole !== existing.role
        ? {
          roleUpdatedAt: FieldValue.serverTimestamp(),
          roleUpdatedBy: "system"
        }
        : {})
    }
  });
  updatedCount += 1;
});

for (let start = 0; start < writes.length; start += 400) {
  const batch = db.batch();

  writes.slice(start, start + 400).forEach(({ reference, data }) => {
    batch.set(reference, data, { merge: true });
  });

  await batch.commit();
}

console.log(
  "Synchronized " + String(authUsers.length) +
  " authentication users (" + String(createdCount) +
  " created, " + String(updatedCount) + " updated)"
);

await deleteApp(app);
