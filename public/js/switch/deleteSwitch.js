import { db, storage } from "../firebase-config.js?v=20260928-viewer2";

import {
    doc,
    getDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

import {
    deleteObject,
    ref
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";

export async function deleteSwitch(id) {
    const documentReference = doc(db, "switches", id);
    const snapshot = await getDoc(documentReference);
    const imageUrls = new Set();

    if (snapshot.exists()) {
        const data = snapshot.data();

        if (typeof data.mainImage === "string" && data.mainImage) {
            imageUrls.add(data.mainImage);
        }

        if (Array.isArray(data.galleryImages)) {
            data.galleryImages.forEach((url) => {
                if (typeof url === "string" && url) {
                    imageUrls.add(url);
                }
            });
        }
    }

    const batch = writeBatch(db);
    batch.delete(documentReference);
    batch.delete(doc(db, "publicSwitches", id));
    batch.delete(doc(db, "switchPrivate", id));
    await batch.commit();

    const storageReferences = [...imageUrls]
        .filter((value) => value.startsWith(`device-images/${id}/`))
        .map((value) => ref(storage, value));

    const cleanupResults = await Promise.allSettled(
        storageReferences.map((storageReference) => deleteObject(storageReference))
    );

    cleanupResults.forEach((result) => {
        if (
            result.status === "rejected" &&
            result.reason?.code !== "storage/object-not-found"
        ) {
            console.error("Unable to remove device image:", result.reason);
        }
    });
}
