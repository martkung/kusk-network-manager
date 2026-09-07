import { db } from "../firebase-config.js";

import {
    collection,
    addDoc,
    getDocs
}
from
"https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

export async function addSwitch(data){

const snapshot =
await getDocs(
    collection(db,"switches")
);

const newMac =
(data.mac || "")
.trim()
.toLowerCase();

const newSerial =
(data.serialNumber || "")
.trim()
.toLowerCase();

const newIp =
(data.ip || "")
.trim();

for (const docItem of snapshot.docs) {

    const item =
    docItem.data();

    const currentMac =
    (item.mac || "")
    .trim()
    .toLowerCase();

    const currentSerial =
    (item.serialNumber || "")
    .trim()
    .toLowerCase();

    const currentIp =
    (item.ip || "")
    .trim();

    // ตรวจ MAC ซ้ำ
    if (
        newMac &&
        currentMac === newMac
    ) {

        alert(
            "MAC Address นี้มีอยู่ในระบบแล้ว"
        );

        return;
    }

    // ตรวจ Serial ซ้ำ
    if (
        newSerial &&
        currentSerial === newSerial
    ) {

        alert(
            "Serial Number นี้มีอยู่ในระบบแล้ว"
        );

        return;
    }

    // แจ้งเตือน IP ซ้ำ
if (
    newIp &&
    currentIp === newIp
) {

    const proceed =
    confirm(
        "IP Address นี้มีอยู่ในระบบแล้ว\n\nต้องการบันทึกต่อหรือไม่ ?"
    );

    if (!proceed) {
        return;
    }

    break;
}

}

    await addDoc(
        collection(db,"switches"),
        {
            name: data.name || "",
            brand: data.brand || "",
            model: data.model || "",
            ip: data.ip || "",
            mac: data.mac || "",

            username: data.username || "",
            password: data.password || "",
            serialNumber: data.serialNumber || "",
            location: data.location || "",

            status: data.status || "online",

            configUrl: data.configUrl || "",

            lastSeen: data.lastSeen || ""
        }
    );

}