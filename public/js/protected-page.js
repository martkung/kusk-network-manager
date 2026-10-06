import {
    canEditDevices,
    canManageUsers,
    getCurrentUserContext
} from "./permissions.js?v=20260928-viewer2";

const context = await getCurrentUserContext();

if (!canEditDevices(context.role)) {
    document.querySelectorAll("[data-requires-edit]").forEach((element) => {
        element.hidden = true;
    });
}

if (!canManageUsers(context.role)) {
    document.querySelectorAll("[data-requires-admin]").forEach((element) => {
        element.hidden = true;
    });
}

document.dispatchEvent(new CustomEvent("permissions:ready", {
    detail: context
}));
