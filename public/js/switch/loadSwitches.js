import { db } from "../firebase-config.js?v=20260928-viewer2";

import {
    collection,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

function ipToNumber(ip) {
    if (!ip) {
        return 0;
    }

    return ip.split(".").reduce((value, octet) => {
        const number = Number.parseInt(octet, 10);
        return Number.isNaN(number) ? value : (value * 256) + number;
    }, 0);
}

function createCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value || "-";
    return cell;
}

function formatDate(value) {
    const date = value?.toDate instanceof Function
        ? value.toDate()
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleString("th-TH", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function createActionButton(label, className, title, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-sm ${className}`;
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", handler);
    return button;
}

function createDeviceRow(data, onEdit, onDelete, canEdit, publicGuest) {
    const row = document.createElement("tr");

    row.appendChild(createCell(publicGuest ? "Network Switch" : data.name));
    row.appendChild(createCell(data.brand));
    row.appendChild(createCell(data.model));

    if (canEdit) {
        row.appendChild(createCell(data.ip));
        row.appendChild(createCell(data.mac));
    }

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    const online = data.status === "online";

    statusBadge.className = `badge ${online ? "bg-success" : "bg-danger"}`;
    statusBadge.textContent = online ? "online" : "offline";
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);
    row.appendChild(createCell(formatDate(data.lastSeen)));

    const detailCell = document.createElement("td");
    if (publicGuest) {
        detailCell.textContent = "-";
    } else {
        const detailLink = document.createElement("a");

        detailLink.href = `device.html?id=${encodeURIComponent(data.id)}`;
        detailLink.className = "btn btn-success btn-sm";
        detailLink.textContent = "Open";
        detailCell.appendChild(detailLink);
    }
    row.appendChild(detailCell);

    const actionCell = document.createElement("td");
    const actionGroup = document.createElement("div");

    actionGroup.className = "action-group";
    if (canEdit) {
        actionGroup.appendChild(
            createActionButton("Edit", "btn-warning", "Edit", () => onEdit(data.id))
        );
        actionGroup.appendChild(
            createActionButton("Delete", "btn-danger", "Delete", () => onDelete(data.id))
        );
    } else {
        const readOnlyLabel = document.createElement("span");
        readOnlyLabel.className = "text-secondary";
        readOnlyLabel.textContent = publicGuest ? "ข้อมูลสาธารณะ" : "ดูอย่างเดียว";
        actionGroup.appendChild(readOnlyLabel);
    }
    actionCell.appendChild(actionGroup);
    row.appendChild(actionCell);

    return row;
}

function updateCounter(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = String(value);
    }
}

function showTableError(table, columnCount) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = columnCount;
    cell.className = "text-center text-danger";
    cell.textContent = "ไม่สามารถโหลดข้อมูลอุปกรณ์ได้";
    row.appendChild(cell);
    table.replaceChildren(row);
}

export function loadSwitches({
    onEdit,
    onDelete,
    canEdit = false,
    publicGuest = false
}) {
    let publicDevices = [];
    let privateDevices = new Map();
    let publicReady = false;
    let privateReady = !canEdit;
    const columnCount = canEdit ? 9 : 7;

    function render() {
        const table = document.getElementById("switchTable");

        if (!table || !publicReady || !privateReady) {
            return;
        }

        const devices = publicDevices.map((device) => ({
            ...device,
            ...(canEdit ? privateDevices.get(device.id) : {})
        }));

        devices.sort((first, second) => {
            const firstOnline = first.status === "online" ? 1 : 0;
            const secondOnline = second.status === "online" ? 1 : 0;

            if (firstOnline !== secondOnline) {
                return secondOnline - firstOnline;
            }

            return canEdit
                ? ipToNumber(second.ip) - ipToNumber(first.ip)
                : publicGuest
                    ? [first.brand, first.model].join(" ").localeCompare(
                        [second.brand, second.model].join(" "),
                        "th"
                    )
                    : String(first.name || "").localeCompare(
                        String(second.name || ""),
                        "th"
                    );
        });

        const fragment = document.createDocumentFragment();
        let onlineCount = 0;

        devices.forEach((device) => {
            if (device.status === "online") {
                onlineCount += 1;
            }

            fragment.appendChild(
                createDeviceRow(device, onEdit, onDelete, canEdit, publicGuest)
            );
        });

        table.replaceChildren(fragment);

        const totalCount = devices.length;
        const offlineCount = totalCount - onlineCount;
        const availability = totalCount
            ? Math.round((onlineCount / totalCount) * 100)
            : 0;

        updateCounter("switchCount", totalCount);
        updateCounter("onlineCount", onlineCount);
        updateCounter("offlineCount", offlineCount);
        updateCounter("availabilityPercent", `${availability}%`);
    }

    function handleError(error) {
        console.error("Firestore listener failed:", error);

        const table = document.getElementById("switchTable");
        if (table) {
            showTableError(table, columnCount);
        }
    }

    const unsubscribers = [
        onSnapshot(
            collection(db, publicGuest ? "publicSwitches" : "switches"),
            (querySnapshot) => {
                publicDevices = querySnapshot.docs.map((documentSnapshot) => ({
                    id: documentSnapshot.id,
                    ...documentSnapshot.data()
                }));
                publicReady = true;
                render();
            },
            handleError
        )
    ];

    if (canEdit) {
        unsubscribers.push(
            onSnapshot(
                collection(db, "switchPrivate"),
                (querySnapshot) => {
                    privateDevices = new Map(querySnapshot.docs.map((documentSnapshot) => [
                        documentSnapshot.id,
                        documentSnapshot.data()
                    ]));
                    privateReady = true;
                    render();
                },
                handleError
            )
        );
    }

    return () => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
}

function initSearch() {
    const searchBox = document.getElementById("searchBox");

    if (!searchBox) {
        return;
    }

    searchBox.value = "";
    searchBox.setAttribute("autocomplete", "off");

    searchBox.addEventListener("input", () => {
        const keyword = searchBox.value.toLowerCase().trim();

        document.querySelectorAll("#switchTable tr").forEach((row) => {
            row.hidden = !row.textContent.toLowerCase().includes(keyword);
        });
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSearch, { once: true });
} else {
    initSearch();
}
