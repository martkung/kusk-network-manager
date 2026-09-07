import admin from "firebase-admin";
import ping from "ping";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync("./firebase-admin.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkDevices() {

  const snapshot =
    await db.collection("switches").get();

  for (const doc of snapshot.docs) {

    const data = doc.data();

    if (!data.ip) continue;

    const result =
      await ping.promise.probe(data.ip);

    const status =
      result.alive ? "online" : "offline";

    await doc.ref.update({
      status,
      lastSeen: new Date()
    });

    console.log(
      `${data.name} => ${status}`
    );
  }
}

checkDevices();

setInterval(
  checkDevices,
  300000
);