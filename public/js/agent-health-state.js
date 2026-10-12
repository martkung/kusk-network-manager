export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
export const DEVICE_STALE_MS = 15 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 60 * 1000;

export function timestampMs(value) {
    if (value == null || value === "") {
        return null;
    }

    const milliseconds = typeof value?.toMillis === "function"
        ? value.toMillis()
        : value instanceof Date
            ? value.getTime()
            : typeof value === "number"
                ? value
                : typeof value === "string"
                    ? Date.parse(value)
                    : NaN;
    return Number.isFinite(milliseconds) && milliseconds > 0
        ? milliseconds
        : null;
}

function stale(value, maxAge, now) {
    const time = timestampMs(value);
    return time === null || time > now + CLOCK_TOLERANCE_MS || now - time >= maxAge;
}

export function isDeviceDataStale(value, now = Date.now()) {
    return stale(value, DEVICE_STALE_MS, now);
}

export function inventoryFreshness(devices, now = Date.now()) {
    const times = devices.map((device) => timestampMs(device.lastSeen))
        .filter((time) => time !== null && time <= now + CLOCK_TOLERANCE_MS);
    return {
        total: devices.length,
        staleCount: devices.filter((device) => isDeviceDataStale(device.lastSeen, now)).length,
        latestUpdate: times.length ? Math.max(...times) : null
    };
}

export function agentHealthState(health, {
    now = Date.now(),
    offline = false,
    fromCache = false,
    readFailed = false
} = {}) {
    if (offline || fromCache || readFailed) {
        return "connection";
    }
    if (!health || timestampMs(health.lastAgentSeen) === null) {
        return "unknown";
    }
    if (health.phase === "stopped") {
        return "stopped";
    }
    if (stale(health.lastAgentSeen, HEARTBEAT_STALE_MS, now)) {
        return "missing";
    }
    if (health.phase === "degraded") {
        return "degraded";
    }
    if (health.phase === "running" &&
        stale(health.checkStartedAt, DEVICE_STALE_MS, now)) {
        return "stale";
    }
    if (isDeviceDataStale(health.lastSuccessfulCheckAt, now)) {
        return timestampMs(health.lastSuccessfulCheckAt) === null &&
            ["starting", "running"].includes(health.phase)
            ? "starting"
            : "stale";
    }
    return "healthy";
}
