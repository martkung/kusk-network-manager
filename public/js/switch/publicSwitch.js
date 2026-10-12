export function publicSwitchData(data) {
    return {
        brand: String(data.brand || "").trim(),
        model: String(data.model || "").trim(),
        status: data.status === "online" ? "online" : "offline",
        lastSeen: data.lastSeen ?? ""
    };
}
