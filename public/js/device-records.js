import { db } from "./firebase-config.js?v=20260928-viewer2";
import { canManageUsers, requireDeviceEditor } from "./permissions.js?v=20260928-viewer2";
import { changeDevice } from "./switch/device-store.js";
import { auditDifferences, actionLabels } from "./device-audit-format.js";
import { formatMonitoringTime } from "./monitoring-format.js";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from
    "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const context = await requireDeviceEditor();
const params = new URLSearchParams(window.location.search);
const deviceSelect = document.getElementById("recordsDevice");
const errorBox = document.getElementById("recordsError");
const successBox = document.getElementById("recordsSuccess");
const status = document.getElementById("recordsStatus");
const more = document.getElementById("recordsMore");
let tab = params.get("tab") === "trash" ? "trash" : "audit";
let visibleLimit = 50;
let version = 0;
let unsubscribe = () => {};
let cached = true;
let records = [];
let restoring = false;

function text(tag, value, className = "") {
    const element = document.createElement(tag);
    element.textContent = value || "-";
    element.className = className;
    return element;
}

function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }

function messageRow(message) {
    const row = document.createElement("tr");
    const cell = text("td", message, "records-empty");
    cell.colSpan = 5;
    row.appendChild(cell);
    document.getElementById(tab + "Rows").replaceChildren(row);
}

function details(event) {
    const element = document.createElement("details");
    element.appendChild(text("summary", "รายละเอียด"));
    if (event.reason) { element.appendChild(text("p", event.reason, "records-meta")); }
    const header = document.createElement("div");
    header.className = "records-difference records-difference-header";
    header.append(text("span", "ข้อมูล"), text("span", "ก่อน"), text("span", "หลัง"));
    element.appendChild(header);
    const differences = auditDifferences(event);
    for (const difference of differences) {
        const row = document.createElement("div");
        row.className = "records-difference";
        row.append(text("span", difference.label), text("span", difference.before), text("span", difference.after));
        element.appendChild(row);
    }
    if (!differences.length) { element.appendChild(text("p", "ไม่มีค่าข้อมูลเปลี่ยนแปลง", "records-meta")); }
    return element;
}

async function restore(record) {
    if (restoring || cached || !navigator.onLine || !canManageUsers(context.role)) { return; }
    if (!confirm("กู้คืนอุปกรณ์ “" + record.data.device.name + "” ใช่หรือไม่?")) { return; }
    restoring = true;
    render();
    errorBox.hidden = true;
    successBox.hidden = true;
    try {
        const all = await getDocs(collection(db, "switchPrivate"));
        const original = record.data.privateDevice;
        const conflict = all.docs.some((snapshot) => {
            const current = snapshot.data();
            return current.ip === original.ip || (original.mac && current.mac === original.mac) ||
                (original.serialNumber && String(current.serialNumber || "").toLowerCase() === original.serialNumber.toLowerCase());
        });
        if (conflict) { throw new Error("กู้คืนไม่ได้ มีอุปกรณ์ที่ใช้ IP, MAC หรือ Serial เดียวกันอยู่ กรุณาตรวจสอบข้อมูลเดิมก่อน"); }
        await changeDevice("restore", record.id);
        successBox.textContent = "กู้คืนอุปกรณ์แล้ว รอผลตรวจสถานะรอบใหม่";
        successBox.hidden = false;
    } catch (error) {
        console.error("Unable to restore device:", error);
        showError(error.code === "permission-denied" ? "ไม่มีสิทธิ์กู้คืนอุปกรณ์" : error.message || "กู้คืนไม่สำเร็จ");
    } finally {
        restoring = false;
        render();
    }
}

function render() {
    const fragment = document.createDocumentFragment();
    for (const record of records) {
        const data = record.data;
        const row = document.createElement("tr");
        const device = tab === "trash" ? data.device : data.after || data.before || {};
        const deviceCell = document.createElement("td");
        const name = text("a", device.name || data.deviceId, "records-device");
        name.href = "/pages/device-records.html?device=" + encodeURIComponent(data.deviceId);
        deviceCell.append(name, text("div", device.location, "records-meta"));
        if (tab === "audit") {
            const actor = text("td", data.actorEmail || data.actorUid);
            actor.title = data.actorUid;
            const detail = document.createElement("td");
            detail.appendChild(details(data));
            row.append(text("td", formatMonitoringTime(data.occurredAt)), deviceCell,
                text("td", actionLabels[data.action] || data.action), actor, detail);
        } else {
            deviceCell.appendChild(text("div", data.privateDevice.ip, "records-meta"));
            const action = document.createElement("td");
            if (canManageUsers(context.role)) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn btn-sm btn-outline-light records-restore";
                button.title = "กู้คืนอุปกรณ์";
                const icon = document.createElement("i");
                icon.setAttribute("data-lucide", "rotate-ccw");
                icon.setAttribute("aria-hidden", "true");
                button.append(icon, text("span", "กู้คืน"));
                button.disabled = cached || !navigator.onLine || restoring;
                button.addEventListener("click", () => restore(record));
                action.appendChild(button);
            } else { action.textContent = "รอผู้ดูแลกู้คืน"; }
            const actor = text("td", data.deletedByEmail || data.deletedBy);
            actor.title = data.deletedBy;
            row.append(deviceCell, text("td", formatMonitoringTime(data.deletedAt)), actor, text("td", data.reason), action);
        }
        fragment.appendChild(row);
    }
    document.getElementById(tab + "Rows").replaceChildren(fragment);
    if (!records.length) { messageRow(tab === "trash" ? "ไม่มีอุปกรณ์ในถังขยะ" : "ยังไม่มีประวัติการแก้ไข"); }
    status.textContent = (cached || !navigator.onLine ? "ข้อมูลที่บันทึกไว้ · " : "") + records.length + " รายการ";
    more.hidden = records.length < visibleLimit;
    window.lucide?.createIcons();
}

function subscribe(reset = true) {
    unsubscribe();
    const generation = ++version;
    if (reset) { visibleLimit = 50; records = []; messageRow("กำลังโหลดข้อมูล..."); }
    errorBox.hidden = true;
    more.hidden = true;
    status.textContent = "กำลังโหลดข้อมูล...";
    const constraints = deviceSelect.value ? [where("deviceId", "==", deviceSelect.value)] : [];
    unsubscribe = onSnapshot(query(collection(db, tab === "trash" ? "deviceTrash" : "deviceAudit"),
        ...constraints, orderBy(tab === "trash" ? "deletedAt" : "occurredAt", "desc"), limit(visibleLimit)),
    { includeMetadataChanges: true }, (snapshot) => {
        if (generation !== version) { return; }
        cached = snapshot.metadata.fromCache;
        records = snapshot.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() }));
        render();
    }, (error) => {
        if (generation !== version) { return; }
        console.error("Unable to load device records:", error);
        records = [];
        cached = true;
        more.hidden = true;
        messageRow("โหลดข้อมูลไม่สำเร็จ");
        status.textContent = "โหลดข้อมูลไม่สำเร็จ";
        showError("อ่านข้อมูลไม่ได้ กรุณาตรวจสอบสิทธิ์หรือการเชื่อมต่อ");
    });
}

function selectTab(next) {
    tab = next;
    for (const name of ["audit", "trash"]) {
        const selected = name === next;
        const button = document.getElementById(name + "Tab");
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        document.getElementById(name + "Panel").hidden = !selected;
    }
    subscribe();
}

for (const name of ["audit", "trash"]) {
    const button = document.getElementById(name + "Tab");
    button.addEventListener("click", () => selectTab(name));
    button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { return; }
        event.preventDefault();
        selectTab(event.key === "Home" ? "audit" : event.key === "End" ? "trash" : tab === "audit" ? "trash" : "audit");
        document.getElementById(tab + "Tab").focus();
    });
}
more.addEventListener("click", () => { visibleLimit += 50; subscribe(false); });
deviceSelect.addEventListener("change", () => subscribe());
window.addEventListener("online", render);
window.addEventListener("offline", render);
window.addEventListener("beforeunload", () => unsubscribe(), { once: true });

try {
    const [devices, trash] = await Promise.all([getDocs(collection(db, "switches")), getDocs(collection(db, "deviceTrash"))]);
    const choices = new Map(devices.docs.map((snapshot) => [snapshot.id, snapshot.data().name]));
    trash.docs.forEach((snapshot) => choices.set(snapshot.id, snapshot.data().device.name));
    const selected = params.get("device") || "";
    if (selected && !choices.has(selected)) { choices.set(selected, "อุปกรณ์เดิม"); }
    [...choices].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "th")).forEach(([id, name]) => {
        const option = text("option", name);
        option.value = id;
        deviceSelect.appendChild(option);
    });
    deviceSelect.value = selected;
} catch (error) {
    console.error("Unable to load record filters:", error);
    showError("โหลดตัวเลือกอุปกรณ์ไม่สำเร็จ");
}
selectTab(tab);
