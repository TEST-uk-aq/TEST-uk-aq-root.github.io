(() => {
  "use strict";

  const POLLUTANTS = [
    { key: "pm25", label: "PM2.5", html: "PM2.5" },
    { key: "pm10", label: "PM10", html: "PM10" },
    { key: "no2", label: "NO₂", html: "NO<sub>2</sub>" },
  ];
  const FALLBACK_NETWORKS = [
    { code: "gov_uk_aurn", label: "GOV.UK AURN" },
    { code: "breathelondon", label: "Breathe London" },
    { code: "sensorcommunity", label: "Sensor.Community" },
  ];
  const DASHBOARD_ACTIVE_WINDOW_HOURS = 6;
  const DASHBOARD_ACTIVE_WINDOW = `${DASHBOARD_ACTIVE_WINDOW_HOURS}h`;
  const DASHBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  let networkCatalog = [...FALLBACK_NETWORKS];
  const selectedNetworks = new Set(FALLBACK_NETWORKS.map(({ code }) => code));
  let hasInitializedNetworkSelection = false;
  const networkLabels = new Map(FALLBACK_NETWORKS.map(({ code, label }) => [code, label]));
  const areaNames = { pcon: new Map(), la: new Map() };
  const dashboard = document.querySelector(".readings-dashboard");
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
    const response = await fetchCacheApi(`${cacheBaseUrl}/networks`, { credentials: "include" });
    if (!response.ok) throw new Error(`Network catalog request failed: ${response.status}`);
    const payload = await response.json();
    return (Array.isArray(payload?.data) ? payload.data : [])
      .filter((row) => row?.public_display_enabled === true)
      .map((row) => ({
        code: String(row.network_code || "").trim(),
        label: String(row.network_label || "").trim(),
        type: row.network_type || null,
      }))
      .filter((row) => row.code && row.label);
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
    const formatted = formatObservedDateTime(observedTimestampValue(row));
    if (!formatted) {
      container.hidden = true;
      container.querySelector("time").removeAttribute("datetime");
      container.querySelector("time").textContent = "";
      return "";
    }
    const time = container.querySelector("time");
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
        const formattedValue = highest ? formatValue(highest.value) : null;
        name.textContent = highest?.name || "No data";
        value.innerHTML = highest ? `${formattedValue} &micro;g/m<sup>3</sup>` : "—";
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
      heading.textContent = label;
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
      networkCatalog.forEach(({ code }) => selectedNetworks.add(code));
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
    fitValuesTimer = window.setTimeout(schedulePollutantValueFit, 120);
  });
  refreshButton?.addEventListener("click", requestDashboardRefresh);
  document.addEventListener("visibilitychange", syncDashboardRefreshSchedule);
  window.addEventListener("focus", syncDashboardRefreshSchedule);
  window.addEventListener("blur", clearDashboardRefreshTimeout);
  document.fonts?.ready?.then(schedulePollutantValueFit);
  applyDashboardWindowCopy();
  requestDashboardRefresh();
  scheduleNextDashboardRefresh();
})();
