import { db } from "../firebase-config.js";

import {
    collection,
    onSnapshot
}
from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

function ipToNumber(ip) {

    if (!ip) return 0;

    return ip
        .split(".")
        .reduce(
            (acc, octet) =>
                (acc * 256) + parseInt(octet, 10),
            0
        );
}

export function loadSwitches() {

    onSnapshot(

        collection(db, "switches"),

        (querySnapshot) => {

            const table =
                document.getElementById("switchTable");

            if (!table) return;

            table.innerHTML = "";

            let totalCount = 0;
            let onlineCount = 0;
            let offlineCount = 0;

            window.allSwitches = [];

            const devices = [];

            querySnapshot.forEach((docItem) => {

                    const deviceData = {
                     id: docItem.id,
                    ...docItem.data()
                      };

                devices.push(deviceData);

                window.allSwitches.push(deviceData);

            });

            // ==========================
            // Professional Sorting
            // Online ก่อน
            // Offline หลัง
            // IP มาก → น้อย
            // ==========================

            devices.sort((a, b) => {

                const statusA =
                    a.status === "online" ? 1 : 0;

                const statusB =
                    b.status === "online" ? 1 : 0;

                if (statusA !== statusB) {

                    return statusB - statusA;

                }

                return (
                    ipToNumber(b.ip) -
                    ipToNumber(a.ip)
                );

            });

            devices.forEach((data) => {

                totalCount++;

                if (data.status === "online") {

                    onlineCount++;

                } else {

                    offlineCount++;

                }

                const statusClass =
                    data.status === "online"
                        ? "bg-success"
                        : "bg-danger";

                table.innerHTML += `

                <tr>

                    <td>${data.name || "-"}</td>

                    <td>${data.brand || "-"}</td>

                    <td>${data.model || "-"}</td>

                    <td>${data.ip || "-"}</td>

                    <td>${data.mac || "-"}</td>

                    <td>
                        <span class="badge ${statusClass}">
                            ${data.status || "-"}
                        </span>
                    </td>

                    <td>

                        <a
                            href="device.html?id=${data.id}"
                            class="btn btn-success btn-sm">

                            Open

                        </a>

                    </td>

                        <td>

                                 <div class="action-group">

                                 <button
                                 class="btn btn-warning btn-sm action-btn"
                                 onclick="editDevice('${data.id}')"
                                 title="Edit">
                                    ✏️
                                </button>

                                 <button
                                    class="btn btn-danger btn-sm action-btn"
                                    onclick="deleteDevice('${data.id}')"
                                    title="Delete">
                                    🗑️
                                </button>

                                    </div>

                                    </td>

                                    </tr>

                                    `;

                                    });

            // ==========================
            // Dashboard Summary
            // ==========================

            const availability =
                totalCount > 0
                    ? Math.round(
                        (onlineCount / totalCount) * 100
                    )
                    : 0;

            const switchCount =
                document.getElementById("switchCount");

            const onlineCounter =
                document.getElementById("onlineCount");

            const offlineCounter =
                document.getElementById("offlineCount");

            const availabilityCounter =
                document.getElementById("availabilityPercent");

            if (switchCount)
                switchCount.innerText = totalCount;

            if (onlineCounter)
                onlineCounter.innerText = onlineCount;

            if (offlineCounter)
                offlineCounter.innerText = offlineCount;

            if (availabilityCounter)
                availabilityCounter.innerText =
                    availability + "%";

        },

        (error) => {

            console.error(
                "Firestore Listener Error:",
                error
            );

        }

    );

}

    // ==========================
// SEARCH SWITCH
// ==========================

document.addEventListener("DOMContentLoaded", () => {

    const searchBox =
        document.getElementById("searchBox");

    if (!searchBox) return;

    // ล้างค่าทุกครั้งเมื่อเปิดหน้า
    searchBox.value = "";

    // กัน Chrome Autofill
    searchBox.setAttribute(
        "autocomplete",
        "new-password"
    );

    searchBox.addEventListener(
        "input",
        function () {

            const keyword =
                this.value
                    .toLowerCase()
                    .trim();

            const rows =
                document.querySelectorAll(
                    "#switchTable tr"
                );

            rows.forEach(row => {

                const text =
                    row.textContent
                        .toLowerCase();

                row.style.display =
                    text.includes(keyword)
                        ? ""
                        : "none";

            });

        }
    );

});


loadSwitches();