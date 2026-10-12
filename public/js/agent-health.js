import { db } from "./firebase-config.js?v=20260928-viewer2";
import {
    agentHealthState,
    inventoryFreshness,
    isDeviceDataStale,
    timestampMs
} from "./agent-health-state.js";
import { doc, onSnapshot } from
    "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const messages = {
    connection: ["warning", "ยังยืนยันข้อมูลล่าสุดไม่ได้",
        "การเชื่อมต่อฐานข้อมูลยังไม่พร้อม สถานะอุปกรณ์ที่แสดงเป็นข้อมูลล่าสุดที่บันทึกไว้"],
    unknown: ["warning", "ยังไม่พบสัญญาณจาก Agent",
        "ยังยืนยันสถานะปัจจุบันของสวิตช์ไม่ได้ กรุณาตรวจสอบ Agent ภายในโรงเรียน"],
    stopped: ["danger", "Agent หยุดทำงาน",
        "สถานะสวิตช์ที่แสดงอาจเก่า กรุณาเปิด Agent ภายในโรงเรียน"],
    missing: ["danger", "ไม่ได้รับสัญญาณจาก Agent เกิน 3 นาที",
        "Agent หรือการเชื่อมต่ออาจขัดข้อง สถานะสวิตช์ที่แสดงอาจเก่า"],
    degraded: ["warning", "Agent ตรวจอุปกรณ์ได้ไม่ครบ",
        "บางรายการยังไม่ได้รับการอัปเดต กรุณาตรวจสอบการทำงานของ Agent"],
    starting: ["warning", "Agent กำลังตรวจสอบอุปกรณ์",
        "กำลังรอผลตรวจครบหนึ่งรอบ สถานะที่แสดงเป็นข้อมูลล่าสุดที่บันทึกไว้"],
    stale: ["warning", "ข้อมูลสวิตช์ไม่ได้อัปเดตครบเกิน 15 นาที",
        "Agent ยังส่งสัญญาณ แต่ผลตรวจอุปกรณ์อาจเก่า กรุณาตรวจสอบ Agent"],
    healthy: ["success", "Agent ทำงานปกติ", ""]
};

function formatTime(value) {
    const time = timestampMs(value);
    return time === null ? "ยังไม่มี" : new Date(time).toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "medium"
    });
}

export function updateDeviceStatus(element, status, lastSeen) {
    const stale = isDeviceDataStale(lastSeen);
    const online = status === "online";
    element.className = "badge " + (stale ? "bg-secondary" :
        online ? "bg-success" : "bg-danger");
    element.textContent = (online ? "online" : "offline") +
        (stale ? " · ข้อมูลเก่า" : "");
    element.title = "ตรวจล่าสุด: " + formatTime(lastSeen);
}

export function createAgentHealthNotice(context) {
    const notice = document.getElementById("agentHealthNotice");
    if (!notice) {
        return { updateDevices() {}, stop() {} };
    }

    const guest = !context.user;
    const title = document.createElement("strong");
    const message = document.createElement("p");
    const details = document.createElement("p");
    title.className = "agent-health-title";
    message.className = "agent-health-message";
    details.className = "agent-health-details";
    notice.replaceChildren(title, message, details);
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");

    let health = null;
    let fromCache = true;
    let readFailed = false;
    let devices = null;
    let inventoryFromCache = false;
    let inventoryReadFailed = false;

    function render() {
        const offline = !navigator.onLine;
        const freshness = devices === null ? null : inventoryFreshness(devices);
        let state;
        let presentation;

        if (guest) {
            state = offline || inventoryFromCache || readFailed || devices === null
                ? "connection"
                : freshness.staleCount > 0 ? "stale" : "healthy";
            presentation = state === "connection" ? messages.connection :
                state === "stale"
                    ? ["warning", "ข้อมูลสวิตช์บางรายการอาจเก่า",
                        "มี " + freshness.staleCount + " จาก " + freshness.total +
                        " รายการที่ไม่ได้อัปเดตภายใน 15 นาที สถานะที่แสดงเป็นผลตรวจล่าสุดที่บันทึกไว้"]
                    : ["success", "ข้อมูลสถานะสวิตช์เป็นปัจจุบัน", ""];
        } else {
            state = agentHealthState(health, {
                offline,
                fromCache: fromCache || inventoryFromCache,
                readFailed: readFailed || inventoryReadFailed
            });
            presentation = messages[state];
            if (state === "healthy" && freshness?.staleCount > 0) {
                state = "stale";
                presentation = ["warning", "ข้อมูลอุปกรณ์บางรายการอาจเก่า",
                    "มี " + freshness.staleCount + " จาก " + freshness.total +
                    " รายการที่ไม่ได้อัปเดตภายใน 15 นาที"];
            }
        }

        notice.hidden = guest && freshness?.total === 0 && state !== "connection";
        notice.className = "agent-health agent-health-" + presentation[0];
        notice.dataset.state = state;
        title.textContent = presentation[1];
        message.textContent = presentation[2];
        message.hidden = !presentation[2];
        details.textContent = guest
            ? "ปรับปรุงข้อมูลล่าสุด: " + formatTime(freshness?.latestUpdate)
            : "รับสัญญาณล่าสุด: " + formatTime(health?.lastAgentSeen) +
                " | ตรวจครบล่าสุด: " + formatTime(health?.lastSuccessfulCheckAt);
    }

    const unsubscribe = guest ? () => {} : onSnapshot(
        doc(db, "monitoring", "networkAgent"),
        { includeMetadataChanges: true },
        (snapshot) => {
            health = snapshot.exists() ? snapshot.data() : null;
            fromCache = snapshot.metadata.fromCache;
            readFailed = false;
            render();
        },
        (error) => {
            console.error("Unable to read Agent health:", error);
            readFailed = true;
            render();
        }
    );
    const timer = window.setInterval(render, 30000);
    window.addEventListener("online", render);
    window.addEventListener("offline", render);
    document.addEventListener("visibilitychange", render);
    render();

    return {
        updateDevices(nextDevices, { fromCache: cached = false, failed = false } = {}) {
            devices = nextDevices;
            inventoryFromCache = cached;
            inventoryReadFailed = failed;
            if (guest) {
                readFailed = failed;
            }
            render();
        },
        stop() {
            unsubscribe();
            window.clearInterval(timer);
            window.removeEventListener("online", render);
            window.removeEventListener("offline", render);
            document.removeEventListener("visibilitychange", render);
        }
    };
}
