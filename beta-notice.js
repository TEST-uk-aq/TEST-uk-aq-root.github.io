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

(function initWhoGuidelineReference() {
  "use strict";

  const footer = document.querySelector(".home-page .who-card-footer");
  if (!footer || footer.querySelector(".who-guideline-reference-v2")) return;

  const reference = document.createElement("div");
  reference.className = "who-guideline-reference-v2";
  reference.innerHTML = `
    <div class="who-guideline-heading-v2">
      <strong>World Health Organization guideline values <span class="who-guideline-unit-v2">(&micro;g/m<sup>3</sup>)</span></strong>
      <button
        type="button"
        class="who-guideline-info-toggle-v2"
        aria-expanded="false"
        aria-controls="who-guideline-note-v2"
        aria-label="Show note about WHO guideline values"
      >
        <img src="/images/Info-Icon-alpha.svg" alt="" aria-hidden="true">
      </button>
    </div>
    <table class="who-guideline-table-v2">
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
    <div class="who-guideline-note-v2" id="who-guideline-note-v2" role="note">
      <strong>Note:</strong> Daily averages use GMT days from midnight to midnight. &ldquo;Above guideline&rdquo; means above WHO health-based guidelines, not UK legal limits.
    </div>
  `;

  footer.replaceChildren(reference);
  footer.style.background = "#fff";
  reference.querySelectorAll(".who-guideline-table-v2 thead th").forEach((cell) => {
    cell.style.background = "#edf6fd";
  });

  const heading = reference.querySelector(".who-guideline-heading-v2");
  const toggle = reference.querySelector(".who-guideline-info-toggle-v2");
  const note = reference.querySelector(".who-guideline-note-v2");
  const mobileMedia = window.matchMedia("(max-width: 767px)");
  let noteOpen = false;

  function syncNoteTop() {
    if (!heading) return;
    reference.style.setProperty("--who-guideline-note-top", `${heading.offsetHeight + 6}px`);
  }

  function setNoteOpen(open) {
    noteOpen = Boolean(open && mobileMedia.matches);
    reference.classList.toggle("who-guideline-note-open-v2", noteOpen);
    toggle.setAttribute("aria-expanded", String(noteOpen));
    toggle.setAttribute(
      "aria-label",
      noteOpen ? "Hide note about WHO guideline values" : "Show note about WHO guideline values",
    );
    note.hidden = mobileMedia.matches ? !noteOpen : false;
    if (noteOpen) syncNoteTop();
  }

  function closeNote() {
    if (noteOpen) setNoteOpen(false);
  }

  function syncViewport() {
    noteOpen = false;
    reference.classList.remove("who-guideline-note-open-v2");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Show note about WHO guideline values");
    note.hidden = mobileMedia.matches;
    syncNoteTop();
  }

  toggle.addEventListener("click", () => {
    setNoteOpen(!noteOpen);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!noteOpen) return;
    if (toggle.contains(event.target) || note.contains(event.target)) return;
    closeNote();
  });

  document.addEventListener("focusin", (event) => {
    if (!noteOpen) return;
    if (toggle.contains(event.target) || note.contains(event.target)) return;
    closeNote();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNote();
  });

  document.addEventListener("scroll", closeNote, { passive: true, capture: true });
  window.addEventListener("resize", () => {
    closeNote();
    syncNoteTop();
  }, { passive: true });
  window.addEventListener("orientationchange", closeNote, { passive: true });
  document.addEventListener("visibilitychange", closeNote);

  syncViewport();
  if (typeof mobileMedia.addEventListener === "function") {
    mobileMedia.addEventListener("change", syncViewport);
  } else {
    mobileMedia.addListener?.(syncViewport);
  }
})();

(function initHomepageNetworkDefaults() {
  "use strict";

  if (!document.body.classList.contains("home-page")) return;
  const list = document.getElementById("network-picker-list");
  const keepOneButton = document.getElementById("network-picker-clear-all");
  if (!list) return;

  const preferredCodes = new Set(["gov_uk_aurn", "breathelondon"]);
  let defaultsApplied = false;
  let observer = null;

  if (keepOneButton) {
    keepOneButton.setAttribute("aria-label", "Keep one network selected");
    keepOneButton.title = "Keep one network selected";
  }

  function applyPreferredDefaults() {
    if (defaultsApplied) return;
    const inputs = Array.from(list.querySelectorAll('input[type="checkbox"]'));
    if (!inputs.length) return;

    const preferredInputs = inputs.filter((input) => preferredCodes.has(input.value));
    if (!preferredInputs.length) {
      defaultsApplied = true;
      observer?.disconnect();
      return;
    }

    const missingPreferred = preferredInputs.find((input) => !input.checked);
    if (missingPreferred) {
      missingPreferred.checked = true;
      missingPreferred.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const extraSelected = inputs.find(
      (input) => input.checked && !preferredCodes.has(input.value),
    );
    if (extraSelected) {
      extraSelected.checked = false;
      extraSelected.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    defaultsApplied = true;
    observer?.disconnect();
  }

  observer = new MutationObserver(() => {
    queueMicrotask(applyPreferredDefaults);
  });
  observer.observe(list, { childList: true, subtree: true });
  applyPreferredDefaults();
})();

(function initHexMapKeepOneNetwork() {
  "use strict";

  if (!document.body.classList.contains("hex-map-page")) return;
  const list = document.getElementById("network-list");
  const keepOneButton = document.getElementById("network-deselect-all");
  if (!list || !keepOneButton) return;

  keepOneButton.setAttribute("aria-label", "Keep one network selected");
  keepOneButton.title = "Keep one network selected";

  function networkInputs() {
    return Array.from(list.querySelectorAll('input[type="checkbox"]'));
  }

  function syncKeepOneState() {
    const inputs = networkInputs();
    const selectedCount = inputs.filter((input) => input.checked).length;
    keepOneButton.disabled = !inputs.length || selectedCount <= 1;
  }

  document.addEventListener("change", (event) => {
    const input = event.target instanceof HTMLInputElement
      ? event.target.closest('#network-list input[type="checkbox"]')
      : null;
    if (!input) return;
    const inputs = networkInputs();
    if (!inputs.some((candidate) => candidate.checked)) {
      input.checked = true;
    }
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("#network-deselect-all")
      : null;
    if (target !== keepOneButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const inputs = networkInputs();
    const selected = inputs.filter((input) => input.checked);
    if (selected.length <= 1) {
      syncKeepOneState();
      return;
    }

    const changed = selected.slice(1);
    changed.forEach((input) => {
      input.checked = false;
    });
    changed[0].dispatchEvent(new Event("change", { bubbles: true }));
    syncKeepOneState();
  }, true);

  window.addEventListener("networkselectionchange", syncKeepOneState);
  const observer = new MutationObserver(syncKeepOneState);
  observer.observe(list, { childList: true, subtree: true });
  syncKeepOneState();
})();
