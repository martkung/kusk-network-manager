import { db } from "./firebase-config.js?v=20260928-viewer2";
import {
    canEditDevices,
    canViewInventory,
    getOptionalUserContext
} from "./permissions.js?v=20260928-viewer2";

import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const context = await getOptionalUserContext();
const publicGuest = !context.user;
const notice = document.getElementById("accessPointNotice");

if (!publicGuest && !canViewInventory(context.role)) {
    window.location.replace("/home.html");
    throw new Error("Inventory permission required");
}

if (publicGuest) {
    notice.textContent = "ข้อมูลสาธารณะแสดงเฉพาะผู้ผลิตระบบ Access Point ลิงก์ตั้งค่าเครือข่ายถูกซ่อนไว้";
} else if (!canEditDevices(context.role)) {
    notice.textContent = "บัญชีผู้ดูสามารถดูรายการระบบได้ แต่ไม่สามารถเปิดหน้าตั้งค่าเครือข่าย";
} else {
    notice.textContent = "ลิงก์ตั้งค่าแสดงเฉพาะผู้ที่มีสิทธิ์แก้ไขอุปกรณ์";

    try {
        const snapshot = await getDocs(collection(db, "networkLinks"));

        snapshot.docs.forEach((documentSnapshot) => {
            const link = document.querySelector(
                `[data-config-link="${CSS.escape(documentSnapshot.id)}"]`
            );
            const value = documentSnapshot.data().url;

            if (!link || typeof value !== "string") {
                return;
            }

            try {
                const url = new URL(value);
                if (!["http:", "https:"].includes(url.protocol)) {
                    return;
                }

                link.href = url.href;
                link.hidden = false;
            } catch {
                console.error("Invalid network configuration link");
            }
        });
    } catch (error) {
        console.error("Unable to load network configuration links:", error);
        notice.textContent = "ไม่สามารถโหลดลิงก์ตั้งค่าเครือข่ายได้";
        notice.className = "alert alert-danger";
    }
}
