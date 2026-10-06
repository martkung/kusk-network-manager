import { db } from "./firebase-config.js?v=20260928-viewer2";

import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

function identityFromUser(user) {
    return {
        email: user.email || "",
        displayName: user.displayName || "",
        photoURL: user.photoURL || ""
    };
}

async function touchExistingProfile(profileReference, user) {
    const storageKey = "network-profile-touched:" + user.uid;

    if (window.sessionStorage.getItem(storageKey)) {
        return;
    }

    await updateDoc(profileReference, {
        ...identityFromUser(user),
        lastLoginAt: serverTimestamp()
    });
    window.sessionStorage.setItem(storageKey, "true");
}

export async function ensureUserProfile(user) {
    const profileReference = doc(db, "users", user.uid);
    let snapshot = await getDoc(profileReference);

    if (!snapshot.exists()) {
        try {
            await setDoc(profileReference, {
                ...identityFromUser(user),
                role: "default",
                createdAt: serverTimestamp(),
                lastLoginAt: serverTimestamp(),
                roleUpdatedAt: serverTimestamp(),
                roleUpdatedBy: user.uid
            });

            return {
                id: user.uid,
                ...identityFromUser(user),
                role: "default"
            };
        } catch (error) {
            snapshot = await getDoc(profileReference);

            if (!snapshot.exists()) {
                throw error;
            }
        }
    }

    try {
        await touchExistingProfile(profileReference, user);
    } catch (error) {
        console.warn("Unable to update the user profile timestamp:", error.code);
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    };
}
