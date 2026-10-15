import { db } from "./firebase-config.js?v=20260928-viewer2";
import { collection, onSnapshot, query, where } from
    "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

export function watchIncidentSummary() {
    const badge = document.getElementById("networkAlertCount");
    const healthNotice = document.getElementById("agentHealthNotice");
    const banner = document.createElement("div");
    banner.className = "alert alert-warning offline-notice";
    banner.hidden = true;
    banner.setAttribute("role", "status");
    const text = document.createElement("span");
    const link = document.createElement("a");
    link.className = "alert-link ms-2";
    link.href = "/pages/monitoring.html";
    link.textContent = "ดูเหตุการณ์";
    banner.append(text, link);
    if (healthNotice && !window.location.pathname.endsWith("/monitoring.html")) {
        healthNotice.after(banner);
    }
    const unsubscribe = onSnapshot(query(collection(db, "networkIncidents"), where("status", "==", "open")),
        (snapshot) => {
            if (badge) {
                badge.textContent = String(snapshot.size);
                badge.hidden = snapshot.empty;
            }
            banner.hidden = snapshot.empty;
            text.textContent = "Offline ต่อเนื่อง " + snapshot.size + " อุปกรณ์";
        }, (error) => {
            console.error("Unable to load Offline summary:", error);
            banner.hidden = true;
            if (badge) { badge.hidden = true; }
        });
    window.addEventListener("beforeunload", unsubscribe, { once: true });
}
