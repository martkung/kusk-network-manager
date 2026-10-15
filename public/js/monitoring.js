import { db } from "./firebase-config.js?v=20260928-viewer2";
import { canEditDevices, requireInventoryAccess } from "./permissions.js?v=20260928-viewer2";
import { createAgentHealthNotice } from "./agent-health.js";
import { formatMonitoringTime, historyKindLabels, incidentDuration,
    incidentStatusLabels, resolutionLabels } from "./monitoring-format.js";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query,
    serverTimestamp, startAfter, updateDoc, where } from
    "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const context = await requireInventoryAccess();
const healthNotice = createAgentHealthNotice(context);
const params = new URLSearchParams(window.location.search);
const selectedDevice = params.get("device") || "";
const deviceSelect = document.getElementById("monitorDevice");
const statusSelect = document.getElementById("incidentStatus");
const loadMore = document.getElementById("loadMoreMonitoring");
const errorBox = document.getElementById("monitoringError");
const pageStatus = document.getElementById("monitoringStatus");
let currentTab = params.get("tab") === "history" ? "history" : "incidents";
let unsubscribeList = () => {};
let listVersion = 0;
let rows = new Map();
let cursor = null;
let historyHasMore = false;
let incidentLimit = 50;
let dataFromCache = false;

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
}

function cell(value) {
    const element = document.createElement("td");
    element.textContent = value || "-";
    return element;
}

function deviceCell(data) {
    const element = document.createElement("td");
    const link = document.createElement("a");
    link.href = "/pages/monitoring.html?tab=history&device=" + encodeURIComponent(data.deviceId);
    link.title = "ประวัติสถานะของอุปกรณ์";
    link.textContent = data.deviceName || data.deviceId;
    const location = document.createElement("div");
    location.className = "monitor-device-location";
    location.textContent = data.location || "";
    element.append(link, location);
    return element;
}

function statusCell(value, labels = {}) {
    const element = document.createElement("td");
    const badge = document.createElement("span");
    const color = ["online", "resolved"].includes(value) ? "success"
        : ["offline", "open"].includes(value) ? "danger" : "secondary";
    badge.className = "badge bg-" + color;
    badge.textContent = labels[value] || value || "-";
    element.appendChild(badge);
    return element;
}

function showListMessage(message) {
    const row = document.createElement("tr");
    const messageCell = cell(message);
    messageCell.colSpan = currentTab === "history" ? 5 : 6;
    messageCell.className = "monitoring-empty";
    row.appendChild(messageCell);
    document.getElementById(currentTab === "history" ? "historyTable" : "incidentsTable")
        .replaceChildren(row);
}

async function acknowledge(id, button) {
    button.disabled = true;
    try {
        await updateDoc(doc(db, "networkIncidents", id), {
            acknowledgedAt: serverTimestamp(),
            acknowledgedBy: context.user.uid
        });
    } catch (error) {
        console.error("Unable to acknowledge incident:", error);
        showError("รับทราบเหตุการณ์ไม่สำเร็จ กรุณาตรวจสอบสิทธิ์หรือสถานะเหตุการณ์");
        button.disabled = false;
    }
}

function render() {
    const table = document.getElementById(currentTab === "history" ? "historyTable" : "incidentsTable");
    const field = currentTab === "history" ? "observedAt" : "openedAt";
    const sorted = [...rows.values()].sort((a, b) => (
        (b.data[field]?.toMillis?.() || 0) - (a.data[field]?.toMillis?.() || 0)
    ));
    const fragment = document.createDocumentFragment();
    for (const { id, data } of sorted) {
        const row = document.createElement("tr");
        if (currentTab === "history") {
            row.append(cell(formatMonitoringTime(data.observedAt)), deviceCell(data),
                statusCell(data.fromStatus), statusCell(data.toStatus),
                cell(historyKindLabels[data.kind] || data.kind));
        } else {
            const event = statusCell(data.status, incidentStatusLabels);
            if (data.resolution && data.resolution !== "online") {
                const reason = document.createElement("div");
                reason.className = "monitor-device-location";
                reason.textContent = resolutionLabels[data.resolution] || "";
                event.appendChild(reason);
            }
            const acknowledgement = document.createElement("td");
            if (data.acknowledgedAt) {
                acknowledgement.textContent = "รับทราบแล้ว " + formatMonitoringTime(data.acknowledgedAt);
            } else if (data.status === "open" && canEditDevices(context.role)) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn btn-sm btn-outline-light";
                button.textContent = "รับทราบ";
                button.disabled = dataFromCache || !navigator.onLine;
                button.addEventListener("click", () => acknowledge(id, button));
                acknowledgement.appendChild(button);
            } else {
                acknowledgement.textContent = data.status === "open" ? "ยังไม่รับทราบ" : "-";
            }
            const duration = cell(incidentDuration(data));
            if (data.hasObservationGap) {
                const gap = document.createElement("div");
                gap.className = "monitor-device-location";
                gap.textContent = "มีช่วงขาดข้อมูล";
                duration.appendChild(gap);
            }
            row.append(deviceCell(data), event, cell(formatMonitoringTime(data.offlineSince)),
                duration, cell(formatMonitoringTime(data.lastObservedAt)), acknowledgement);
        }
        fragment.appendChild(row);
    }
    if (!sorted.length) {
        const row = document.createElement("tr");
        const message = cell(currentTab === "history" ? "ยังไม่มีประวัติสถานะ" : "ไม่มีเหตุการณ์ในรายการนี้");
        message.colSpan = currentTab === "history" ? 5 : 6;
        message.className = "monitoring-empty";
        row.appendChild(message);
        fragment.appendChild(row);
    }
    table.replaceChildren(fragment);
    pageStatus.textContent = (dataFromCache || !navigator.onLine ? "ข้อมูลที่บันทึกไว้ · " : "") +
        sorted.length + " รายการ";
    loadMore.hidden = currentTab === "history" ? !historyHasMore : sorted.length < incidentLimit;
}

function baseQuery() {
    const constraints = [];
    if (deviceSelect.value) { constraints.push(where("deviceId", "==", deviceSelect.value)); }
    if (currentTab === "incidents" && statusSelect.value) {
        constraints.push(where("status", "==", statusSelect.value));
    }
    constraints.push(orderBy(currentTab === "history" ? "observedAt" : "openedAt", "desc"));
    return query(collection(db, currentTab === "history" ? "statusHistory" : "networkIncidents"), ...constraints);
}

function subscribeList({ reset = true } = {}) {
    unsubscribeList();
    const version = ++listVersion;
    if (reset) {
        rows = new Map();
        cursor = null;
        historyHasMore = false;
        incidentLimit = 50;
    }
    errorBox.hidden = true;
    pageStatus.textContent = "กำลังโหลดข้อมูล...";
    if (reset) { showListMessage("กำลังโหลดข้อมูล..."); }
    loadMore.hidden = true;
    unsubscribeList = onSnapshot(query(baseQuery(), limit(currentTab === "history" ? 50 : incidentLimit)),
        { includeMetadataChanges: true }, (snapshot) => {
            if (version !== listVersion) { return; }
            dataFromCache = snapshot.metadata.fromCache;
            if (currentTab === "incidents") { rows.clear(); }
            snapshot.docs.forEach((item) => rows.set(item.id, { id: item.id, data: item.data() }));
            if (currentTab === "history" && !cursor && snapshot.docs.length && !dataFromCache) {
                cursor = snapshot.docs.at(-1);
                historyHasMore = snapshot.size === 50;
            }
            render();
        }, (error) => {
            if (version !== listVersion) { return; }
            console.error("Unable to load monitoring records:", error);
            rows.clear();
            loadMore.hidden = true;
            showListMessage("โหลดข้อมูลไม่สำเร็จ");
            pageStatus.textContent = "โหลดข้อมูลไม่สำเร็จ";
            showError("ยังอ่านข้อมูลไม่ได้ กรุณาลองใหม่หรือตรวจสอบสิทธิ์");
        });
}

function selectTab(tab) {
    currentTab = tab;
    for (const name of ["incidents", "history"]) {
        const selected = name === tab;
        const button = document.getElementById(name + "Tab");
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        document.getElementById(name + "Panel").hidden = !selected;
    }
    statusSelect.hidden = tab === "history";
    subscribeList();
}

for (const name of ["incidents", "history"]) {
    const button = document.getElementById(name + "Tab");
    button.addEventListener("click", () => selectTab(name));
    button.addEventListener("keydown", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next = event.key === "Home" ? "incidents" : event.key === "End" ? "history"
                : currentTab === "history" ? "incidents" : "history";
            selectTab(next);
            document.getElementById(next + "Tab").focus();
        }
    });
}
deviceSelect.addEventListener("change", () => subscribeList());
statusSelect.addEventListener("change", () => subscribeList());
loadMore.addEventListener("click", async () => {
    if (currentTab === "incidents") {
        incidentLimit += 50;
        subscribeList({ reset: false });
        return;
    }
    const version = listVersion;
    loadMore.disabled = true;
    try {
        const snapshot = await getDocs(query(baseQuery(), startAfter(cursor), limit(50)));
        if (version !== listVersion) { return; }
        snapshot.docs.forEach((item) => rows.set(item.id, { id: item.id, data: item.data() }));
        cursor = snapshot.docs.at(-1) || cursor;
        historyHasMore = snapshot.size === 50;
        render();
    } catch (error) {
        if (version !== listVersion) { return; }
        console.error("Unable to load older monitoring records:", error);
        showError("โหลดรายการเพิ่มเติมไม่สำเร็จ");
    } finally {
        loadMore.disabled = false;
    }
});

const unsubscribeSummary = onSnapshot(query(collection(db, "networkIncidents"), where("status", "==", "open")),
    (snapshot) => {
        document.getElementById("activeIncidentCount").textContent = String(snapshot.size);
        document.getElementById("unacknowledgedCount").textContent =
            String(snapshot.docs.filter((item) => !item.data().acknowledgedAt).length);
    }, (error) => {
        console.error("Unable to load incident totals:", error);
        document.getElementById("activeIncidentCount").textContent = "-";
        document.getElementById("unacknowledgedCount").textContent = "-";
    });

try {
    const devices = await getDocs(collection(db, "switches"));
    const sorted = devices.docs.sort((a, b) => String(a.data().name || "").localeCompare(String(b.data().name || ""), "th"));
    sorted.forEach((device) => {
        const option = document.createElement("option");
        option.value = device.id;
        option.textContent = device.data().name || device.id;
        deviceSelect.appendChild(option);
    });
    if (selectedDevice && !devices.docs.some((device) => device.id === selectedDevice)) {
        const option = document.createElement("option");
        option.value = selectedDevice;
        option.textContent = "อุปกรณ์เดิม";
        deviceSelect.appendChild(option);
    }
    deviceSelect.value = selectedDevice;
} catch (error) {
    console.error("Unable to load monitoring device filter:", error);
    showError("โหลดตัวเลือกอุปกรณ์ไม่สำเร็จ");
}
selectTab(currentTab);
window.addEventListener("online", render);
window.addEventListener("offline", render);
window.addEventListener("beforeunload", () => {
    unsubscribeList();
    unsubscribeSummary();
    healthNotice.stop();
}, { once: true });
