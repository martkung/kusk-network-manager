import { db } from "./firebase-config.js?v=20260928-viewer2";
import { createAgentHealthNotice } from "./agent-health.js";
import {
    canViewInventory,
    getOptionalUserContext
} from "./permissions.js?v=20260928-viewer2";

import {
    collection,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const context = await getOptionalUserContext();
const publicGuest = !context.user;
const healthNotice = publicGuest || canViewInventory(context.role)
    ? createAgentHealthNotice(context)
    : null;
let unsubscribeInventory = () => {};

if (publicGuest) {
    document.getElementById("publicGuestNotice")?.removeAttribute("hidden");
    unsubscribeInventory = onSnapshot(
        collection(db, "publicSwitches"),
        { includeMetadataChanges: true },
        (snapshot) => {
            document.getElementById("switchCount").textContent = String(snapshot.size);
            healthNotice.updateDevices(snapshot.docs.map((item) => item.data()),
                { fromCache: snapshot.metadata.fromCache });
        },
        (error) => {
            console.error("Unable to load public inventory:", error);
            document.getElementById("switchCount").textContent = "-";
            healthNotice.updateDevices(null, { failed: true });
        }
    );

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

window.addEventListener("beforeunload", () => {
    unsubscribeInventory();
    healthNotice?.stop();
}, { once: true });

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
