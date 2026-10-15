export const actionLabels = { create: "เพิ่มอุปกรณ์", update: "แก้ไขข้อมูล", delete: "ย้ายเข้าถังขยะ", restore: "กู้คืนอุปกรณ์" };

const labels = { name: "ชื่ออุปกรณ์", brand: "ยี่ห้อ", model: "รุ่น", location: "สถานที่",
    status: "สถานะ", ip: "IP Address", mac: "MAC Address", serialNumber: "Serial Number",
    configUrl: "หน้าตั้งค่า", mainImage: "รูปหลัก", galleryImages: "รูปภาพ" };

function display(value) {
    if (Array.isArray(value)) { return value.length ? value.join("\n") : "-"; }
    if (value === "online") { return "Online"; }
    if (value === "offline") { return "Offline"; }
    return typeof value === "string" && value ? value : "-";
}

export function auditDifferences(event) {
    const before = { ...event.before, ...event.privateBefore };
    const after = { ...event.after, ...event.privateAfter };
    return Object.entries(labels).filter(([key]) => JSON.stringify(before[key] ?? "") !== JSON.stringify(after[key] ?? ""))
        .map(([key, label]) => ({ label, before: display(before[key]), after: display(after[key]) }));
}
