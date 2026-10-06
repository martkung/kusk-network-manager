import { db } from "./firebase-config.js?v=20260928-viewer2";
import {
    canViewInventory,
    getOptionalUserContext
} from "./permissions.js?v=20260928-viewer2";

import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const context = await getOptionalUserContext();
const publicGuest = !context.user;

if (publicGuest) {
    document.getElementById("publicGuestNotice")?.removeAttribute("hidden");
    await loadCollectionCount("publicSwitches", "switchCount");

    const accessPointCounter = document.getElementById("apCount");
    if (accessPointCounter) {
        accessPointCounter.textContent = "6";
    }
} else if (!canViewInventory(context.role)) {
    document.getElementById("inventoryCards")?.setAttribute("hidden", "");
    document.getElementById("accessPending")?.removeAttribute("hidden");
} else {
    await Promise.all([
        loadCollectionCount("switches", "switchCount"),
        loadCollectionCount("accesspoints", "apCount")
    ]);
}
async function loadCollectionCount(collectionName, elementId) {
    const counter = document.getElementById(elementId);

    if (!counter) {
        return;
    }

    try {
        const snapshot = await getDocs(collection(db, collectionName));
        counter.textContent = String(snapshot.size);
    } catch (error) {
        console.error(`Unable to load ${collectionName} count:`, error);
        counter.textContent = "-";
    }
}
