async function fetchHtml(path) {
    const response = await fetch(path, { credentials: "same-origin" });

    if (!response.ok) {
        throw new Error(`Unable to load ${path}: ${response.status}`);
    }

    return response.text();
}

async function loadSidebar() {
    const sidebarContainer = document.getElementById("sidebar-container");

    if (!sidebarContainer) {
        return;
    }

    sidebarContainer.innerHTML = await fetchHtml("/components/sidebar.html");
    initMobileMenu();
    initLogout();
}

async function loadModal() {
    const modalContainer = document.getElementById("modal-container");

    if (!modalContainer) {
        return;
    }

    modalContainer.innerHTML = await fetchHtml("/components/device-modal.html");
    document.dispatchEvent(new CustomEvent("device-modal:ready"));
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await Promise.all([
            loadSidebar(),
            loadModal()
        ]);
        await loadUserInfo();
    } catch (error) {
        console.error("Unable to initialize shared UI:", error);
    }
});

function initMobileMenu() {
    const menuButton = document.getElementById("menuBtn");
    const sidebar = document.getElementById("sidebar");

    if (!menuButton || !sidebar) {
        return;
    }

    menuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        sidebar.classList.toggle("show");
    });

    document.addEventListener("click", (event) => {
        if (!sidebar.contains(event.target)) {
            sidebar.classList.remove("show");
        }
    });
}

async function loadUserInfo() {
    try {
        const {
            canViewInventory,
            canManageUsers,
            getOptionalUserContext,
            getRoleLabel
        } = await import("/js/permissions.js?v=20260928-viewer2");
        const context = await getOptionalUserContext();
        const emailBox = document.getElementById("userEmail");
        const roleBox = document.getElementById("userRole");
        const usersNavItem = document.getElementById("usersNavItem");
        const inventoryNavItems = document.querySelectorAll("[data-requires-inventory]");
        const authenticatedNavItems = document.querySelectorAll("[data-requires-auth]");
        const logoutButton = document.getElementById("logoutBtn");

        if (!context.user) {
            if (emailBox) {
                emailBox.textContent = "ผู้เยี่ยมชม";
            }

            if (roleBox) {
                roleBox.textContent = getRoleLabel("guest");
            }

            inventoryNavItems.forEach((item) => {
                item.hidden = false;
            });

            if (logoutButton) {
                logoutButton.href = "/login.html?signin=1";
                logoutButton.dataset.mode = "login";
                logoutButton.textContent = "🔐 เข้าสู่ระบบ";
            }

            return;
        }

        if (emailBox) {
            emailBox.textContent = context.user.email || "ไม่พบอีเมล";
        }

        if (roleBox) {
            roleBox.textContent = getRoleLabel(context.role);
        }

        if (usersNavItem && canManageUsers(context.role)) {
            usersNavItem.hidden = false;
        }

        if (canViewInventory(context.role)) {
            inventoryNavItems.forEach((item) => {
                item.hidden = false;
            });
            const monitoringNavItem = document.getElementById("monitoringNavItem");
            if (monitoringNavItem) { monitoringNavItem.hidden = false; }
            const { watchIncidentSummary } = await import("/js/incident-summary.js");
            watchIncidentSummary();
        }

        authenticatedNavItems.forEach((item) => {
            item.hidden = false;
        });
    } catch (error) {
        console.error("Unable to load user information:", error);
    }
}

function initLogout() {
    const logoutButton = document.getElementById("logoutBtn");

    if (!logoutButton) {
        return;
    }

    logoutButton.addEventListener("click", async (event) => {
        if (logoutButton.dataset.mode === "login") {
            return;
        }

        event.preventDefault();

        try {
            const { auth } = await import("/js/firebase-config.js?v=20260928-viewer2");
            const { signOut } = await import(
                "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js"
            );

            await signOut(auth);
            window.location.replace("/home.html");
        } catch (error) {
            console.error("Logout failed:", error);
            alert("ออกจากระบบไม่สำเร็จ");
        }
    });
}
