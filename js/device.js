import {
db,
storage
} from "./firebase-config.js";

import {
doc,
getDoc,
updateDoc
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

import {
ref,
uploadBytes,
getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";

const params = new URLSearchParams(window.location.search);

const id = params.get("id");

const deviceRef = doc(db, "switches", id);

const snap = await getDoc(deviceRef);

if (!snap.exists()) {

alert("Device not found");

window.location.href = "../pages/switches.html";
}

const data = snap.data();

console.log(data);

document.getElementById("deviceName").textContent =
data.name || "-";

document.getElementById("deviceBrand").textContent =
data.brand || "-";

document.getElementById("deviceModel").textContent =
data.model || "-";

document.getElementById("deviceIP").textContent =
data.ip || "-";

document.getElementById("deviceMAC").textContent =
data.mac || "-";

document.getElementById("deviceUsername").textContent =
data.username || "-";

document.getElementById("devicePassword").textContent =
data.password || "-";

document.getElementById("deviceSerial").textContent =
data.serialNumber || "-";

document.getElementById("deviceStatus").textContent =
data.status || "-";

document.getElementById("deviceLocation").textContent =
data.location || "-";

document.getElementById("openConfig").href =
data.configUrl || "#";

const locationImage =
document.getElementById("locationImage");

const galleryContainer =
document.getElementById("galleryContainer");


// =========================
// MAIN IMAGE
// =========================

if (data.mainImage) {

locationImage.src = data.mainImage;
}


// =========================
// GALLERY IMAGES
// =========================

if (
data.galleryImages &&
Array.isArray(data.galleryImages)
) {

galleryContainer.innerHTML = "";

data.galleryImages.forEach((url, index) => {

const wrapper =
document.createElement("div");

wrapper.style.position = "relative";

const img =
document.createElement("img");

img.src = url;

img.className = "gallery-thumb";

img.onclick = () => {

locationImage.src = url;
};


// DELETE BUTTON
const deleteBtn =
document.createElement("button");

deleteBtn.innerHTML = "✕";

deleteBtn.style.position = "absolute";

deleteBtn.style.top = "4px";

deleteBtn.style.right = "4px";

deleteBtn.style.background = "#ef4444";

deleteBtn.style.border = "none";

deleteBtn.style.color = "white";

deleteBtn.style.width = "22px";

deleteBtn.style.height = "22px";

deleteBtn.style.borderRadius = "50%";

deleteBtn.style.cursor = "pointer";

deleteBtn.style.fontSize = "12px";

deleteBtn.onclick = async (e) => {

e.stopPropagation();

const confirmDelete =
confirm("Delete this image?");

if (!confirmDelete) return;

try {

let updatedGallery =
data.galleryImages.filter(
(_, i) => i !== index
);


// ถ้าลบรูปหลัก
let newMainImage =
data.mainImage;

if (data.mainImage === url) {

newMainImage =
updatedGallery[0] ||
"https://placehold.co/600x400?text=No+Image";
}

await updateDoc(deviceRef, {

galleryImages: updatedGallery,

mainImage: newMainImage
});

location.reload();

} catch (error) {

console.error(error);

alert("Delete failed");
}
};

wrapper.appendChild(img);

wrapper.appendChild(deleteBtn);

galleryContainer.appendChild(wrapper);
});


}


// =========================
// UPLOAD IMAGE
// =========================

const uploadBtn =
document.getElementById("uploadLocationBtn");

const galleryUpload =
document.getElementById("galleryUpload");

const cameraUpload =
document.getElementById("cameraUpload");

uploadBtn.addEventListener("click", async () => {

const files = [
    ...galleryUpload.files,
    ...cameraUpload.files
];

if (!files.length) {

alert("Please select image");

return;
}

uploadBtn.disabled = true;

uploadBtn.textContent = "Uploading...";

try {

let galleryImages =
data.galleryImages || [];

for (const file of files) {

const storageRef = ref(
storage,
`device-images/${id}_${Date.now()}_${file.name}`
);

await uploadBytes(storageRef, file);

const downloadURL =
await getDownloadURL(storageRef);

galleryImages.push(downloadURL);
}


// main image = รูปล่าสุด
const newestImage =
galleryImages[galleryImages.length - 1];

await updateDoc(deviceRef, {

mainImage: newestImage,

galleryImages: galleryImages
});

alert("Upload success");

location.reload();

} catch (error) {

console.error(error);

alert("Upload failed");
}

uploadBtn.disabled = false;

uploadBtn.textContent = "Upload Image";
});