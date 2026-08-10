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

(function initHomepagePollutantMetadataCarousel() {
  "use strict";

  if (!document.body.classList.contains("home-page")) return;
  const circles = Array.from(document.querySelectorAll(".pollutant-circle"));
  if (!circles.length) return;

  const compactMedia = window.matchMedia("(max-width: 1079px)");
  const mobileMedia = window.matchMedia("(max-width: 767px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const HOLD_MS = 3200;
  const CLEANUP_MS = 320;
  const timers = new Map();
  const cleanupTimers = new Map();

  function metadataNodes(circle) {
    return Array.from(
      circle.querySelectorAll(".pollutant-observed, .pollutant-station, .pollutant-network"),
    );
  }

  function metadataLines(circle) {
    return metadataNodes(circle)
      .filter((line) => !line.hidden && line.textContent.trim());
  }

  function syncMetadataLineBoxes(circle) {
    const lineHeight = mobileMedia.matches ? "2.1em" : "2.25em";
    metadataNodes(circle).forEach((line) => {
      if (line.hidden) return;
      line.style.display = "flex";
      line.style.alignItems = "center";
      line.style.justifyContent = "center";
      line.style.minHeight = lineHeight;
      line.style.height = lineHeight;

      if (line.classList.contains("pollutant-observed")) {
        line.style.flexDirection = "column";
        const time = line.querySelector("time");
        if (time) {
          time.style.display = "block";
          time.style.whiteSpace = "nowrap";
        }
      }
    });
  }

  function clearMetadataLineBoxes(circle) {
    metadataNodes(circle).forEach((line) => {
      line.style.removeProperty("display");
      line.style.removeProperty("align-items");
      line.style.removeProperty("justify-content");
      line.style.removeProperty("min-height");
      line.style.removeProperty("height");
      line.style.removeProperty("flex-direction");

      if (line.classList.contains("pollutant-observed")) {
        const time = line.querySelector("time");
        if (time) {
          time.style.removeProperty("display");
          time.style.removeProperty("white-space");
        }
      }
    });
  }

  function clearLineClasses(circle) {
    metadataNodes(circle)
      .forEach((line) => line.classList.remove("is-meta-current", "is-meta-leaving"));
  }

  function clearCircleTimers(circle) {
    if (timers.has(circle)) {
      window.clearInterval(timers.get(circle));
      timers.delete(circle);
    }
    if (cleanupTimers.has(circle)) {
      window.clearTimeout(cleanupTimers.get(circle));
      cleanupTimers.delete(circle);
    }
  }

  function setDesktopState(circle) {
    clearCircleTimers(circle);
    clearLineClasses(circle);
    clearMetadataLineBoxes(circle);
    circle.classList.remove("pollutant-meta-cycle", "pollutant-meta-static");
  }

  function setStaticState(circle) {
    clearCircleTimers(circle);
    clearLineClasses(circle);
    clearMetadataLineBoxes(circle);
    circle.classList.remove("pollutant-meta-cycle");
    circle.classList.add("pollutant-meta-static");
  }

  function showFirstLine(circle) {
    syncMetadataLineBoxes(circle);
    clearLineClasses(circle);
    const lines = metadataLines(circle);
    if (!lines.length) return;
    lines[0].classList.add("is-meta-current");
  }

  function advanceCircle(circle) {
    if (!compactMedia.matches || document.hidden) return;
    syncMetadataLineBoxes(circle);
    const lines = metadataLines(circle);
    if (!lines.length) {
      clearLineClasses(circle);
      return;
    }

    let currentIndex = lines.findIndex((line) => line.classList.contains("is-meta-current"));
    if (currentIndex < 0) {
      showFirstLine(circle);
      return;
    }
    if (lines.length === 1) return;

    const current = lines[currentIndex];
    const next = lines[(currentIndex + 1) % lines.length];
    current.classList.remove("is-meta-current");
    current.classList.add("is-meta-leaving");
    next.classList.remove("is-meta-leaving");

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        next.classList.add("is-meta-current");
      });
    });

    if (cleanupTimers.has(circle)) window.clearTimeout(cleanupTimers.get(circle));
    cleanupTimers.set(circle, window.setTimeout(() => {
      current.classList.remove("is-meta-leaving");
      cleanupTimers.delete(circle);
    }, CLEANUP_MS));
  }

  function startCircle(circle) {
    clearCircleTimers(circle);
    if (!compactMedia.matches) {
      setDesktopState(circle);
      return;
    }
    if (reducedMotion.matches) {
      setStaticState(circle);
      return;
    }

    circle.classList.remove("pollutant-meta-static");
    circle.classList.add("pollutant-meta-cycle");
    syncMetadataLineBoxes(circle);
    showFirstLine(circle);
    timers.set(circle, window.setInterval(() => advanceCircle(circle), HOLD_MS));
  }

  function syncAll() {
    circles.forEach((circle) => {
      if (document.hidden) {
        clearCircleTimers(circle);
        return;
      }
      startCircle(circle);
    });
  }

  document.addEventListener("visibilitychange", syncAll);
  if (typeof compactMedia.addEventListener === "function") {
    compactMedia.addEventListener("change", syncAll);
    mobileMedia.addEventListener("change", syncAll);
    reducedMotion.addEventListener("change", syncAll);
  } else {
    compactMedia.addListener?.(syncAll);
    mobileMedia.addListener?.(syncAll);
    reducedMotion.addListener?.(syncAll);
  }

  syncAll();
})();

(function initHomepageAreaTableLayout() {
  "use strict";

  if (!document.body.classList.contains("home-page")) return;
  const table = document.querySelector(".dashboard-table--areas");
  if (!table) return;

  const desktopMedia = window.matchMedia("(min-width: 768px)");
  let frame = null;

  const style = document.createElement("style");
  style.id = "ukaq-home-area-table-layout";
  style.textContent = `
    @media (min-width: 768px) {
      .home-page .dashboard-table--areas {
        table-layout: fixed;
      }

      .home-page .dashboard-table--areas .dashboard-table-area-type-col {
        width: var(--area-type-col-width, 220px) !important;
      }

      .home-page .dashboard-table--areas col:not(.dashboard-table-area-type-col) {
        width: auto !important;
      }

      .home-page .dashboard-table--areas thead th:first-child,
      .home-page .dashboard-table--areas tbody th[scope="row"] {
        white-space: nowrap;
      }

      .home-page .dashboard-table--areas .area-reading {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        column-gap: 0.6rem;
        row-gap: 0.32rem;
        max-width: 100%;
        min-width: 0;
      }

      .home-page .dashboard-table--areas .area-reading-name {
        flex: 1 1 auto;
        min-width: 0;
        white-space: nowrap;
        overflow-wrap: normal;
        word-break: normal;
      }

      .home-page .dashboard-table--areas .area-reading-metric {
        flex: 0 0 auto;
        margin-left: auto;
        justify-self: auto;
      }

      .home-page .dashboard-table--areas.is-area-readings-stacked .area-reading {
        flex-direction: column;
        align-items: flex-start;
      }

      .home-page .dashboard-table--areas.is-area-readings-stacked .area-reading-name {
        width: 100%;
        white-space: normal;
        overflow-wrap: break-word;
      }

      .home-page .dashboard-table--areas.is-area-readings-stacked .area-reading-metric {
        margin-left: 0;
        align-self: flex-start;
      }
    }
  `;
  document.head.append(style);

  function textWidth(element) {
    if (!element?.textContent?.trim()) return 0;
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width;
  }

  function measureAreaTypeWidth() {
    const cells = Array.from(table.querySelectorAll(
      "thead th:first-child, tbody th[scope='row']",
    ));
    let widest = 0;
    cells.forEach((cell) => {
      const computed = window.getComputedStyle(cell);
      const padding = Number.parseFloat(computed.paddingLeft)
        + Number.parseFloat(computed.paddingRight);
      widest = Math.max(widest, textWidth(cell) + padding);
    });
    return Math.ceil(widest + 8);
  }

  function needsSharedStack() {
    return Array.from(table.querySelectorAll(".area-reading")).some((reading) => {
      const name = reading.querySelector(".area-reading-name");
      const metric = reading.querySelector(".area-reading-metric");
      if (!name || !metric) return false;
      const computed = window.getComputedStyle(reading);
      const gap = Number.parseFloat(computed.columnGap) || 0;
      const required = textWidth(name) + metric.getBoundingClientRect().width + gap;
      return required > reading.clientWidth + 0.5;
    });
  }

  function syncLayout() {
    frame = null;
    if (!desktopMedia.matches) {
      table.classList.remove("is-area-readings-stacked");
      table.style.removeProperty("--area-type-col-width");
      return;
    }

    table.classList.remove("is-area-readings-stacked");
    table.style.setProperty("--area-type-col-width", `${measureAreaTypeWidth()}px`);
    table.getBoundingClientRect();
    table.classList.toggle("is-area-readings-stacked", needsSharedStack());
  }

  function scheduleLayout() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(syncLayout);
  }

  const observer = new MutationObserver(scheduleLayout);
  observer.observe(table.tBodies[0] || table, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(scheduleLayout);
    resizeObserver.observe(table.parentElement || table);
  } else {
    window.addEventListener("resize", scheduleLayout, { passive: true });
  }

  if (typeof desktopMedia.addEventListener === "function") {
    desktopMedia.addEventListener("change", scheduleLayout);
  } else {
    desktopMedia.addListener?.(scheduleLayout);
  }

  document.fonts?.ready?.then(scheduleLayout);
  scheduleLayout();
})();