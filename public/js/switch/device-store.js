import { db } from "../firebase-config.js?v=20260928-viewer2";
import { canEditDevices, canManageUsers, getCurrentUserContext } from "../permissions.js?v=20260928-viewer2";
import { publicSwitchData } from "./publicSwitch.js?v=20261006-public-guest1";
import { collection, doc, getDoc, runTransaction, serverTimestamp, snapshotEqual } from
    "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

export async function changeDevice(action, id, input = {}, reason = "") {
    const context = await getCurrentUserContext();
    if (!canEditDevices(context.role) || (action === "restore" && !canManageUsers(context.role))) {
        throw new Error("ไม่มีสิทธิ์ดำเนินการนี้");
    }
    if (!["create", "update", "images", "delete", "restore"].includes(action)) {
        throw new Error("รายการเปลี่ยนแปลงไม่ถูกต้อง");
    }
    const deviceRef = id ? doc(db, "switches", id) : doc(collection(db, "switches"));
    const privateRef = doc(db, "switchPrivate", deviceRef.id);
    const guestRef = doc(db, "publicSwitches", deviceRef.id);
    const trashRef = doc(db, "deviceTrash", deviceRef.id);
    const auditRef = doc(collection(db, "deviceAudit"));
    const note = reason.trim();
    if (note.length > 200 || (action === "delete" && !note)) {
        throw new Error("กรุณาระบุเหตุผลการลบไม่เกิน 200 ตัวอักษร");
    }

    let previousRead;
    const commit = () => runTransaction(db, async (transaction) => {
        const [device, privateDevice, trash] = await Promise.all([
            transaction.get(deviceRef), transaction.get(privateRef), transaction.get(trashRef)
        ]);
        previousRead = device;
        const before = device.exists() ? device.data() : null;
        const privateBefore = privateDevice.exists() ? privateDevice.data() : null;
        let after;
        let privateAfter;
        if (action === "create") {
            if (before || privateBefore || trash.exists()) { throw new Error("รหัสอุปกรณ์นี้ถูกใช้งานแล้ว"); }
            after = { name: input.name, brand: input.brand || "", model: input.model || "",
                location: input.location || "", status: input.status || "offline", lastSeen: "",
                lifecycleId: auditRef.id };
            privateAfter = privateFields(input);
        } else if (action === "restore") {
            if (before || privateBefore || !trash.exists()) {
                throw new Error("กู้คืนไม่ได้ อุปกรณ์ถูกกู้คืนแล้วหรือรหัสนี้ถูกใช้งานอยู่");
            }
            after = { ...trash.data().device, status: "offline", lastSeen: "", lifecycleId: auditRef.id };
            privateAfter = trash.data().privateDevice;
        } else {
            if (!before || !privateBefore || trash.exists()) {
                throw new Error("ข้อมูลอุปกรณ์เปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่");
            }
            after = { ...before };
            privateAfter = privateBefore;
            if (action === "update") {
                Object.assign(after, { name: input.name, brand: input.brand || "", model: input.model || "",
                    location: input.location || "", status: input.status || "offline" });
                privateAfter = privateFields(input);
                if (privateBefore.ip !== privateAfter.ip || before.status !== after.status) { after.lastSeen = ""; }
            } else if (action === "images") {
                const gallery = Array.isArray(before.galleryImages) ? before.galleryImages : [];
                after.galleryImages = input.remove
                    ? gallery.filter((path) => path !== input.remove)
                    : [...gallery, ...(input.add || [])];
                if (after.galleryImages.length > 20) { throw new Error("อัปโหลดได้สูงสุด 20 รูปต่ออุปกรณ์"); }
                after.mainImage = input.remove
                    ? (before.mainImage === input.remove ? after.galleryImages[0] || "" : before.mainImage || "")
                    : after.galleryImages.at(-1) || before.mainImage || "";
            }
        }

        const occurredAt = serverTimestamp();
        if (action === "delete") {
            after = null;
            privateAfter = null;
            transaction.set(trashRef, { deviceId: deviceRef.id, device: before, privateDevice: privateBefore,
                deletedAt: occurredAt, deletedBy: context.user.uid, deletedByEmail: context.user.email || "",
                reason: note, auditId: auditRef.id });
            transaction.delete(deviceRef);
            transaction.delete(privateRef);
            transaction.delete(guestRef);
        } else {
            after.auditId = auditRef.id;
            transaction.set(deviceRef, after);
            transaction.set(privateRef, privateAfter);
            transaction.set(guestRef, publicSwitchData(after));
            if (action === "restore") { transaction.delete(trashRef); }
        }
        transaction.set(auditRef, { deviceId: deviceRef.id, action: action === "images" ? "update" : action,
            actorUid: context.user.uid, actorEmail: context.user.email || "", occurredAt, reason: note,
            before, after, privateBefore, privateAfter,
            sourceEventId: action === "restore" ? trash.data().auditId : "" });
    });
    for (let attempt = 0; ; attempt += 1) {
        try { await commit(); break; } catch (error) {
            // Rules may reject a stale before-snapshot before Firestore reports a transaction conflict.
            if (attempt >= 2 || error.code !== "permission-denied" || !previousRead) { throw error; }
            let current;
            try { current = await getDoc(deviceRef); } catch { throw error; }
            if (snapshotEqual(previousRead, current)) { throw error; }
        }
    }
    return deviceRef.id;
}

function privateFields(input) {
    return { ip: input.ip, mac: input.mac || "", serialNumber: input.serialNumber || "", configUrl: input.configUrl };
}
