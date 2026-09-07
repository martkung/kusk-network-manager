import { db } from "../firebase-config.js";

import {
updateDoc,
doc,
getDocs,
collection
}
from
"https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

export async function updateSwitch(
id,
data
){

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

for (const docItem of snapshot.docs) {

    // ข้ามตัวเอง
    if (docItem.id === id) {
        continue;
    }

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

    // MAC ซ้ำ
    if (
        newMac &&
        currentMac === newMac
    ) {

        alert(
            "MAC Address นี้มีอยู่ในระบบแล้ว"
        );

        return;
    }

    // Serial ซ้ำ
    if (
        newSerial &&
        currentSerial === newSerial
    ) {

        alert(
            "Serial Number นี้มีอยู่ในระบบแล้ว"
        );

        return;
    }

}



await updateDoc(
doc(db,"switches",id),
data
);

}