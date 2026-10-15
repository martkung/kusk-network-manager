import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const PROJECT_ID = "kusk-network-manager";
const STORAGE_BUCKET = "kusk-network-manager.firebasestorage.app";
const WEB_API_KEY = "AIzaSyDSqC6seQoMsM1jMKGe5DTHf0NpmwFRLuo";
const OWNER_UID = "Bnnm2NUV8rUQ0Am2NxBuJxnCxFi1";
const firestoreBase =
  "https://firestore.googleapis.com/v1/projects/" +
  PROJECT_ID +
  "/databases/(default)/documents";
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!credentialPath) {
  throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required");
}

const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf8"));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID,
  storageBucket: STORAGE_BUCKET
});
const auth = getAuth(app);
const db = getFirestore(app);

async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken" +
      "?key=" + WEB_API_KEY,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true
      })
    }
  );

  if (!response.ok) {
    throw new Error("Unable to exchange the verification token");
  }

  const result = await response.json();
  return result.idToken;
}

async function firestoreRequest(path, { token, method = "GET", body } = {}) {
  return fetch(firestoreBase + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

async function storageRequest(path, token) {
  return fetch(
    "https://firebasestorage.googleapis.com/v0/b/" +
      STORAGE_BUCKET +
      "/o/" + encodeURIComponent(path),
    {
      headers: token ? { Authorization: "Firebase " + token } : {}
    }
  );
}

function expectStatus(label, response, expectedStatus) {
  if (response.status !== expectedStatus) {
    throw new Error(
      label + " returned " + String(response.status) +
      " instead of " + String(expectedStatus)
    );
  }

  console.log(label + ": passed");
}

function expectDenied(label, response) {
  if (![401, 403].includes(response.status)) {
    throw new Error(
      label + " returned " + String(response.status) +
      " instead of a denied response"
    );
  }

  console.log(label + ": passed");
}

function expectReadableDocument(label, response) {
  if (![200, 404].includes(response.status)) {
    throw new Error(label + " returned " + String(response.status));
  }
  console.log(label + ": passed");
}

function expectCondition(label, condition) {
  if (!condition) {
    throw new Error(label + " failed");
  }

  console.log(label + ": passed");
}

const userProfiles = await db.collection("users").get();
const uidByRole = new Map();

userProfiles.docs.forEach((snapshot) => {
  const role = snapshot.data().role;
  if (!uidByRole.has(role)) {
    uidByRole.set(role, snapshot.id);
  }
});

const viewerUid = uidByRole.get("viewer");

if (!viewerUid) {
  throw new Error("A viewer account is required to verify the deployed rules");
}

const ownerToken = await idTokenFor(OWNER_UID);
const viewerToken = await idTokenFor(viewerUid);
const defaultUid = uidByRole.get("default");
const defaultToken = defaultUid ? await idTokenFor(defaultUid) : null;
const testDocumentId = "permission-check-" + Date.now().toString(36);
const testUserId = testDocumentId + "-user";
const testIncidentId = testDocumentId + "-incident";
const [publicSwitches, privateSwitches, guestSwitches] = await Promise.all([
  db.collection("switches").get(),
  db.collection("switchPrivate").get(),
  db.collection("publicSwitches").get()
]);
const sensitiveFields = ["ip", "mac", "serialNumber", "configUrl"];
const guestAllowedFields = new Set(["brand", "model", "status", "lastSeen"]);
let firstImagePath = "";

const publicDataIsSafe = publicSwitches.docs.every((snapshot) => {
  const data = snapshot.data();
  const imagePaths = [
    data.mainImage,
    ...(Array.isArray(data.galleryImages) ? data.galleryImages : [])
  ].filter(Boolean);

  if (!firstImagePath && imagePaths.length) {
    firstImagePath = imagePaths[0];
  }

  return sensitiveFields.every((field) => !(field in data)) &&
    imagePaths.every((path) => (
      typeof path === "string" &&
      path.startsWith(`device-images/${snapshot.id}/`) &&
      !/^https?:\/\//.test(path)
    ));
});

if (!firstImagePath) {
  throw new Error("At least one protected image is required to verify Storage rules");
}

try {
  await db.collection("networkIncidents").doc(testIncidentId).set({
    deviceId: testDocumentId,
    deviceName: "Permission verification (temporary)",
    brand: "", model: "", location: "",
    status: "open",
    offlineSince: FieldValue.serverTimestamp(),
    openedAt: FieldValue.serverTimestamp(),
    lastObservedAt: FieldValue.serverTimestamp(),
    resolvedAt: null, resolution: "",
    acknowledgedAt: null, acknowledgedBy: ""
  });
  expectCondition(
    "Public inventory contains no private network fields or download URLs",
    publicDataIsSafe
  );

  expectCondition(
    "Every switch has a matching private record",
    publicSwitches.size === privateSwitches.size
  );

  expectCondition(
    "Guest inventory is complete and contains only allowlisted fields",
    guestSwitches.size === publicSwitches.size &&
      guestSwitches.docs.every((snapshot) => (
        Object.keys(snapshot.data()).every((field) => guestAllowedFields.has(field)) &&
        sensitiveFields.every((field) => !(field in snapshot.data())) &&
        !("name" in snapshot.data()) &&
        !("location" in snapshot.data()) &&
        !("mainImage" in snapshot.data()) &&
        !("galleryImages" in snapshot.data())
      ))
  );

  expectStatus(
    "Unauthenticated inventory read is denied",
    await firestoreRequest("/switches?pageSize=1"),
    403
  );

  expectStatus(
    "Unauthenticated guest inventory read is allowed",
    await firestoreRequest("/publicSwitches?pageSize=1"),
    200
  );

  expectStatus(
    "Owner can list user profiles",
    await firestoreRequest("/users?pageSize=1", { token: ownerToken }),
    200
  );

  expectStatus(
    "Viewer cannot list user profiles",
    await firestoreRequest("/users?pageSize=1", { token: viewerToken }),
    403
  );

  expectStatus(
    "Viewer can read general inventory",
    await firestoreRequest("/switches?pageSize=1", { token: viewerToken }),
    200
  );

  expectStatus(
    "Viewer cannot read private switch data",
    await firestoreRequest("/switchPrivate?pageSize=1", { token: viewerToken }),
    403
  );

  expectStatus(
    "Viewer cannot read network configuration links",
    await firestoreRequest("/networkLinks?pageSize=1", { token: viewerToken }),
    403
  );

  expectStatus(
    "Owner can read private switch data",
    await firestoreRequest("/switchPrivate?pageSize=1", { token: ownerToken }),
    200
  );

  expectReadableDocument(
    "Owner can read Agent health",
    await firestoreRequest("/monitoring/networkAgent", { token: ownerToken })
  );
  expectReadableDocument(
    "Viewer can read Agent health",
    await firestoreRequest("/monitoring/networkAgent", { token: viewerToken })
  );
  expectStatus(
    "Guest cannot read internal Agent health",
    await firestoreRequest("/monitoring/networkAgent"),
    403
  );
  expectStatus(
    "Viewer cannot list monitoring documents",
    await firestoreRequest("/monitoring?pageSize=1", { token: viewerToken }),
    403
  );
  for (const [label, token] of [["Owner", ownerToken], ["Viewer", viewerToken]]) {
    expectStatus(
      label + " cannot forge Agent heartbeat",
      await firestoreRequest(
        "/monitoring/networkAgent?currentDocument.exists=true&updateMask.fieldPaths=lastAgentSeen",
        {
          token,
          method: "PATCH",
          body: { fields: { lastAgentSeen: { timestampValue: new Date().toISOString() } } }
        }
      ),
      403
    );
  }

  expectDenied(
    "Unauthenticated protected image read is denied",
    await storageRequest(firstImagePath)
  );

  expectStatus(
    "Owner can read protected image metadata",
    await storageRequest(firstImagePath, ownerToken),
    200
  );

  expectStatus(
    "Viewer can read protected image metadata",
    await storageRequest(firstImagePath, viewerToken),
    200
  );

  expectStatus(
    "Viewer cannot create inventory",
    await firestoreRequest(
      "/switches?documentId=" + testDocumentId,
      {
        token: viewerToken,
        method: "POST",
        body: {
          fields: {
            name: { stringValue: "Permission check" },
            brand: { stringValue: "" },
            model: { stringValue: "" },
            location: { stringValue: "" },
            status: { stringValue: "offline" },
            lastSeen: { stringValue: new Date().toISOString() },
            mainImage: { stringValue: "" },
            galleryImages: { arrayValue: {} }
          }
        }
      }
    ),
    403
  );

  for (const path of ["statusHistory", "networkIncidents"]) {
    expectStatus(
      "Viewer can read " + path,
      await firestoreRequest("/" + path + "?pageSize=1", { token: viewerToken }),
      200
    );
    expectStatus(
      "Guest cannot read " + path,
      await firestoreRequest("/" + path + "?pageSize=1"),
      403
    );
  }
  for (const [label, token] of [["Owner", ownerToken], ["Viewer", viewerToken]]) {
    expectStatus(
      label + " cannot read internal monitoring state",
      await firestoreRequest("/monitoringState?pageSize=1", { token }),
      403
    );
  }
  expectStatus(
    "Owner cannot forge status history",
    await firestoreRequest("/statusHistory?documentId=" + testDocumentId, {
      token: ownerToken, method: "POST", body: { fields: { toStatus: { stringValue: "offline" } } }
    }),
    403
  );
  expectStatus(
    "Owner cannot close an incident from the browser",
    await firestoreRequest("/networkIncidents/" + testIncidentId + "?updateMask.fieldPaths=status", {
      token: ownerToken, method: "PATCH", body: { fields: { status: { stringValue: "resolved" } } }
    }),
    403
  );
  function acknowledgementRequest(token, actorUid) {
    return firestoreRequest(":commit", {
      token, method: "POST", body: {
        writes: [{
          update: {
            name: "projects/" + PROJECT_ID + "/databases/(default)/documents/networkIncidents/" + testIncidentId,
            fields: { acknowledgedBy: { stringValue: actorUid } }
          },
          updateMask: { fieldPaths: ["acknowledgedBy"] },
          updateTransforms: [{ fieldPath: "acknowledgedAt", setToServerValue: "REQUEST_TIME" }]
        }]
      }
    });
  }
  expectStatus("Viewer cannot acknowledge incidents",
    await acknowledgementRequest(viewerToken, viewerUid), 403);
  expectStatus("Acknowledgement actor cannot be spoofed",
    await acknowledgementRequest(ownerToken, "spoofed-actor"), 403);
  expectStatus("Owner can acknowledge with server time and their own UID",
    await acknowledgementRequest(ownerToken, OWNER_UID), 200);
  expectStatus("Acknowledgement cannot be overwritten",
    await acknowledgementRequest(ownerToken, OWNER_UID), 403);

  expectStatus(
    "Invalid IPv4 addresses are rejected",
    await firestoreRequest(
      "/switchPrivate?documentId=" + testDocumentId,
      {
        token: ownerToken,
        method: "POST",
        body: {
          fields: {
            ip: { stringValue: "999.1.1.1" },
            mac: { stringValue: "" },
            serialNumber: { stringValue: "" },
            configUrl: { stringValue: "http://999.1.1.1" }
          }
        }
      }
    ),
    403
  );

  expectStatus(
    "Role audit actor cannot be spoofed",
    await firestoreRequest(":commit", {
      token: ownerToken,
      method: "POST",
      body: {
        writes: [
          {
            update: {
              name: "projects/" + PROJECT_ID +
                "/databases/(default)/documents/users/" + testUserId,
              fields: {
                email: { stringValue: "permission-check@example.invalid" },
                displayName: { stringValue: "Permission check" },
                photoURL: { stringValue: "" },
                role: { stringValue: "viewer" },
                roleUpdatedBy: { stringValue: "spoofed-actor" }
              }
            },
            updateTransforms: [
              {
                fieldPath: "roleUpdatedAt",
                setToServerValue: "REQUEST_TIME"
              }
            ]
          }
        ]
      }
    }),
    403
  );

  if (defaultToken) {
    expectStatus(
      "Default account cannot read Agent health",
      await firestoreRequest("/monitoring/networkAgent", { token: defaultToken }),
      403
    );
    expectStatus(
      "Default account cannot read inventory",
      await firestoreRequest("/switches?pageSize=1", { token: defaultToken }),
      403
    );
  } else {
    console.log("Default account inventory check: skipped (no default account)");
  }
} finally {
  await Promise.allSettled([
    db.collection("switches").doc(testDocumentId).delete(),
    db.collection("switchPrivate").doc(testDocumentId).delete(),
    db.collection("publicSwitches").doc(testDocumentId).delete(),
    db.collection("users").doc(testUserId).delete(),
    db.collection("statusHistory").doc(testDocumentId).delete(),
    db.collection("networkIncidents").doc(testIncidentId).delete()
  ]);
  await deleteApp(app);
}
