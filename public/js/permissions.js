import {
    getOptionalAuthUser,
    requireAuth
} from "./auth-guard.js?v=20260928-viewer2";
import { ensureUserProfile } from "./user-profile.js?v=20260928-viewer2";

export const OWNER_UID = "Bnnm2NUV8rUQ0Am2NxBuJxnCxFi1";

export const ROLES = Object.freeze({
    owner: {
        label: "ผู้ดูแลหลัก",
        description: "จัดการระบบและสิทธิ์ผู้ใช้ได้ทั้งหมด"
    },
    admin: {
        label: "ผู้ดูแล",
        description: "จัดการอุปกรณ์และกำหนดสิทธิ์ระดับปฏิบัติงาน"
    },
    editor: {
        label: "ผู้แก้ไข",
        description: "ดู เพิ่ม แก้ไข และลบข้อมูลอุปกรณ์"
    },
    viewer: {
        label: "ผู้ดู",
        description: "ดูข้อมูลทั่วไป สถานะ สถานที่ และรูปภาพของอุปกรณ์"
    },
    guest: {
        label: "ผู้เยี่ยมชม",
        description: "ดูเฉพาะข้อมูลสาธารณะที่ไม่ระบุตัวอุปกรณ์หรือสถานที่"
    },
    default: {
        label: "ค่าเริ่มต้น",
        description: "รอผู้ดูแลกำหนดสิทธิ์ และยังเข้าถึงข้อมูลอุปกรณ์ไม่ได้"
    }
});

let contextPromise;
let optionalContextPromise;

function normalizeRole(role) {
    return Object.hasOwn(ROLES, role) ? role : "default";
}

export function getRoleLabel(role) {
    return ROLES[normalizeRole(role)].label;
}

export function canEditDevices(role) {
    return ["owner", "admin", "editor"].includes(normalizeRole(role));
}

export function canViewInventory(role) {
    return ["owner", "admin", "editor", "viewer"].includes(normalizeRole(role));
}

export function canViewPublicInventory(role) {
    return normalizeRole(role) === "guest" || canViewInventory(role);
}

export function canManageUsers(role) {
    return ["owner", "admin"].includes(normalizeRole(role));
}

export function canAssignRole(actorRole, targetRole, nextRole) {
    const actor = normalizeRole(actorRole);
    const target = normalizeRole(targetRole);
    const next = normalizeRole(nextRole);

    if (actor === "owner") {
        return target !== "owner" && next !== "owner";
    }

    return actor === "admin" &&
        ["editor", "viewer", "default"].includes(target) &&
        ["editor", "viewer", "default"].includes(next);
}

export function assignableRoles(actorRole) {
    return actorRole === "owner"
        ? ["admin", "editor", "viewer", "default"]
        : ["editor", "viewer", "default"];
}

async function contextForUser(user) {
    const profile = await ensureUserProfile(user);
    const role = user.uid === OWNER_UID
        ? "owner"
        : normalizeRole(profile.role);

    return {
        user,
        profile: {
            ...profile,
            role
        },
        role
    };
}

export async function getOptionalUserContext({ refresh = false } = {}) {
    if (refresh) {
        optionalContextPromise = undefined;
    }

    if (!optionalContextPromise) {
        optionalContextPromise = (async () => {
            const user = await getOptionalAuthUser();

            if (!user) {
                return {
                    user: null,
                    profile: null,
                    role: "guest"
                };
            }

            return contextForUser(user);
        })();
    }

    return optionalContextPromise;
}

export async function getCurrentUserContext({ refresh = false } = {}) {
    if (refresh) {
        contextPromise = undefined;
    }

    if (!contextPromise) {
        contextPromise = (async () => {
            const user = await requireAuth();
            return contextForUser(user);
        })();
    }

    return contextPromise;
}

export async function requireUserManager() {
    const context = await getCurrentUserContext();

    if (!canManageUsers(context.role)) {
        window.location.replace("/home.html");
        throw new Error("User management permission required");
    }

    return context;
}

export async function requireInventoryAccess() {
    const context = await getCurrentUserContext();

    if (!canViewInventory(context.role)) {
        window.location.replace("/home.html");
        throw new Error("Inventory permission required");
    }

    return context;
}
