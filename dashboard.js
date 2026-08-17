(() => {
  "use strict";

  const pollutantDomain = window.UkAqPollutants;
  const networkCatalogClient = window.UkAqNetworkCatalog;
  if (!pollutantDomain?.definitions || !networkCatalogClient?.load) {
    throw new Error("UK AQ shared domain/data modules must load before the dashboard.");
  }
  const POLLUTANTS = pollutantDomain.definitions.map((definition) => ({
    key: definition.key,
    label: definition.typographicLabel,
    html: definition.htmlLabel,
  }));
  const FALLBACK_NETWORKS = [
    { code: "gov_uk_aurn", label: "GOV.UK AURN" },
    { code: "breathelondon", label: "Breathe London" },
    { code: "sensorcommunity", label: "Sensor.Community" },
  ];
  const PREFERRED_INITIAL_NETWORK_CODES = new Set(["gov_uk_aurn", "breathelondon"]);
  const DASHBOARD_ACTIVE_WINDOW_HOURS = 6;
  const DASHBOARD_ACTIVE_WINDOW = `${DASHBOARD_ACTIVE_WINDOW_HOURS}h`;
  const DASHBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  let networkCatalog = [...FALLBACK_NETWORKS];
  const selectedNetworks = new Set(FALLBACK_NETWORKS.map(({ code }) => code));
  let hasInitializedNetworkSelection = false;
  const networkLabels = new Map(FALLBACK_NETWORKS.map(({ code, label }) => [code, label]));
  const areaNames = { pcon: new Map(), la: new Map() };
  const dashboard = document.querySelector(".readings-dashboard");
  const areaReadingsTable = document.querySelector(".dashboard-table--areas");
  const networkPicker = document.getElementById("home-network-picker");
  const networkPickerButton = document.getElementById("network-picker-button");
  const networkPickerButtonText = document.getElementById("network-picker-button-text");
  const networkPickerPanel = document.getElementById("network-picker-panel");
  const networkPickerCount = document.getElementById("network-picker-count");
  const networkPickerList = document.getElementById("network-picker-list");
  const networkPickerSelectAll = document.getElementById("network-picker-select-all");
  const networkPickerClearAll = document.getElementById("network-picker-clear-all");
  const dashboardWindowSubtitle = document.getElementById("dashboard-window-subtitle");
  const networkPickerFooter = document.getElementById("network-picker-footer");
  const activeSensorsCaption = document.getElementById("active-sensors-caption");
  const statusEl = document.getElementById("dashboard-status");
  const updatedEl = document.getElementById("dashboard-updated");
  const refreshButton = document.getElementById("dashboard-refresh");
  const debugEnabled = parseBooleanFlag(
    typeof WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER === "string"
      ? WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER
      : "",
  );
  const cacheBaseUrl = resolveCacheBaseUrl(
    new URLSearchParams(window.location.search).get("cache_base"),
  );
  const rowsByPollutant = new Map();
  const capabilityRowsByPollutant = new Map();
  let dashboardLoadedAt = null;
  let hasCompletedDashboardRequestCycle = false;
  let dashboardRefreshInFlight = null;
  let dashboardRefreshTimeout = null;
  let fitValuesFrame = null;
  let fitValuesTimer = null;
  let areaLayoutFrame = null;
  let lastAreaTableObservedWidth = null;

  if (networkPickerClearAll) {
    networkPickerClearAll.setAttribute("aria-label", "Keep one network selected");
    networkPickerClearAll.title = "Keep one network selected";
  }

  function parseBooleanFlag(value) {
    return /^(1|true|yes|on)$/i.test(String(value || "").trim());
  }

  function debugLog(...args) {
    if (debugEnabled) console.debug("[UK AQ dashboard]", ...args);
  }

  function applyDashboardWindowCopy() {
    dashboardWindowSubtitle.textContent =
      `Latest readings from sensors active in the last ${DASHBOARD_ACTIVE_WINDOW_HOURS} hours.`;
    networkPickerFooter.textContent =
      `Counts are active sensors in the last ${DASHBOARD_ACTIVE_WINDOW_HOURS} hours.`;
    activeSensorsCaption.textContent =
      `Active sensor counts by network and pollutant in the last ${DASHBOARD_ACTIVE_WINDOW_HOURS} hours`;
  }

  function resolveCacheBaseUrl(rawValue) {
    const explicit = String(rawValue || "").trim();
    if (explicit) return explicit.replace(/\/+$/, "");
    if (/^https?:$/.test(window.location.protocol)) {
      return `${window.location.origin.replace(/\/$/, "")}/api/aq`;
    }
    return "https://cic-test.chronicillnesschannel.co.uk/api/aq";
  }

  function endpoint(path, pollutant, windowLabel = DASHBOARD_ACTIVE_WINDOW) {
    const url = new URL(`${cacheBaseUrl}/${path}`);
    url.searchParams.set("pollutant", pollutant);
    url.searchParams.set("window", windowLabel);
    url.searchParams.set("scope", "all");
    url.searchParams.set("limit", "10000");
    url.searchParams.set("caller", "homepage");
    return url;
  }

  async function fetchCacheApi(input, init = {}, retryOnAuthFailure = true) {
    if (window.ukAqSharedAuth?.fetchCacheApi) {
      return window.ukAqSharedAuth.fetchCacheApi(input, init, retryOnAuthFailure);
    }
    if (window.ukAqFetchCacheApi) {
      return window.ukAqFetchCacheApi(input, init, retryOnAuthFailure);
    }
    return fetch(input, { ...init, credentials: "include" });
  }

  async function fetchRows(pollutant, windowLabel = DASHBOARD_ACTIVE_WINDOW) {
    const response = await fetchCacheApi(endpoint("latest-snapshot", pollutant, windowLabel), {
      credentials: "include",
    });
    if (!response.ok) throw new Error(`Latest ${pollutant} request failed: ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => ({ ...row, _pollutant: pollutant }));
  }

  async function fetchNetworkCatalog() {
    const rows = await networkCatalogClient.load({
      url: `${cacheBaseUrl}/networks`,
      fetchApi: fetchCacheApi,
      init: { credentials: "include" },
      requirePublicDisplayEnabled: true,
    });
    return rows.map((row) => ({
      code: row.code,
      label: row.label,
      type: row.network_type,
    }));
  }

  async function fetchAreaNames() {
    const [pconResponse, laResponse] = await Promise.all([
      fetch("/data/PCON/uk-constituencies-2023.hexjson"),
      fetch("/data/LAD/uk_aq_la_hex_2025.geojson"),
    ]);
    if (!pconResponse.ok) throw new Error(`PCON names request failed: ${pconResponse.status}`);
    if (!laResponse.ok) throw new Error(`LA names request failed: ${laResponse.status}`);
    const [pconPayload, laPayload] = await Promise.all([
      pconResponse.json(),
      laResponse.json(),
    ]);
    Object.entries(pconPayload?.hexes || {}).forEach(([code, value]) => {
      const name = String(value?.n || "").trim();
      if (code && name) areaNames.pcon.set(code, name);
    });
    (Array.isArray(laPayload?.features) ? laPayload.features : []).forEach((feature) => {
      const code = String(feature?.properties?.la_code || "").trim();
      const name = String(feature?.properties?.la_name || "").trim();
      if (code && name) areaNames.la.set(code, name);
    });
  }

  function numberValue(row) {
    const numeric = Number(
      row?.last_value ?? row?.latest_value ?? row?.value
      ?? row?.observed_value ?? row?.lastValue ?? row?.latestValue,
    );
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    if (row?._pollutant === "pm25" && numeric > 500) return null;
    return numeric;
  }

  function timestamp(row) {
    const value = row?.last_value_at || row?.observed_at || row?.latest_value_at;
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  function observedTimestampValue(row) {
    return row?.observed_at || row?.last_value_at || row?.latest_observed_at
      || row?.reading_observed_at || row?.latest_value_at || null;
  }

  function formatObservedDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).formatToParts(date);
    const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
    const rawZone = part("timeZoneName").toUpperCase();
    const zone = rawZone === "BST" || /(?:GMT|UTC)\+0?1(?::00)?/.test(rawZone)
      ? "BST"
      : "GMT";
    return {
      dateTime: `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`,
      zone,
      iso: date.toISOString(),
    };
  }

  function renderObservedDateTime(container, row) {
    if (!container) return "";

    let time = container.querySelector("time");
    if (!time) {
      time = document.createElement("time");
      container.replaceChildren(document.createTextNode("Observed "), time);
    }

    const formatted = formatObservedDateTime(observedTimestampValue(row));
    if (!formatted) {
      container.hidden = true;
      time.removeAttribute("datetime");
      time.textContent = "";
      return "";
    }
    const zone = document.createElement("span");
    zone.className = "pollutant-observed-zone";
    zone.textContent = formatted.zone;
    time.replaceChildren(document.createTextNode(`${formatted.dateTime} `), zone);
    time.setAttribute("datetime", formatted.iso);
    container.hidden = false;
    return `${formatted.dateTime} ${formatted.zone}`;
  }

  function stationKey(row) {
    return row?.station_id || row?.station?.id || row?.station_ref
      || row?.station?.station_ref || row?.display_name || row?.station?.display_name || null;
  }

  function stationName(row) {
    return row?.display_name || row?.station?.display_name || "Unknown sensor";
  }

  function networkCode(row) {
    return String(row?.network_code || row?.station?.network_code || "").trim();
  }

  function networkLabel(row) {
    return row?.network_label || row?.station?.network_label
      || networkLabels.get(networkCode(row)) || "Unknown network";
  }

  function renderNetworkSummaryLabel(container, label) {
    const original = String(label || "").trim();
    const parts = original.split(".").map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
      container.textContent = original;
      container.removeAttribute("aria-label");
      return;
    }

    const nodes = [];
    parts.forEach((part, index) => {
      if (index > 0) nodes.push(document.createElement("br"));
      nodes.push(document.createTextNode(part));
    });
    container.replaceChildren(...nodes);
    container.setAttribute("aria-label", original);
  }

  function formatValue(value) {
    if (!Number.isFinite(value)) return "No data";
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function fitPollutantValue(valueEl) {
    if (!valueEl) return;
    const circle = valueEl.closest(".pollutant-circle");
    if (!circle || circle.hidden || circle.classList.contains("pollutant-circle--inactive")
      || circle.clientWidth <= 0) return;

    valueEl.style.fontSize = "";
    valueEl.classList.remove("pollutant-value--fitted");
    const originalSize = Number.parseFloat(window.getComputedStyle(valueEl).fontSize);
    if (!Number.isFinite(originalSize) || originalSize <= 0) return;

    const minimumSize = 44;
    const maximumWidth = circle.clientWidth * 0.78;
    let size = originalSize;
    while (valueEl.scrollWidth > maximumWidth && size > minimumSize) {
      size = Math.max(minimumSize, size - 2);
      valueEl.style.fontSize = `${size}px`;
    }
    if (size < originalSize) valueEl.classList.add("pollutant-value--fitted");
  }

  function renderedTextLineCount(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lineTops = [];

    Array.from(range.getClientRects()).forEach((rect) => {
      if (!lineTops.some((top) => Math.abs(top - rect.top) < 1)) {
        lineTops.push(rect.top);
      }
    });

    return lineTops.length;
  }

  function fitPollutantStationName(stationEl) {
    if (!stationEl) return;
    stationEl.style.fontSize = "";

    const circle = stationEl.closest(".pollutant-circle");
    if (!circle || circle.hidden || circle.classList.contains("pollutant-circle--inactive")
      || circle.clientWidth <= 0 || !stationEl.textContent.trim()) return;

    const originalSize = Number.parseFloat(window.getComputedStyle(stationEl).fontSize);
    if (!Number.isFinite(originalSize) || originalSize <= 0) return;

    const minimumSize = Math.max(11, originalSize * 0.68);
    let size = originalSize;

    while (renderedTextLineCount(stationEl) > 2 && size > minimumSize) {
      size = Math.max(minimumSize, size - 0.5);
      stationEl.style.fontSize = `${size}px`;
    }
  }

  function fitAllPollutantValues() {
    document.querySelectorAll(".pollutant-circle:not([hidden]) .pollutant-value")
      .forEach(fitPollutantValue);
    document.querySelectorAll(".pollutant-circle:not([hidden]) .pollutant-station")
      .forEach(fitPollutantStationName);
  }

  function schedulePollutantValueFit() {
    if (fitValuesFrame !== null) window.cancelAnimationFrame(fitValuesFrame);
    fitValuesFrame = window.requestAnimationFrame(() => {
      fitValuesFrame = null;
      fitAllPollutantValues();
    });
  }

  function ensureAreaGroupRows() {
    const body = areaReadingsTable?.tBodies?.[0];
    if (!body) return;

    ["pcon", "la"].forEach((type) => {
      const dataRow = body.querySelector(`tr[data-area-type="${type}"]`);
      if (!dataRow || body.querySelector(`tr[data-area-group="${type}"]`)) return;
      const label = dataRow.cells[0]?.textContent?.trim();
      if (!label) return;

      const groupRow = document.createElement("tr");
      groupRow.className = "area-reading-group-row";
      groupRow.dataset.areaGroup = type;
      const heading = document.createElement("th");
      heading.colSpan = areaReadingsTable.tHead?.rows?.[0]?.cells?.length || 4;
      heading.textContent = label;
      groupRow.append(heading);
      body.insertBefore(groupRow, dataRow);
    });
  }

  function contentBoxWidth(element) {
    if (!element || element.clientWidth <= 0) return 0;
    const styles = window.getComputedStyle(element);
    const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
    return Math.max(0, element.clientWidth - paddingLeft - paddingRight);
  }

  function renderedContentWidth(element) {
    if (!element || !element.textContent.trim()) return 0;
    const range = document.createRange();
    range.selectNodeContents(element);
    const width = range.getBoundingClientRect().width;
    range.detach?.();
    return width;
  }

  function longestUnbrokenWordWidth(element) {
    if (!element || !element.textContent.trim()) return 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let longestWidth = 0;
    let textNode = walker.nextNode();

    while (textNode) {
      const text = textNode.textContent || "";
      const words = text.matchAll(/\S+/g);
      for (const word of words) {
        range.setStart(textNode, word.index);
        range.setEnd(textNode, word.index + word[0].length);
        longestWidth = Math.max(longestWidth, range.getBoundingClientRect().width);
      }
      textNode = walker.nextNode();
    }

    range.detach?.();
    return longestWidth;
  }

  function longestWordFits(element, availableWidth = contentBoxWidth(element)) {
    if (!element || availableWidth <= 0) return true;
    return longestUnbrokenWordWidth(element) <= availableWidth + 1;
  }

  function pollutantCellContentWidth(element) {
    return contentBoxWidth(element?.closest("td"));
  }

  function resetAreaReadingNameFit(nameEl) {
    if (!nameEl) return;
    nameEl.classList.remove(
      "area-reading-name--fit-90",
      "area-reading-name--fit-85",
      "area-reading-name--emergency-wrap",
    );
  }

  function fitAreaReadingName(nameEl) {
    resetAreaReadingNameFit(nameEl);
    if (!nameEl.textContent.trim() || nameEl.clientWidth <= 0 || longestWordFits(nameEl)) return;

    nameEl.classList.add("area-reading-name--fit-90");
    if (longestWordFits(nameEl)) return;

    nameEl.classList.remove("area-reading-name--fit-90");
    nameEl.classList.add("area-reading-name--fit-85");
    if (!longestWordFits(nameEl)) {
      nameEl.classList.add("area-reading-name--emergency-wrap");
    }
  }

  function metricLineWidth(metricEl) {
    if (!metricEl) return 0;
    const markerEl = metricEl.querySelector(".area-marker");
    const valueEl = metricEl.querySelector(".area-reading-value");
    if (!markerEl || !valueEl) return 0;

    const styles = window.getComputedStyle(metricEl);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    const valueWidth = Math.max(
      renderedContentWidth(valueEl),
      valueEl.getBoundingClientRect().width,
    );
    return markerEl.getBoundingClientRect().width + gap + valueWidth;
  }

  function metricLineFits(metricEl, availableWidth = pollutantCellContentWidth(metricEl)) {
    if (!metricEl) return true;
    if (availableWidth <= 0) return true;
    return metricLineWidth(metricEl) <= availableWidth + 1;
  }

  const groupedMetricFitClasses = [
    "area-table--compact",
    "area-table--metric-split",
    "area-table--metric-90",
    "area-table--metric-85",
    "area-table--metric-80",
  ];

  const groupedMetricScaleClasses = [
    "area-table--metric-90",
    "area-table--metric-85",
    "area-table--metric-80",
  ];

  function resetGroupedMetricFit() {
    areaReadingsTable.classList.remove(...groupedMetricFitClasses);
  }

  function groupedMetricLinesFit() {
    const metrics = areaReadingsTable.querySelectorAll(
      "tbody tr[data-area-type] .area-reading-metric",
    );
    return metrics.length > 0 && Array.from(metrics).every((metric) => {
      const availableWidth = pollutantCellContentWidth(metric);
      return availableWidth > 0 && metricLineFits(metric, availableWidth);
    });
  }

  function elementFitsPollutantCell(element, availableWidth) {
    const cell = element?.closest("td");
    if (!cell || availableWidth <= 0) return false;

    const cellRect = cell.getBoundingClientRect();
    const styles = window.getComputedStyle(cell);
    const contentLeft = cellRect.left
      + (Number.parseFloat(styles.borderLeftWidth) || 0)
      + (Number.parseFloat(styles.paddingLeft) || 0);
    const contentRight = contentLeft + availableWidth;
    const rect = element.getBoundingClientRect();

    return rect.left >= contentLeft - 1 && rect.right <= contentRight + 1;
  }

  function splitMetricFits(metric) {
    const markerEl = metric?.querySelector(".area-marker");
    const numberEl = metric?.querySelector(".area-reading-number");
    const unitEl = metric?.querySelector(".area-reading-unit");
    if (!markerEl || !numberEl || !unitEl) return false;

    const availableWidth = pollutantCellContentWidth(metric);
    if (availableWidth <= 0) return false;

    const styles = window.getComputedStyle(metric);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    const markerWidth = markerEl.getBoundingClientRect().width;
    const numberWidth = renderedContentWidth(numberEl);
    const unitWidth = unitEl.hidden ? 0 : renderedContentWidth(unitEl);
    const valueTrackWidth = availableWidth - markerWidth - gap;
    const renderedElements = [metric, markerEl, numberEl];
    if (!unitEl.hidden) renderedElements.push(unitEl);

    return markerWidth + gap + numberWidth <= availableWidth + 1
      && unitWidth <= valueTrackWidth + 1
      && renderedElements.every((element) => (
        elementFitsPollutantCell(element, availableWidth)
      ));
  }

  function groupedSplitMetricsFit() {
    const metrics = areaReadingsTable.querySelectorAll(
      "tbody tr[data-area-type] .area-reading-metric",
    );
    return metrics.length > 0 && Array.from(metrics).every(splitMetricFits);
  }

  function resolveGroupedMetricFit() {
    resetGroupedMetricFit();
    if (groupedMetricLinesFit()) return;

    areaReadingsTable.classList.add("area-table--compact");
    if (groupedMetricLinesFit()) return;

    areaReadingsTable.classList.add("area-table--metric-split");
    if (groupedSplitMetricsFit()) return;

    // Keep the split presentation while scaling. Each scale replaces the
    // previous one; 80% is reached only when the measured 90% and 85%
    // presentations both remain too wide.
    for (const fitClass of groupedMetricScaleClasses) {
      areaReadingsTable.classList.remove(...groupedMetricScaleClasses);
      areaReadingsTable.classList.add(fitClass);
      if (groupedSplitMetricsFit()) return;
    }
  }

  function readingContentFitsCell(reading) {
    const cell = reading?.closest("td");
    if (!cell || cell.clientWidth <= 0) return true;

    const cellStyles = window.getComputedStyle(cell);
    const cellRect = cell.getBoundingClientRect();
    const contentLeft = cellRect.left
      + (Number.parseFloat(cellStyles.borderLeftWidth) || 0)
      + (Number.parseFloat(cellStyles.paddingLeft) || 0);
    const contentRight = cellRect.right
      - (Number.parseFloat(cellStyles.borderRightWidth) || 0)
      - (Number.parseFloat(cellStyles.paddingRight) || 0);
    const contentElements = reading.querySelectorAll(
      ".area-reading-name, .area-reading-metric",
    );

    return Array.from(contentElements).every((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= contentLeft - 1 && rect.right <= contentRight + 1;
    });
  }

  function sideBySideAreaReadingsFit() {
    const readings = areaReadingsTable.querySelectorAll(
      "tbody tr[data-area-type] .area-reading",
    );
    return Array.from(readings).every((reading) => {
      const nameEl = reading.querySelector(".area-reading-name");
      const metricEl = reading.querySelector(".area-reading-metric");
      const availableWidth = pollutantCellContentWidth(reading);
      if (!nameEl || !metricEl || availableWidth <= 0) return true;

      const styles = window.getComputedStyle(reading);
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
      const metricTrackWidth = Math.max(
        metricEl.getBoundingClientRect().width,
        metricLineWidth(metricEl),
      );
      const requiredWidth = longestUnbrokenWordWidth(nameEl) + gap + metricTrackWidth;
      return requiredWidth <= availableWidth + 1
        && metricLineFits(metricEl, availableWidth)
        && readingContentFitsCell(reading);
    });
  }

  function standardAreaTableFits() {
    const areaTypeCells = areaReadingsTable.querySelectorAll(
      'tbody tr[data-area-type] > th:first-child',
    );
    const names = areaReadingsTable.querySelectorAll(
      "tbody tr[data-area-type] .area-reading-name",
    );
    const metrics = areaReadingsTable.querySelectorAll(
      "tbody tr[data-area-type] .area-reading-metric",
    );
    const readings = areaReadingsTable.querySelectorAll(
      "tbody tr[data-area-type] .area-reading",
    );
    return Array.from(areaTypeCells).every((cell) => longestWordFits(cell))
      && Array.from(names).every((name) => longestWordFits(
        name,
        pollutantCellContentWidth(name),
      ))
      && Array.from(metrics).every((metric) => metricLineFits(metric))
      && Array.from(readings).every(readingContentFitsCell);
  }

  function resolveAreaReadingLayout() {
    areaReadingsTable.classList.remove("area-table--stacked");
    if (!sideBySideAreaReadingsFit()) {
      areaReadingsTable.classList.add("area-table--stacked");
    }
  }

  function applyAreaTableLayout() {
    if (!areaReadingsTable) return;
    ensureAreaGroupRows();

    const names = areaReadingsTable.querySelectorAll(".area-reading-name");

    // Restore normal three-row geometry and normal name sizing before every
    // decision so widening can return the complete table to standard mode.
    resetGroupedMetricFit();
    areaReadingsTable.classList.remove(
      "area-table--grouped",
      "area-table--stacked",
    );
    names.forEach(resetAreaReadingNameFit);
    resolveAreaReadingLayout();

    if (!standardAreaTableFits()) {
      areaReadingsTable.classList.add("area-table--grouped");
      resolveAreaReadingLayout();
      resolveGroupedMetricFit();
      names.forEach(fitAreaReadingName);
    }
  }

  function scheduleAreaTableLayout() {
    if (areaLayoutFrame !== null) window.cancelAnimationFrame(areaLayoutFrame);
    areaLayoutFrame = window.requestAnimationFrame(() => {
      areaLayoutFrame = null;
      applyAreaTableLayout();
    });
  }

  function formatDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "—";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(value);
    const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
    return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
  }

  function latestByStation(rows) {
    const latest = new Map();
    rows.forEach((row, index) => {
      const key = stationKey(row) || `unknown-${index}`;
      const existing = latest.get(key);
      const at = timestamp(row);
      if (!existing || (at && (!timestamp(existing) || at > timestamp(existing)))) latest.set(key, row);
    });
    return [...latest.values()];
  }

  function selectedRows(pollutant) {
    const rows = rowsByPollutant.get(pollutant) || [];
    return rows.filter((row) => selectedNetworks.has(networkCode(row)));
  }

  function highestReportingRow(pollutant) {
    return latestByStation(selectedRows(pollutant))
      .filter((candidate) => Number.isFinite(numberValue(candidate)))
      .sort((a, b) => numberValue(b) - numberValue(a))[0] || null;
  }

  function selectedNetworksHavePollutant(pollutant) {
    const rows = capabilityRowsByPollutant.get(pollutant);
    // If the capability request failed, use the safer recent-data wording instead
    // of claiming that the selected networks do not provide the pollutant.
    if (!Array.isArray(rows)) return true;
    return rows.some((row) => selectedNetworks.has(networkCode(row)));
  }

  function selectedNetworkScopeLabel() {
    if (selectedNetworks.size === 1) {
      return networkLabels.get([...selectedNetworks][0]) || "Selected network";
    }
    if (selectedNetworks.size === networkCatalog.length) return "All networks";
    return "Selected networks";
  }

  function severityColour(value, pollutant) {
    if (!Number.isFinite(value)) return "#C8CDD1";
    // Match the hex map's default power-eased scale and pollutant caps.
    const cap = pollutant === "no2" ? 100 : 50;
    const ratio = Math.max(0, Math.min(1, value / cap));
    const base = Math.pow(ratio, 0.8);
    const position = Math.max(0, Math.min(1, base + (0.05 * base * base)));
    const stops = [
      [0, 0, 168, 90], [0.25, 255, 213, 74], [0.5, 255, 155, 58],
      [0.75, 224, 60, 60], [1, 91, 42, 134],
    ];
    const upper = stops.find((stop) => position <= stop[0]) || stops.at(-1);
    const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
    const span = upper[0] - lower[0] || 1;
    const mix = (position - lower[0]) / span;
    const channel = (index) => Math.round(lower[index] + ((upper[index] - lower[index]) * mix));
    return `rgb(${channel(1)}, ${channel(2)}, ${channel(3)})`;
  }

  function renderHighest() {
    POLLUTANTS.forEach((pollutant) => {
      const item = document.querySelector(`.pollutant-item[data-pollutant="${pollutant.key}"]`);
      if (!item) return;
      const row = highestReportingRow(pollutant.key);
      const hasPollutant = selectedNetworksHavePollutant(pollutant.key);
      const value = row ? numberValue(row) : null;
      const circle = item.querySelector(".pollutant-circle");
      const unavailable = item.querySelector(".pollutant-unavailable");
      const scale = item.querySelector(".scale-legend");
      const actionsContainer = item.querySelector(".pollutant-actions");
      const unit = item.querySelector(".pollutant-unit");
      const valueElement = item.querySelector(".pollutant-value");
      const observedElement = item.querySelector(".pollutant-observed");
      const showInactiveCircle = !row && hasPollutant;
      circle.hidden = !row && !showInactiveCircle;
      unavailable.hidden = Boolean(row) || showInactiveCircle;
      scale.hidden = !row;
      actionsContainer?.toggleAttribute("hidden", !row);
      circle.classList.toggle("pollutant-circle--inactive", showInactiveCircle);
      unit.hidden = showInactiveCircle;
      if (row) {
        valueElement.textContent = formatValue(value);
        item.querySelector(".pollutant-station").textContent = stationName(row);
        item.querySelector(".pollutant-network").textContent = networkLabel(row);
        renderObservedDateTime(observedElement, row);
        circle.style.background = severityColour(value, pollutant.key);
      } else if (showInactiveCircle) {
        valueElement.style.fontSize = "";
        valueElement.classList.remove("pollutant-value--fitted");
        valueElement.textContent =
          `No active readings in the last ${DASHBOARD_ACTIVE_WINDOW_HOURS} hours`;
        item.querySelector(".pollutant-station").textContent = "";
        item.querySelector(".pollutant-network").textContent = selectedNetworkScopeLabel();
        renderObservedDateTime(observedElement, null);
        circle.style.background = "#C8CDD1";
      } else {
        renderObservedDateTime(observedElement, null);
        let message = `Selected networks do not currently report ${pollutant.label}.`;
        if (selectedNetworks.size === 1) {
          const label = networkLabels.get([...selectedNetworks][0]) || "Selected network";
          message = `${label} does not currently report ${pollutant.label}.`;
        } else if (selectedNetworks.size === networkCatalog.length) {
          message = `No network currently reports ${pollutant.label}.`;
        }
        unavailable.querySelector(".pollutant-unavailable-copy").textContent = message;
      }
      const observedLabel = row ? formatObservedDateTime(observedTimestampValue(row)) : null;
      item.setAttribute("aria-label", row
        ? `${pollutant.label}: ${formatValue(value)} micrograms per cubic metre at ${stationName(row)}, ${networkLabel(row)}${observedLabel ? `, observed ${observedLabel.dateTime} ${observedLabel.zone}` : ""}`
        : (showInactiveCircle
          ? `${pollutant.label}: No active readings in the last ${DASHBOARD_ACTIVE_WINDOW_HOURS} hours`
          : `${pollutant.label}: Not provided by the selected networks`));
      const actions = item.querySelectorAll(".pollutant-action");
      actions[0]?.setAttribute("href", `/hex_map/?pollutant=${pollutant.key}`);
      // Sensor Map currently has no station-focus query parameter, so its plain link is retained.
      actions[1]?.setAttribute("href", "/sensor_map/");
      const chartUrl = new URL("/sensors_chart/", window.location.origin);
      if (row) chartUrl.searchParams.set("station_like", stationName(row));
      actions[2]?.setAttribute("href", `${chartUrl.pathname}${chartUrl.search}`);
    });
  }

  function aggregateAreas(rows, type) {
    const codeFields = type === "pcon"
      ? ["pcon_code"]
      : ["la_code", "lad_code", "local_authority_code"];
    const nameFields = type === "pcon"
      ? ["pcon_name"]
      : ["la_name", "lad_name", "local_authority_name"];
    const groups = new Map();
    latestByStation(rows).forEach((row) => {
      const source = row?.station || {};
      const code = codeFields.map((key) => row?.[key] || source?.[key]).find(Boolean);
      const value = numberValue(row);
      if (!code || !Number.isFinite(value)) return;
      const responseName = nameFields.map((key) => row?.[key] || source?.[key]).find(Boolean);
      const name = responseName || areaNames[type].get(String(code)) || code;
      const group = groups.get(code) || { name, values: [] };
      group.values.push(value);
      groups.set(code, group);
    });
    return [...groups.values()].map((group) => ({
      name: group.name,
      value: group.values.reduce((sum, value) => sum + value, 0) / group.values.length,
    }));
  }

  function renderAreas() {
    ["pcon", "la"].forEach((type) => {
      const rowEl = document.querySelector(`[data-area-type="${type}"]`);
      POLLUTANTS.forEach((pollutant, index) => {
        const cell = rowEl?.cells[index + 1];
        if (!cell) return;
        const highest = aggregateAreas(selectedRows(pollutant.key), type)
          .sort((a, b) => b.value - a.value)[0] || null;
        const reading = cell.querySelector(".area-reading");
        const name = cell.querySelector(".area-reading-name");
        const marker = cell.querySelector(".area-marker");
        const value = cell.querySelector(".area-reading-value");
        const number = value?.querySelector(".area-reading-number");
        const unit = value?.querySelector(".area-reading-unit");
        const formattedValue = highest ? formatValue(highest.value) : null;
        name.textContent = highest?.name || "No data";
        if (number && unit) {
          number.textContent = highest ? formattedValue : "—";
          unit.hidden = !highest;
        }
        marker.style.background = severityColour(highest?.value ?? null, pollutant.key);
        reading?.setAttribute("aria-label", highest
          ? `${pollutant.label} highest ${rowEl.cells[0].textContent} reading: ${highest.name}, ${formattedValue} micrograms per cubic metre.`
          : `${pollutant.label} highest ${rowEl.cells[0].textContent} reading: No data.`);
      });
    });
  }

  function renderNetworks() {
    const totals = { pm25: 0, pm10: 0, no2: 0 };
    const body = document.getElementById("network-summary-body");
    body.replaceChildren();
    networkCatalog.filter(({ code }) => selectedNetworks.has(code)).forEach(({ code, label }) => {
      const rowEl = document.createElement("tr");
      rowEl.dataset.network = code;
      const heading = document.createElement("th");
      heading.scope = "row";
      renderNetworkSummaryLabel(heading, label);
      rowEl.append(heading, document.createElement("td"));
      POLLUTANTS.forEach(() => rowEl.append(document.createElement("td")));
      let newest = null;
      POLLUTANTS.forEach((pollutant, index) => {
        const rows = latestByStation((rowsByPollutant.get(pollutant.key) || [])
          .filter((row) => networkCode(row) === code && Number.isFinite(numberValue(row))));
        rowEl.cells[index + 2].textContent = rows.length.toLocaleString("en-GB");
        totals[pollutant.key] += rows.length;
        rows.forEach((row) => {
          const at = timestamp(row);
          if (at && (!newest || at > newest)) newest = at;
        });
      });
      rowEl.cells[1].innerHTML = newest
        ? `<time datetime="${newest.toISOString()}">${formatDate(newest)}</time>` : "—";
      body.append(rowEl);
    });
    const totalRow = document.createElement("tr");
    totalRow.dataset.network = "total";
    const totalHeading = document.createElement("th");
    totalHeading.scope = "row";
    totalHeading.textContent = "Total sensors";
    totalRow.append(totalHeading, document.createElement("td"));
    POLLUTANTS.forEach(() => totalRow.append(document.createElement("td")));
    POLLUTANTS.forEach((pollutant, index) => {
      totalRow.cells[index + 2].textContent = totals[pollutant.key].toLocaleString("en-GB");
    });
    body.append(totalRow);
  }

  function activeSensorCountForNetwork(code) {
    const stations = new Set();
    POLLUTANTS.forEach(({ key }) => {
      latestByStation((rowsByPollutant.get(key) || []).filter((row) =>
        networkCode(row) === code && Number.isFinite(numberValue(row))
      )).forEach((row) => stations.add(stationKey(row)));
    });
    return stations.size;
  }

  function renderNetworkPicker() {
    const selectedCount = selectedNetworks.size;
    const totalCount = networkCatalog.length;
    networkPickerButtonText.textContent = selectedCount === totalCount && totalCount > 0
      ? "Networks: All"
      : `Networks: ${selectedCount} / ${totalCount}`;
    networkPickerButton.setAttribute(
      "aria-label",
      `Choose dashboard networks. ${selectedCount} of ${totalCount} selected.`,
    );
    networkPickerCount.textContent = `${selectedCount} / ${totalCount}`;
    networkPickerSelectAll.disabled = selectedCount === totalCount;
    networkPickerClearAll.disabled = selectedCount <= 1;
    networkPickerList.replaceChildren();
    networkCatalog.forEach(({ code, label }) => {
      const row = document.createElement("label");
      row.className = "home-network-picker-row";
      row.classList.toggle("is-unselected", !selectedNetworks.has(code));
      const main = document.createElement("span");
      main.className = "home-network-picker-row-main";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = code;
      input.checked = selectedNetworks.has(code);
      input.addEventListener("change", () => {
        if (input.checked) {
          selectedNetworks.add(code);
        } else if (selectedNetworks.size > 1) {
          selectedNetworks.delete(code);
        } else {
          input.checked = true;
        }
        render();
      });
      const name = document.createElement("span");
      name.textContent = label;
      const count = document.createElement("span");
      count.className = "home-network-picker-sensor-count";
      count.textContent = activeSensorCountForNetwork(code).toLocaleString("en-GB");
      main.append(input, name);
      row.append(main, count);
      networkPickerList.append(row);
    });
  }

  function setNetworkPickerOpen(open) {
    networkPickerPanel.hidden = !open;
    networkPickerButton.setAttribute("aria-expanded", String(open));
    if (open) networkPickerList.querySelector("input")?.focus();
  }

  function reconcileSelectedNetworks() {
    const availableCodes = new Set(networkCatalog.map(({ code }) => code));
    if (!hasInitializedNetworkSelection) {
      selectedNetworks.clear();
      const preferredNetworks = networkCatalog.filter(({ code }) =>
        PREFERRED_INITIAL_NETWORK_CODES.has(code)
      );
      const initialNetworks = preferredNetworks.length ? preferredNetworks : networkCatalog;
      initialNetworks.forEach(({ code }) => selectedNetworks.add(code));
      hasInitializedNetworkSelection = true;
      return;
    }
    [...selectedNetworks].forEach((code) => {
      if (!availableCodes.has(code)) selectedNetworks.delete(code);
    });
    if (!selectedNetworks.size && networkCatalog[0]) selectedNetworks.add(networkCatalog[0].code);
  }

  function renderUpdated() {
    const displayedAt = dashboardLoadedAt;
    updatedEl.textContent = displayedAt ? `Updated ${formatDate(displayedAt)}` : "Updated —";
    updatedEl.setAttribute(
      "aria-label",
      displayedAt
        ? `Dashboard data refreshed ${formatDate(displayedAt)} UK time`
        : "Dashboard refresh time unavailable",
    );
    if (displayedAt) updatedEl.setAttribute("datetime", displayedAt.toISOString());
    else updatedEl.removeAttribute("datetime");
  }

  function render() {
    renderHighest();
    renderAreas();
    renderNetworks();
    renderUpdated();
    renderNetworkPicker();
    schedulePollutantValueFit();
    scheduleAreaTableLayout();
  }

  function setDashboardBusy(isBusy) {
    dashboard?.classList.toggle("is-loading", isBusy);
    dashboard?.setAttribute("aria-busy", String(isBusy));
    if (refreshButton) {
      refreshButton.disabled = isBusy;
      refreshButton.setAttribute("aria-busy", String(isBusy));
    }
  }

  function requestDashboardRefresh() {
    if (dashboardRefreshInFlight) return dashboardRefreshInFlight;

    const isInitialLoad = !hasCompletedDashboardRequestCycle;
    setDashboardBusy(true);
    dashboardRefreshInFlight = (async () => {
      try {
        const [results, capabilityResults, catalogResult, areaNamesResult] = await Promise.all([
          Promise.allSettled(POLLUTANTS.map(({ key }) => fetchRows(key))),
          Promise.allSettled(POLLUTANTS.map(({ key }) => fetchRows(key, "all"))),
          Promise.resolve(fetchNetworkCatalog()).then(
            (value) => ({ status: "fulfilled", value }),
            (reason) => ({ status: "rejected", reason }),
          ),
          Promise.resolve(fetchAreaNames()).then(
            () => ({ status: "fulfilled" }),
            (reason) => ({ status: "rejected", reason }),
          ),
        ]);
        if (catalogResult.status === "fulfilled" && catalogResult.value.length) {
          networkCatalog = catalogResult.value;
          networkLabels.clear();
          networkCatalog.forEach(({ code, label }) => networkLabels.set(code, label));
        } else if (catalogResult.status === "rejected") {
          debugLog("Unable to load network catalog", catalogResult.reason);
        }
        if (areaNamesResult.status === "rejected") {
          debugLog("Unable to load area names", areaNamesResult.reason);
        }
        reconcileSelectedNetworks();
        let loaded = 0;
        results.forEach((result, index) => {
          const key = POLLUTANTS[index].key;
          if (result.status === "fulfilled") {
            rowsByPollutant.set(key, result.value);
            loaded += 1;
          } else if (isInitialLoad) {
            rowsByPollutant.set(key, []);
            debugLog(`Unable to load ${key}`, result.reason);
          } else {
            debugLog(`Unable to refresh ${key}; retaining existing rows`, result.reason);
          }
        });
        capabilityResults.forEach((result, index) => {
          const key = POLLUTANTS[index].key;
          if (result.status === "fulfilled") {
            capabilityRowsByPollutant.set(key, result.value);
          } else if (isInitialLoad) {
            capabilityRowsByPollutant.set(key, null);
            debugLog(`Unable to load ${key} capability baseline`, result.reason);
          } else {
            debugLog(`Unable to refresh ${key} capability baseline; retaining existing rows`, result.reason);
          }
        });
        if (!loaded) throw new Error("All latest-reading requests failed.");
        statusEl.hidden = loaded === POLLUTANTS.length;
        statusEl.classList.toggle("dashboard-status--error", loaded !== POLLUTANTS.length);
        statusEl.textContent = loaded === POLLUTANTS.length
          ? "" : "Some dashboard readings are temporarily unavailable.";
        render();
        dashboardLoadedAt = new Date();
        renderUpdated();
      } catch (error) {
        render();
        statusEl.hidden = false;
        statusEl.classList.add("dashboard-status--error");
        statusEl.textContent = "Live dashboard data is temporarily unavailable.";
        debugLog("Dashboard load failed", error);
      } finally {
        hasCompletedDashboardRequestCycle = true;
        setDashboardBusy(false);
      }
    })().finally(() => {
      dashboardRefreshInFlight = null;
    });

    return dashboardRefreshInFlight;
  }

  function isDashboardActive() {
    return document.hidden === false && document.hasFocus() === true;
  }

  function clearDashboardRefreshTimeout() {
    if (dashboardRefreshTimeout !== null) {
      window.clearTimeout(dashboardRefreshTimeout);
      dashboardRefreshTimeout = null;
    }
  }

  function scheduleNextDashboardRefresh() {
    clearDashboardRefreshTimeout();
    if (!isDashboardActive()) return;

    const now = Date.now();
    const nextBoundary = (Math.floor(now / DASHBOARD_REFRESH_INTERVAL_MS) + 1)
      * DASHBOARD_REFRESH_INTERVAL_MS;
    dashboardRefreshTimeout = window.setTimeout(() => {
      dashboardRefreshTimeout = null;
      if (!isDashboardActive()) return;
      requestDashboardRefresh();
      scheduleNextDashboardRefresh();
    }, nextBoundary - now);
  }

  function syncDashboardRefreshSchedule() {
    clearDashboardRefreshTimeout();
    if (!isDashboardActive()) return;

    if (
      dashboardLoadedAt !== null
      && Date.now() - dashboardLoadedAt.getTime() > DASHBOARD_REFRESH_INTERVAL_MS
    ) {
      requestDashboardRefresh();
    }
    scheduleNextDashboardRefresh();
  }

  const areaTableWidthObserver = areaReadingsTable && typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (!Number.isFinite(width)) return;
      if (lastAreaTableObservedWidth !== null && Math.abs(width - lastAreaTableObservedWidth) < 0.5) return;
      lastAreaTableObservedWidth = width;
      scheduleAreaTableLayout();
    })
    : null;

  networkPickerButton?.addEventListener("click", () => {
    setNetworkPickerOpen(networkPickerPanel.hidden);
  });
  networkPickerSelectAll?.addEventListener("click", () => {
    networkCatalog.forEach(({ code }) => selectedNetworks.add(code));
    render();
  });
  networkPickerClearAll?.addEventListener("click", () => {
    const keep = networkCatalog.find(({ code }) => selectedNetworks.has(code)) || networkCatalog[0];
    selectedNetworks.clear();
    if (keep) selectedNetworks.add(keep.code);
    render();
  });
  document.addEventListener("click", (event) => {
    if (!networkPicker?.contains(event.target)) setNetworkPickerOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !networkPickerPanel.hidden) {
      setNetworkPickerOpen(false);
      networkPickerButton.focus();
    }
  });
  window.addEventListener("resize", () => {
    window.clearTimeout(fitValuesTimer);
    fitValuesTimer = window.setTimeout(() => {
      schedulePollutantValueFit();
      scheduleAreaTableLayout();
    }, 120);
  });
  refreshButton?.addEventListener("click", requestDashboardRefresh);
  document.addEventListener("visibilitychange", syncDashboardRefreshSchedule);
  window.addEventListener("focus", syncDashboardRefreshSchedule);
  window.addEventListener("blur", clearDashboardRefreshTimeout);
  document.fonts?.ready?.then(() => {
    schedulePollutantValueFit();
    scheduleAreaTableLayout();
  });
  ensureAreaGroupRows();
  areaTableWidthObserver?.observe(areaReadingsTable);
  applyDashboardWindowCopy();
  scheduleAreaTableLayout();
  requestDashboardRefresh();
  scheduleNextDashboardRefresh();
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
