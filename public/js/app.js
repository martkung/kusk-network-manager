import { db } from "./firebase-config.js?v=20260928-viewer2";
import {
    canEditDevices,
    canViewInventory,
    getOptionalUserContext
} from "./permissions.js?v=20260928-viewer2";
import { loadSwitches } from "./switch/loadSwitches.js?v=20260928-viewer2";
import { addSwitch } from "./switch/addSwitch.js?v=20260928-viewer2";
import { updateSwitch } from "./switch/editSwitch.js?v=20260928-viewer2";
import { deleteSwitch } from "./switch/deleteSwitch.js?v=20260928-viewer2";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const userContext = await getOptionalUserContext();
const publicGuest = !userContext.user;

if (!publicGuest && !canViewInventory(userContext.role)) {
    window.location.replace("/home.html");
    throw new Error("Inventory permission required");
}

const allowEditing = canEditDevices(userContext.role);

if (publicGuest) {
    document.getElementById("publicGuestNotice")?.removeAttribute("hidden");

    const searchBox = document.getElementById("searchBox");
    const nameColumn = document.querySelector("[data-name-column]");

    if (searchBox) {
        searchBox.placeholder = "ค้นหายี่ห้อหรือรุ่น";
    }

    if (nameColumn) {
        nameColumn.textContent = "รายการ";
    }
}

if (!allowEditing) {
    document.querySelectorAll("[data-private-column]").forEach((element) => {
        element.hidden = true;
    });
}

let editId = null;

function getInputValue(id) {
    return document.getElementById(id)?.value.trim() || "";
}

function setInputValue(id, value) {
    const input = document.getElementById(id);

    if (input) {
        input.value = value || "";
    }
}

function normalizeMac(value) {
    return value.replace(/-/g, ":").toUpperCase();
}

function isValidIPv4(value) {
    const octets = value.split(".");

    return octets.length === 4 && octets.every((octet) => {
        if (!/^\d{1,3}$/.test(octet)) {
            return false;
        }

        const number = Number(octet);
        return number >= 0 && number <= 255;
    });
}

function isValidMac(value) {
    return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(value);
}

function getDeviceData() {
    const ip = getInputValue("ip");
    const mac = normalizeMac(getInputValue("deviceMAC"));

    return {
        name: getInputValue("name"),
        brand: getInputValue("brand"),
        model: getInputValue("model"),
        ip,
        mac,
        serialNumber: getInputValue("serialNumber"),
        location: getInputValue("location"),
        status: getInputValue("status") || "offline",
        configUrl: `http://${ip}`
    };
}

function validateDevice(data) {
    if (!data.name) {
        alert("กรุณากรอกชื่ออุปกรณ์");
        return false;
    }

    if (!isValidIPv4(data.ip)) {
        alert("กรุณากรอก IPv4 ให้ถูกต้อง เช่น 10.60.23.10");
        return false;
    }

    if (data.mac && !isValidMac(data.mac)) {
        alert("กรุณากรอก MAC Address ให้ถูกต้อง เช่น 4C:9E:FF:80:CE:E7");
        return false;
    }

    return true;
}

function waitForDeviceModal() {
    const existingModal = document.getElementById("deviceModal");

    if (existingModal) {
        return Promise.resolve(existingModal);
    }

    return new Promise((resolve) => {
        document.addEventListener(
            "device-modal:ready",
            () => resolve(document.getElementById("deviceModal")),
            { once: true }
        );
    });
}

function showModal(modalElement) {
    window.bootstrap.Modal.getOrCreateInstance(modalElement).show();
}

async function saveDevice() {
    if (!allowEditing) {
        alert("บัญชีนี้มีสิทธิ์ดูข้อมูลอย่างเดียว");
        return;
    }

    const saveButton = document.getElementById("saveDevice");
    const data = getDeviceData();

    if (!validateDevice(data)) {
        return;
    }

    if (saveButton) {
        saveButton.disabled = true;
    }

    try {
        const saved = editId
            ? await updateSwitch(editId, data)
            : await addSwitch(data);

        if (!saved) {
            return;
        }

        alert(editId ? "แก้ไขข้อมูลสำเร็จ" : "บันทึกข้อมูลสำเร็จ");
        window.location.reload();
    } catch (error) {
        console.error("Unable to save device:", error);
        alert("บันทึกข้อมูลไม่สำเร็จ");
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
        }
    }
}

async function newDevice() {
    if (!allowEditing) {
        alert("บัญชีนี้มีสิทธิ์ดูข้อมูลอย่างเดียว");
        return;
    }

    editId = null;

    const modalElement = await waitForDeviceModal();

    [
        "name",
        "brand",
        "model",
        "ip",
        "deviceMAC",
        "serialNumber",
        "location"
    ].forEach((id) => setInputValue(id, ""));

    setInputValue("status", "offline");
    showModal(modalElement);
}

async function editDevice(id) {
    if (!allowEditing) {
        alert("บัญชีนี้มีสิทธิ์ดูข้อมูลอย่างเดียว");
        return;
    }

    try {
        const [publicSnapshot, privateSnapshot] = await Promise.all([
            getDoc(doc(db, "switches", id)),
            getDoc(doc(db, "switchPrivate", id))
        ]);

        if (!publicSnapshot.exists() || !privateSnapshot.exists()) {
            alert("ไม่พบอุปกรณ์นี้");
            return;
        }

        const data = {
            ...publicSnapshot.data(),
            ...privateSnapshot.data()
        };
        const modalElement = await waitForDeviceModal();

        editId = id;
        setInputValue("name", data.name);
        setInputValue("brand", data.brand);
        setInputValue("model", data.model);
        setInputValue("ip", data.ip);
        setInputValue("deviceMAC", data.mac);
        setInputValue("serialNumber", data.serialNumber);
        setInputValue("location", data.location);
        setInputValue("status", data.status || "offline");

        showModal(modalElement);
    } catch (error) {
        console.error("Unable to load device:", error);
        alert("โหลดข้อมูลอุปกรณ์ไม่สำเร็จ");
    }
}

async function removeDevice(id) {
    if (!allowEditing) {
        alert("บัญชีนี้มีสิทธิ์ดูข้อมูลอย่างเดียว");
        return;
    }

    if (!confirm("ต้องการลบอุปกรณ์นี้ใช่หรือไม่?")) {
        return;
    }

    try {
        await deleteSwitch(id);
    } catch (error) {
        console.error("Unable to delete device:", error);
        alert("ลบอุปกรณ์ไม่สำเร็จ");
    }
}

function bindPageControls() {
    const newDeviceButton = document.getElementById("newDeviceButton");

    if (newDeviceButton && !newDeviceButton.dataset.bound) {
        newDeviceButton.hidden = !allowEditing;
        newDeviceButton.dataset.bound = "true";
        newDeviceButton.addEventListener("click", newDevice);
    }

    const saveButton = document.getElementById("saveDevice");

    if (saveButton && !saveButton.dataset.bound) {
        saveButton.hidden = !allowEditing;
        saveButton.dataset.bound = "true";
        saveButton.addEventListener("click", saveDevice);
    }
}

bindPageControls();
document.addEventListener("device-modal:ready", bindPageControls);

const unsubscribe = loadSwitches({
    onEdit: editDevice,
    onDelete: removeDevice,
    canEdit: allowEditing,
    publicGuest
});

window.addEventListener("beforeunload", unsubscribe, { once: true });
