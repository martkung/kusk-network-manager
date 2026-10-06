import { db } from "./firebase-config.js?v=20260928-viewer2";
import {
    OWNER_UID,
    ROLES,
    assignableRoles,
    canAssignRole,
    getRoleLabel,
    requireUserManager
} from "./permissions.js?v=20260928-viewer2";

import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const actorContext = await requireUserManager();
const tableBody = document.getElementById("usersTable");
const statusText = document.getElementById("usersStatus");
const searchInput = document.getElementById("userSearch");
const editRoleSelect = document.getElementById("editRoleSelect");
const editRoleDescription = document.getElementById("editRoleDescription");
const editRoleError = document.getElementById("editRoleError");
const saveRoleButton = document.getElementById("saveRoleButton");
const newUserRole = document.getElementById("newUserRole");
const addUserError = document.getElementById("addUserError");
const addUserButton = document.getElementById("addUserButton");
const editModal = window.bootstrap.Modal.getOrCreateInstance(
    document.getElementById("editRoleModal")
);
const addModal = window.bootstrap.Modal.getOrCreateInstance(
    document.getElementById("addUserModal")
);

let profiles = [];
let selectedProfile = null;

function effectiveRole(profile) {
    const role = profile.id === OWNER_UID
        ? "owner"
        : (profile.role || "default");

    return Object.hasOwn(ROLES, role) ? role : "default";
}

function formatDate(value) {
    if (!value || typeof value.toDate !== "function") {
        return "-";
    }

    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(value.toDate());
}

function initialsFor(profile) {
    const source = profile.displayName || profile.email || profile.id;
    return source.trim().slice(0, 2).toUpperCase();
}

function appendText(parent, tagName, text, className = "") {
    const element = document.createElement(tagName);
    element.textContent = text;

    if (className) {
        element.className = className;
    }

    parent.appendChild(element);
    return element;
}

function profileCanBeEdited(profile) {
    const targetRole = effectiveRole(profile);
    return assignableRoles(actorContext.role).some((nextRole) => (
        canAssignRole(actorContext.role, targetRole, nextRole)
    ));
}

function createProfileRow(profile) {
    const row = document.createElement("tr");
    const accountCell = document.createElement("td");
    const account = document.createElement("div");
    const avatar = document.createElement("span");
    const identity = document.createElement("div");
    const role = effectiveRole(profile);

    account.className = "user-account";
    avatar.className = "user-avatar";
    avatar.textContent = initialsFor(profile);
    appendText(
        identity,
        "strong",
        profile.displayName || profile.email || "ไม่ระบุชื่อ"
    );
    appendText(identity, "span", profile.email || "ยังไม่มีอีเมล");
    account.append(avatar, identity);
    accountCell.appendChild(account);
    row.appendChild(accountCell);

    const uidCell = document.createElement("td");
    const uidCode = appendText(uidCell, "code", profile.id, "uid-code");
    uidCode.title = profile.id;
    row.appendChild(uidCell);

    const roleCell = document.createElement("td");
    appendText(
        roleCell,
        "span",
        getRoleLabel(role),
        "role-badge role-badge-" + role
    );
    row.appendChild(roleCell);

    appendText(
        row,
        "td",
        formatDate(profile.roleUpdatedAt),
        "updated-cell"
    );

    const actionCell = document.createElement("td");
    actionCell.className = "text-end";

    if (profileCanBeEdited(profile)) {
        const editButton = appendText(
            actionCell,
            "button",
            "แก้ไขสิทธิ์",
            "btn btn-outline-light btn-sm"
        );
        editButton.type = "button";
        editButton.addEventListener("click", () => openEditModal(profile));
    } else {
        appendText(
            actionCell,
            "span",
            role === "owner" ? "บัญชีผู้ดูแลหลัก" : "ไม่มีสิทธิ์แก้ไข",
            "updated-cell"
        );
    }

    row.appendChild(actionCell);
    return row;
}

function updateSummary() {
    const counts = {
        owner: 0,
        admin: 0,
        editor: 0,
        viewer: 0,
        default: 0
    };

    profiles.forEach((profile) => {
        counts[effectiveRole(profile)] += 1;
    });

    Object.entries(counts).forEach(([role, count]) => {
        const counter = document.getElementById(role + "Count");
        if (counter) {
            counter.textContent = String(count);
        }
    });

    document.getElementById("accountCount").textContent =
        String(profiles.length) + " บัญชี";
}

function renderProfiles() {
    const keyword = searchInput.value.trim().toLowerCase();
    const visibleProfiles = profiles.filter((profile) => {
        const searchable = [
            profile.id,
            profile.email,
            profile.displayName,
            getRoleLabel(effectiveRole(profile))
        ].join(" ").toLowerCase();

        return searchable.includes(keyword);
    });

    const fragment = document.createDocumentFragment();

    visibleProfiles.forEach((profile) => {
        fragment.appendChild(createProfileRow(profile));
    });

    if (!visibleProfiles.length) {
        const row = document.createElement("tr");
        const cell = appendText(
            row,
            "td",
            keyword ? "ไม่พบบัญชีที่ค้นหา" : "ยังไม่มีบัญชีผู้ใช้งาน",
            "users-empty"
        );
        cell.colSpan = 5;
        fragment.appendChild(row);
    }

    tableBody.replaceChildren(fragment);
    statusText.textContent = "แสดง " + String(visibleProfiles.length) +
        " จาก " + String(profiles.length) + " บัญชี";
}

function fillRoleOptions(select, roles, selectedRole) {
    const fragment = document.createDocumentFragment();

    roles.forEach((role) => {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = getRoleLabel(role);
        option.selected = role === selectedRole;
        fragment.appendChild(option);
    });

    select.replaceChildren(fragment);
}

function updateRoleDescription() {
    const role = editRoleSelect.value;
    editRoleDescription.textContent = ROLES[role]?.description || "";
}

function openEditModal(profile) {
    selectedProfile = profile;
    editRoleError.textContent = "";
    document.getElementById("editUserIdentity").textContent =
        (profile.displayName || profile.email || profile.id) +
        (profile.email ? " · " + profile.email : "");
    fillRoleOptions(
        editRoleSelect,
        assignableRoles(actorContext.role),
        effectiveRole(profile)
    );
    updateRoleDescription();
    editModal.show();
}

async function saveSelectedRole() {
    if (!selectedProfile) {
        return;
    }

    const nextRole = editRoleSelect.value;
    const currentRole = effectiveRole(selectedProfile);

    if (!canAssignRole(actorContext.role, currentRole, nextRole)) {
        editRoleError.textContent = "คุณไม่มีสิทธิ์กำหนดระดับนี้";
        return;
    }

    saveRoleButton.disabled = true;
    editRoleError.textContent = "";

    try {
        await updateDoc(doc(db, "users", selectedProfile.id), {
            role: nextRole,
            roleUpdatedAt: serverTimestamp(),
            roleUpdatedBy: actorContext.user.uid
        });
        editModal.hide();
    } catch (error) {
        console.error("Unable to update role:", error);
        editRoleError.textContent = "บันทึกสิทธิ์ไม่สำเร็จ กรุณาลองใหม่";
    } finally {
        saveRoleButton.disabled = false;
    }
}

function resetAddForm() {
    document.getElementById("newUserUid").value = "";
    document.getElementById("newUserEmail").value = "";
    document.getElementById("newUserName").value = "";
    addUserError.textContent = "";
    fillRoleOptions(
        newUserRole,
        assignableRoles(actorContext.role),
        "default"
    );
}

async function addUserByUid() {
    const uid = document.getElementById("newUserUid").value.trim();
    const emailInput = document.getElementById("newUserEmail");
    const email = emailInput.value.trim().toLowerCase();
    const displayName = document.getElementById("newUserName").value.trim();
    const role = newUserRole.value;

    addUserError.textContent = "";

    if (!uid || uid.length > 128 || uid.includes("/")) {
        addUserError.textContent = "กรุณากรอก UID ให้ถูกต้อง";
        return;
    }

    if (email && !emailInput.checkValidity()) {
        addUserError.textContent = "รูปแบบอีเมลไม่ถูกต้อง";
        return;
    }

    if (!canAssignRole(actorContext.role, "default", role)) {
        addUserError.textContent = "คุณไม่มีสิทธิ์กำหนดระดับนี้";
        return;
    }

    addUserButton.disabled = true;

    try {
        const profileReference = doc(db, "users", uid);
        const existingProfile = await getDoc(profileReference);

        if (existingProfile.exists()) {
            addUserError.textContent = "UID นี้มีอยู่ในรายการแล้ว";
            return;
        }

        await setDoc(profileReference, {
            email,
            displayName,
            photoURL: "",
            role,
            createdAt: serverTimestamp(),
            roleUpdatedAt: serverTimestamp(),
            roleUpdatedBy: actorContext.user.uid
        });
        addModal.hide();
    } catch (error) {
        console.error("Unable to add user profile:", error);
        addUserError.textContent = "เพิ่มบัญชีไม่สำเร็จ กรุณาตรวจสอบ UID";
    } finally {
        addUserButton.disabled = false;
    }
}

editRoleSelect.addEventListener("change", updateRoleDescription);
saveRoleButton.addEventListener("click", saveSelectedRole);
searchInput.addEventListener("input", renderProfiles);
addUserButton.addEventListener("click", addUserByUid);
document.getElementById("openAddUserButton").addEventListener("click", () => {
    resetAddForm();
    addModal.show();
});

fillRoleOptions(
    newUserRole,
    assignableRoles(actorContext.role),
    "default"
);

const unsubscribe = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
        profiles = snapshot.docs
            .map((documentSnapshot) => ({
                id: documentSnapshot.id,
                ...documentSnapshot.data()
            }))
            .sort((first, second) => {
                const firstRole = effectiveRole(first);
                const secondRole = effectiveRole(second);
                const order = ["owner", "admin", "editor", "viewer", "default"];
                const roleDifference =
                    order.indexOf(firstRole) - order.indexOf(secondRole);

                if (roleDifference !== 0) {
                    return roleDifference;
                }

                return (first.email || first.id).localeCompare(
                    second.email || second.id
                );
            });

        updateSummary();
        renderProfiles();
    },
    (error) => {
        console.error("Unable to load user profiles:", error);
        statusText.textContent = "โหลดข้อมูลผู้ใช้งานไม่สำเร็จ";
        tableBody.replaceChildren();
    }
);

window.addEventListener("beforeunload", unsubscribe, { once: true });
