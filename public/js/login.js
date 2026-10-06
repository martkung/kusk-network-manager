import { auth } from "./firebase-config.js?v=20260928-viewer2";

import {
    onAuthStateChanged,
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { ensureUserProfile } from "./user-profile.js?v=20260928-viewer2";

const form = document.getElementById("loginForm");
const submitButton = document.getElementById("loginButton");
const errorBox = document.getElementById("loginError");
const forceSignIn = new URLSearchParams(window.location.search).get("signin") === "1";

let redirecting = false;

onAuthStateChanged(
    auth,
    async (user) => {
        if (user) {
            if (redirecting) {
                return;
            }

            redirecting = true;

            try {
                await ensureUserProfile(user);
                window.location.replace("/home.html");
            } catch (error) {
                console.error("Unable to prepare the user profile:", error.code);
                errorBox.textContent = "ไม่สามารถตรวจสอบสิทธิ์ผู้ใช้ได้ กรุณาลองใหม่";
                submitButton.disabled = false;
                redirecting = false;
            }

            return;
        }

        if (!forceSignIn) {
            window.location.replace("/home.html");
            return;
        }

        document.documentElement.classList.remove("auth-pending");
    },
    (error) => {
        console.error("Unable to check the login state:", error.code);
        errorBox.textContent = "ไม่สามารถตรวจสอบสถานะการเข้าสู่ระบบได้";
        document.documentElement.classList.remove("auth-pending");
    }
);

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    errorBox.textContent = "";
    submitButton.disabled = true;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error("Login failed:", error.code);
        errorBox.textContent = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
        submitButton.disabled = false;
    }
});
