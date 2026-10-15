import { db, storage } from "./firebase-config.js?v=20260928-viewer2";
import { createAgentHealthNotice, updateDeviceStatus } from "./agent-health.js";
import { changeDevice } from "./switch/device-store.js";
import {
    canEditDevices,
    requireInventoryAccess
} from "./permissions.js?v=20260928-viewer2";

import {
    doc,
    getDoc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

import {
    getBlob,
    ref,
    uploadBytes
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";

const userContext = await requireInventoryAccess();
const allowEditing = canEditDevices(userContext.role);
const params = new URLSearchParams(window.location.search);
const id = params.get("id");

if (!id || id.includes("/") || id.length > 200) {
    alert("รหัสอุปกรณ์ไม่ถูกต้อง");
    window.location.replace("/pages/switches.html");
    throw new Error("Invalid device id");
}

const deviceRef = doc(db, "switches", id);
document.getElementById("deviceHistoryLink").href =
    "/pages/monitoring.html?tab=history&device=" + encodeURIComponent(id);
if (allowEditing) {
    const changesLink = document.getElementById("deviceChangesLink");
    changesLink.href = "/pages/device-records.html?device=" + encodeURIComponent(id);
    changesLink.hidden = false;
}
const publicSnapshot = await getDoc(deviceRef);

if (!publicSnapshot.exists()) {
    alert("ไม่พบอุปกรณ์นี้");
    window.location.replace("/pages/switches.html");
    throw new Error("Device not found");
}

let data = publicSnapshot.data();
const healthNotice = createAgentHealthNotice(userContext);
let latestStatusData = data;
const unsubscribeStatus = onSnapshot(deviceRef, { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.exists()) {
        latestStatusData = snapshot.data();
        healthNotice.updateDevices([latestStatusData], { fromCache: snapshot.metadata.fromCache });
        updateDeviceStatus(document.getElementById("deviceStatus"),
            latestStatusData.status, latestStatusData.lastSeen);
    } else {
        latestStatusData = null;
        healthNotice.updateDevices(null, { failed: true });
        document.getElementById("deviceStatus").textContent = "ไม่พบอุปกรณ์";
    }
}, (error) => {
    console.error("Unable to read current device status:", error);
    healthNotice.updateDevices(null, { failed: true });
});
const statusTimer = window.setInterval(() => {
    if (!latestStatusData) {
        return;
    }
    updateDeviceStatus(document.getElementById("deviceStatus"),
        latestStatusData.status, latestStatusData.lastSeen);
}, 30000);

if (allowEditing) {
    const privateSnapshot = await getDoc(doc(db, "switchPrivate", id));
    if (privateSnapshot.exists()) {
        data = {
            ...data,
            ...privateSnapshot.data()
        };
    }
}

const placeholderImage = "https://placehold.co/600x400?text=No+Image";
const allowedImageTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
]);
const objectUrls = new Set();

function setText(idName, value) {
    const element = document.getElementById(idName);

    if (element) {
        element.textContent = value || "-";
    }
}

function safeHttpUrl(value, expectedHost) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) &&
            url.hostname === expectedHost
            ? url.href
            : null;
    } catch {
        return null;
    }
}

function validImagePath(value) {
    return typeof value === "string" &&
        value.startsWith(`device-images/${id}/`) &&
        value.slice(`device-images/${id}/`.length).length > 0 &&
        !value.slice(`device-images/${id}/`.length).includes("/");
}

async function objectUrlFor(path) {
    if (!validImagePath(path)) {
        return null;
    }

    const blob = await getBlob(ref(storage, path));
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
}

async function setMainImage(path) {
    const locationImage = document.getElementById("locationImage");

    if (!validImagePath(path)) {
        locationImage.src = placeholderImage;
        return;
    }

    try {
        locationImage.src = await objectUrlFor(path) || placeholderImage;
    } catch (error) {
        console.error("Unable to load device image:", error);
        locationImage.src = placeholderImage;
    }
}

setText("deviceName", data.name);
setText("deviceBrand", data.brand);
setText("deviceModel", data.model);
updateDeviceStatus(document.getElementById("deviceStatus"), data.status, data.lastSeen);
setText("deviceLocation", data.location);

if (allowEditing) {
    setText("deviceIP", data.ip);
    setText("deviceMAC", data.mac);
    setText("deviceSerial", data.serialNumber);
} else {
    document.querySelectorAll("[data-private-field]").forEach((element) => {
        element.hidden = true;
    });
    document.getElementById("viewerNotice").hidden = false;
    document.getElementById("managementPanel").hidden = true;
}

const openConfig = document.getElementById("openConfig");
const configUrl = allowEditing
    ? safeHttpUrl(data.configUrl, String(data.ip || "").trim())
    : null;

if (configUrl) {
    openConfig.href = configUrl;
} else {
    openConfig.removeAttribute("href");
    openConfig.classList.add("disabled");
    openConfig.setAttribute("aria-disabled", "true");
}

const galleryContainer = document.getElementById("galleryContainer");
const galleryImages = Array.isArray(data.galleryImages)
    ? data.galleryImages.filter(validImagePath)
    : [];

await setMainImage(data.mainImage);
galleryContainer.replaceChildren();

for (const storedPath of galleryImages) {
    const wrapper = document.createElement("div");
    const image = document.createElement("img");
    const deleteButton = document.createElement("button");

    wrapper.className = "gallery-item";
    image.alt = "Device location";
    image.className = "gallery-thumb";

    try {
        const imageUrl = await objectUrlFor(storedPath);
        if (!imageUrl) {
            continue;
        }

        image.src = imageUrl;
        image.addEventListener("click", () => {
            document.getElementById("locationImage").src = imageUrl;
        });
    } catch (error) {
        console.error("Unable to load gallery image:", error);
        continue;
    }

    deleteButton.type = "button";
    deleteButton.className = "gallery-delete";
    deleteButton.textContent = "X";
    deleteButton.title = "Delete image";
    deleteButton.hidden = !allowEditing;
    deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();

        if (!allowEditing || !confirm("ต้องการลบรูปนี้ใช่หรือไม่?")) {
            return;
        }

        try {
            await changeDevice("images", id, { remove: storedPath });
            window.location.reload();
        } catch (error) {
            console.error("Unable to delete image:", error);
            alert("ลบรูปไม่สำเร็จ");
        }
    });

    wrapper.append(image, deleteButton);
    galleryContainer.appendChild(wrapper);
}

const uploadButton = document.getElementById("uploadLocationBtn");
const galleryUpload = document.getElementById("galleryUpload");
const cameraUpload = document.getElementById("cameraUpload");
const uploadControls = document.querySelector(".upload-controls");

if (!allowEditing && uploadControls) {
    uploadControls.hidden = true;
}

uploadButton.addEventListener("click", async () => {
    if (!allowEditing) {
        return;
    }

    const files = [
        ...galleryUpload.files,
        ...cameraUpload.files
    ];

    if (!files.length) {
        alert("กรุณาเลือกรูปภาพ");
        return;
    }

    if (galleryImages.length + files.length > 20) {
        alert("อัปโหลดได้สูงสุด 20 รูปต่ออุปกรณ์");
        return;
    }

    const invalidFile = files.find((file) => (
        !allowedImageTypes.has(file.type) || file.size > 10 * 1024 * 1024
    ));

    if (invalidFile) {
        alert("รองรับเฉพาะ JPG, PNG, WEBP หรือ GIF ขนาดไม่เกิน 10 MB");
        return;
    }

    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading...";
    const uploadedReferences = [];

    try {
        for (const file of files) {
            const imageId = window.crypto.randomUUID();
            const storageReference = ref(storage, `device-images/${id}/${imageId}`);

            await uploadBytes(storageReference, file, { contentType: file.type });
            uploadedReferences.push(storageReference);
        }

        await changeDevice("images", id, { add: uploadedReferences.map((reference) => reference.fullPath) });

        alert("อัปโหลดรูปสำเร็จ");
        window.location.reload();
    } catch (error) {
        console.error("Unable to upload images:", error);
        alert("อัปโหลดรูปไม่สำเร็จ");
    } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload Image";
    }
});

window.addEventListener("beforeunload", () => {
    unsubscribeStatus();
    window.clearInterval(statusTimer);
    healthNotice.stop();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
}, { once: true });
