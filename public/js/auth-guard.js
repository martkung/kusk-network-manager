import { auth } from "./firebase-config.js?v=20260928-viewer2";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

let initialAuthPromise;

function initialAuthUser() {
    if (initialAuthPromise) {
        return initialAuthPromise;
    }

    initialAuthPromise = new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
            auth,
            (user) => {
                unsubscribe();
                resolve(user);
            },
            (error) => {
                unsubscribe();
                reject(error);
            }
        );
    });

    return initialAuthPromise;
}

export async function getOptionalAuthUser() {
    try {
        return await initialAuthUser();
    } catch (error) {
        console.error("Authentication check failed:", error);
        return null;
    } finally {
        document.documentElement.classList.remove("auth-pending");
    }
}

export async function requireAuth() {
    const user = await getOptionalAuthUser();

    if (!user) {
        window.location.replace("/login.html?signin=1");
        throw new Error("Authentication required");
    }

    return user;
}
