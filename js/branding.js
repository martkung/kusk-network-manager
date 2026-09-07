(function () {
  const CREDIT_TEXT = "พัฒนาเว็บโดย นายสมมาตร ฟักประไพ นักวิชาการคอมพิวเตอร์ชำนาญการ";
  const LOGO_SRC = "/logo-kusk.png";

  function makeLogoImage(className) {
    const img = document.createElement("img");
    img.src = LOGO_SRC;
    img.alt = "โลโก้โรงเรียน";
    img.className = className || "kusk-brand-logo-img";
    img.loading = "eager";
    return img;
  }

  function hasSidebarLayout() {
    return Boolean(
      document.querySelector(".sidebar, #sidebar, .sidebar-brand, .sidebar-header, #sidebar-container, aside.sidebar")
    );
  }

  function syncSidebarClass() {
    document.body.classList.toggle("has-kusk-sidebar", hasSidebarLayout());
  }

  function convertMark(mark) {
    if (!mark || mark.dataset.kuskLogoReady === "true") return;
    mark.dataset.kuskLogoReady = "true";
    mark.classList.add("kusk-logo-mark");
    mark.textContent = "";
    mark.appendChild(makeLogoImage("kusk-brand-logo-img"));
  }

  function normalizeImageLogo(img) {
    if (!img || img.dataset.kuskLogoReady === "true") return;
    img.dataset.kuskLogoReady = "true";
    img.src = LOGO_SRC;
    img.alt = img.alt || "โลโก้โรงเรียน";
    img.loading = "eager";
  }

  function normalizeSidebarLogo(logo) {
    if (!logo || logo.dataset.kuskLogoReady === "true") return;
    const label = (logo.textContent || "").trim() || "KUSK";
    logo.dataset.kuskLogoReady = "true";
    logo.classList.add("kusk-sidebar-logo");
    logo.textContent = "";
    logo.appendChild(makeLogoImage("kusk-sidebar-logo-img"));
    const span = document.createElement("span");
    span.className = "kusk-sidebar-logo-text";
    span.textContent = label;
    logo.appendChild(span);
  }

  function removeDuplicatePageLogos() {
    if (!hasSidebarLayout()) return;

    document.querySelectorAll(".main-content .kusk-page-logo, .content .kusk-page-logo, main .kusk-page-logo").forEach(logo => {
      logo.remove();
    });
  }

  function ensurePageLogo() {
    if (hasSidebarLayout()) return;

    if (document.querySelector(".kusk-page-logo, .brand-mark, .manual-logo, img.logo, img.login-logo, .sidebar-logo img, .sidebar .logo img, .sidebar-header img")) {
      return;
    }

    const heading = document.querySelector("main h1, .login-card h1, .login-card h2, .login-box h1, .login-box h2, body > h1");
    if (!heading || heading.dataset.kuskPageLogoInserted === "true") return;

    heading.dataset.kuskPageLogoInserted = "true";
    const logo = document.createElement("div");
    logo.className = "kusk-page-logo";
    logo.appendChild(makeLogoImage("kusk-page-logo-img"));
    heading.parentNode.insertBefore(logo, heading);
  }

  function ensureCredit() {
    let credit = document.getElementById("developerCredit");
    if (!credit) {
      credit = document.createElement("footer");
      credit.id = "developerCredit";
      credit.className = "developer-credit";
    }
    credit.textContent = CREDIT_TEXT;

    const target = document.querySelector(".main-content") ||
      document.querySelector(".content") ||
      document.querySelector(".login-card") ||
      document.querySelector(".login-panel") ||
      document.querySelector(".login-box") ||
      document.querySelector("main") ||
      document.body;

    if (target && credit.parentNode !== target) {
      target.appendChild(credit);
    }
  }

  function applyBranding() {
    document.body.classList.add("has-kusk-branding");
    syncSidebarClass();
    removeDuplicatePageLogos();
    document.querySelectorAll(".brand-mark, .manual-logo").forEach(convertMark);
    document.querySelectorAll("img.logo, img.login-logo, .sidebar-logo img, .sidebar-header img, img[src$='logo.png'], img[src*='assets/logo/logo.png']").forEach(normalizeImageLogo);
    document.querySelectorAll(".sidebar .logo").forEach(normalizeSidebarLogo);
    ensurePageLogo();
    ensureCredit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBranding);
  } else {
    applyBranding();
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      applyBranding();
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();