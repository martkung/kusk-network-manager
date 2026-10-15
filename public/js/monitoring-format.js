import { timestampMs } from "./agent-health-state.js";

export function formatMonitoringTime(value) {
    const time = timestampMs(value);
    return time === null ? "-" : new Date(time).toLocaleString("th-TH", {
        dateStyle: "short", timeStyle: "short"
    });
}

export function incidentDuration(incident, now = Date.now()) {
    const start = timestampMs(incident.offlineSince);
    const end = incident.status === "resolved"
        ? timestampMs(incident.resolvedAt)
        : timestampMs(incident.lastObservedAt);
    if (start === null || end === null) {
        return "-";
    }
    const minutes = Math.max(0, Math.floor((Math.min(end, now) - start) / 60000));
    if (minutes < 60) { return minutes + " นาที"; }
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? hours + " ชม. " + minutes % 60 + " นาที"
        : Math.floor(hours / 24) + " วัน " + hours % 24 + " ชม.";
}

export const historyKindLabels = {
    baseline: "เริ่มบันทึก",
    status_changed: "สถานะเปลี่ยน",
    target_changed: "เปลี่ยน IP",
    device_removed: "ลบอุปกรณ์",
    device_restored: "กู้คืนอุปกรณ์"
};

export const incidentStatusLabels = {
    open: "Offline ต่อเนื่อง", resolved: "กลับมา Online", closed: "ปิดเหตุการณ์"
};

export const resolutionLabels = {
    target_changed: "เปลี่ยน IP", device_removed: "ลบอุปกรณ์", device_restored: "กู้คืนอุปกรณ์"
};
