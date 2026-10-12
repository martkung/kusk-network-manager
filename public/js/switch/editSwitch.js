import { db } from "../firebase-config.js?v=20260928-viewer2";
import { publicSwitchData } from "./publicSwitch.js?v=20261006-public-guest1";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

function normalized(value) {
    return (value || "").trim().toLowerCase();
}

export async function updateSwitch(id, data) {
    const snapshot = await getDocs(collection(db, "switchPrivate"));
    const newMac = normalized(data.mac);
    const newSerial = normalized(data.serialNumber);
    const newIp = (data.ip || "").trim();

    for (const documentSnapshot of snapshot.docs) {
        if (documentSnapshot.id === id) {
            continue;
        }

        const current = documentSnapshot.data();

        if (newMac && normalized(current.mac) === newMac) {
            alert("MAC Address นี้มีอยู่ในระบบแล้ว");
            return false;
        }

        if (newSerial && normalized(current.serialNumber) === newSerial) {
            alert("Serial Number นี้มีอยู่ในระบบแล้ว");
            return false;
        }

        if (newIp && (current.ip || "").trim() === newIp) {
            const proceed = confirm(
                "IP Address นี้มีอยู่ในระบบแล้ว\n\nต้องการบันทึกต่อหรือไม่?"
            );

            if (!proceed) {
                return false;
            }

            break;
        }
    }

    const publicReference = doc(db, "switches", id);
    const previousSnapshot = await getDoc(publicReference);
    if (!previousSnapshot.exists()) {
        throw new Error("Device no longer exists");
    }
    const previous = previousSnapshot.data();
    const previousPrivate = snapshot.docs.find((item) => item.id === id)?.data();
    const lastSeen = previousPrivate?.ip === data.ip && previous.status === data.status
        ? previous.lastSeen ?? ""
        : "";
    const batch = writeBatch(db);

    batch.update(publicReference, {
        name: data.name,
        brand: data.brand || "",
        model: data.model || "",
        location: data.location || "",
        status: data.status || "offline",
        lastSeen
    });
    batch.set(doc(db, "publicSwitches", id), publicSwitchData({ ...data, lastSeen }));
    batch.set(doc(db, "switchPrivate", id), {
        ip: data.ip,
        mac: data.mac || "",
        serialNumber: data.serialNumber || "",
        configUrl: data.configUrl
    });

    await batch.commit();

    return true;
}
