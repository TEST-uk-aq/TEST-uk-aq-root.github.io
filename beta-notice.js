(function initSharedBetaNotice() {
  "use strict";

  const STORAGE_KEY = "uk-aq-beta-notice-dismissed";
  const LEGACY_STORAGE_KEY = "uk-aq-hex-map-beta-notice-minimised";
  const DISMISSED_VALUE = "true";
  const EXPANDED_VALUE = "false";
  const mounts = Array.from(document.querySelectorAll("[data-ukaq-beta-notice-mount]"));

  function updateFooterGovPill() {
    const pill = document.querySelector(".ukaq-site-footer-gov-pill");
    if (!pill) return;
    pill.textContent = "GOV.UK AURN";
    pill.setAttribute("aria-label", "GOV.UK AURN");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateFooterGovPill, { once: true });
  } else {
    updateFooterGovPill();
  }

  if (!mounts.length) return;

  const safeStorage = (() => {
    try {
      const storage = window.localStorage;
      const testKey = "__ukaq_beta_notice_test__";
      storage.setItem(testKey, "1");
      storage.removeItem(testKey);
      return storage;
    } catch (_) {
      return null;
    }
  })();

  function readDismissed() {
    if (!safeStorage) return false;
    const current = safeStorage.getItem(STORAGE_KEY);
    if (current === DISMISSED_VALUE) return true;
    if (current === EXPANDED_VALUE) return false;
    const legacy = safeStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === DISMISSED_VALUE) {
      safeStorage.setItem(STORAGE_KEY, DISMISSED_VALUE);
      return true;
    }
    return false;
  }

  function writeDismissed(isDismissed) {
    if (!safeStorage) return;
    safeStorage.setItem(STORAGE_KEY, isDismissed ? DISMISSED_VALUE : EXPANDED_VALUE);
  }

  function noticeHtml() {
    return '<section class="ukaq-beta-notice ukaq-beta-notice--expanded" aria-label="Beta data notice">' +
      '<div class="ukaq-beta-notice__header">' +
      '<span class="ukaq-beta-notice__title">Beta notice</span>' +
      '<button type="button" class="ukaq-beta-notice__dismiss" data-ukaq-beta-notice-dismiss aria-expanded="true" aria-label="Dismiss beta notice">Dismiss</button>' +
      '</div>' +
      '<div class="ukaq-beta-notice__body">' +
      'Sensor data shown here is provisional and may change. Do not cite it as official data. For authoritative readings, refer to the source networks: ' +
      '<a href="https://www.breathelondon.org" target="_blank" rel="noopener noreferrer">Breathe London</a>, ' +
      '<a href="https://explore.openaq.org" target="_blank" rel="noopener noreferrer">OpenAQ</a>, ' +
      '<a href="https://sensor.community/en/" target="_blank" rel="noopener noreferrer">Sensor.Community</a>, and ' +
      '<a href="https://uk-air.defra.gov.uk/interactive-map?network=aurn" target="_blank" rel="noopener noreferrer">Gov.UK AURN</a>.' +
      '</div>' +
      '</section>';
  }

  function pillHtml() {
    return '<button type="button" class="ukaq-beta-notice ukaq-beta-notice__pill" data-ukaq-beta-notice-expand aria-expanded="false" aria-label="Expand beta notice">Beta notice</button>';
  }

  function render(isDismissed, focusSelector) {
    mounts.forEach((mount) => {
      mount.innerHTML = isDismissed ? pillHtml() : noticeHtml();
      if (focusSelector) {
        mount.querySelector(focusSelector)?.focus({ preventScroll: true });
      }
    });
  }

  let dismissed = readDismissed();
  render(dismissed);

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-ukaq-beta-notice-dismiss]")) {
      dismissed = true;
      writeDismissed(dismissed);
      render(dismissed, "[data-ukaq-beta-notice-expand]");
    } else if (event.target.closest("[data-ukaq-beta-notice-expand]")) {
      dismissed = false;
      writeDismissed(dismissed);
      render(dismissed, "[data-ukaq-beta-notice-dismiss]");
    }
  });
})();

(function initMobileWhoGuidelineFooter() {
  "use strict";

  const footer = document.querySelector(".home-page .who-card-footer");
  if (!footer || footer.querySelector(".who-guideline-mobile")) return;

  const originalChildren = Array.from(footer.children);
  if (!originalChildren.length) return;

  const desktop = document.createElement("div");
  desktop.className = "who-guideline-desktop";
  originalChildren.forEach((child) => desktop.appendChild(child));

  const mobile = document.createElement("div");
  mobile.className = "who-guideline-mobile";
  mobile.hidden = true;
  mobile.innerHTML = `
    <div class="who-guideline-mobile-header">
      <strong>World Health Organization guideline values <span class="who-guideline-unit">(&micro;g/m<sup>3</sup>)</span></strong>
      <button
        type="button"
        class="who-guideline-info-toggle"
        aria-expanded="false"
        aria-controls="who-guideline-mobile-note"
        aria-label="Show note about WHO guideline values"
      >
        <img src="/images/Info-Icon-alpha.svg" alt="" aria-hidden="true">
      </button>
    </div>
    <table class="who-guideline-table">
      <caption class="sr-only">World Health Organization air quality guideline values in micrograms per cubic metre</caption>
      <thead>
        <tr>
          <th scope="col">Pollutant</th>
          <th scope="col">Daily</th>
          <th scope="col">Yearly</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">PM2.5</th>
          <td>15</td>
          <td>5</td>
        </tr>
        <tr>
          <th scope="row">PM10</th>
          <td>45</td>
          <td>15</td>
        </tr>
        <tr>
          <th scope="row">NO<sub>2</sub></th>
          <td>25</td>
          <td>10</td>
        </tr>
      </tbody>
    </table>
    <div class="who-guideline-mobile-note" id="who-guideline-mobile-note" role="note" hidden>
      <strong>Note:</strong> Daily averages use GMT days from midnight to midnight. &ldquo;Above guideline&rdquo; means above WHO health-based guidelines, not UK legal limits.
    </div>
  `;

  footer.replaceChildren(desktop, mobile);

  const toggle = mobile.querySelector(".who-guideline-info-toggle");
  const note = mobile.querySelector(".who-guideline-mobile-note");
  const mobileMedia = window.matchMedia("(max-width: 767px)");

  function setNoteOpen(open) {
    note.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "Hide note about WHO guideline values" : "Show note about WHO guideline values",
    );
  }

  function syncViewport() {
    const isMobile = mobileMedia.matches;
    desktop.hidden = isMobile;
    mobile.hidden = !isMobile;
    if (!isMobile) setNoteOpen(false);
  }

  toggle.addEventListener("click", () => {
    setNoteOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  syncViewport();
  if (typeof mobileMedia.addEventListener === "function") {
    mobileMedia.addEventListener("change", syncViewport);
  } else {
    mobileMedia.addListener?.(syncViewport);
  }
})();
