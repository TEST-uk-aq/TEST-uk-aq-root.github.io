(() => {
  "use strict";

  const POLLUTANTS = [
    { key: "pm25", label: "PM2.5", html: "PM2.5" },
    { key: "pm10", label: "PM10", html: "PM10" },
    { key: "no2", label: "NO₂", html: "NO<sub>2</sub>" },
  ];
  const NETWORKS = [
    { code: "gov_uk_aurn", label: "GOV.UK AURN" },
    { code: "breathelondon", label: "Breathe London" },
    { code: "sensorcommunity", label: "Sensor.Community" },
    { code: "openaq", label: "OpenAQ" },
  ];
  const NETWORK_LABELS = new Map(NETWORKS.map(({ code, label }) => [code, label]));
  const dashboard = document.querySelector(".readings-dashboard");
  const networkFilter = document.getElementById("network-filter");
  const statusEl = document.getElementById("dashboard-status");
  const updatedEl = document.getElementById("dashboard-updated");
  const debugEnabled = parseBooleanFlag(
    typeof WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER === "string"
      ? WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER
      : "",
  );
  const cacheBaseUrl = resolveCacheBaseUrl(
    new URLSearchParams(window.location.search).get("cache_base"),
  );
  const rowsByPollutant = new Map();

  function parseBooleanFlag(value) {
    return /^(1|true|yes|on)$/i.test(String(value || "").trim());
  }

  function debugLog(...args) {
    if (debugEnabled) console.debug("[UK AQ dashboard]", ...args);
  }

  function resolveCacheBaseUrl(rawValue) {
    const explicit = String(rawValue || "").trim();
    if (explicit) return explicit.replace(/\/+$/, "");
    if (/^https?:$/.test(window.location.protocol)) {
      return `${window.location.origin.replace(/\/$/, "")}/api/aq`;
    }
    return "https://cic-test.chronicillnesschannel.co.uk/api/aq";
  }

  function endpoint(path, pollutant) {
    const url = new URL(`${cacheBaseUrl}/${path}`);
    url.searchParams.set("pollutant", pollutant);
    url.searchParams.set("window", "all");
    url.searchParams.set("scope", "all");
    url.searchParams.set("limit", "10000");
    url.searchParams.set("caller", "homepage");
    return url;
  }

  async function fetchRows(pollutant) {
    const response = await fetch(endpoint("latest-snapshot", pollutant), {
      credentials: "include",
    });
    if (!response.ok) throw new Error(`Latest ${pollutant} request failed: ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => ({ ...row, _pollutant: pollutant }));
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
      || NETWORK_LABELS.get(networkCode(row)) || "Unknown network";
  }

  function formatValue(value) {
    if (!Number.isFinite(value)) return "No data";
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function formatDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "—";
    const parts = new Intl.DateTimeFormat("en-GB", {
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
    const selectedNetwork = networkFilter?.value || "";
    const rows = rowsByPollutant.get(pollutant) || [];
    return selectedNetwork ? rows.filter((row) => networkCode(row) === selectedNetwork) : rows;
  }

  function severityColour(value, pollutant) {
    if (!Number.isFinite(value)) return "#c9ced1";
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
      const row = latestByStation(selectedRows(pollutant.key))
        .filter((candidate) => Number.isFinite(numberValue(candidate)))
        .sort((a, b) => numberValue(b) - numberValue(a))[0] || null;
      const value = row ? numberValue(row) : null;
      item.querySelector(".pollutant-value").textContent = formatValue(value);
      item.querySelector(".pollutant-station").textContent = row ? stationName(row) : "No reporting sensor";
      item.querySelector(".pollutant-network").textContent = row ? networkLabel(row) : "—";
      item.querySelector(".pollutant-circle").style.background = severityColour(value, pollutant.key);
      item.setAttribute("aria-label", row
        ? `${pollutant.label}: ${formatValue(value)} micrograms per cubic metre at ${stationName(row)}, ${networkLabel(row)}`
        : `${pollutant.label}: No data`);
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
      const name = nameFields.map((key) => row?.[key] || source?.[key]).find(Boolean) || code;
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
        const name = cell.querySelector(".area-reading-name");
        const marker = cell.querySelector(".area-marker");
        const value = cell.querySelector(".area-reading-value");
        name.textContent = highest?.name || "No data";
        value.innerHTML = highest ? `${formatValue(highest.value)} &micro;g/m<sup>3</sup>` : "—";
        marker.style.background = severityColour(highest?.value ?? null, pollutant.key);
      });
    });
  }

  function renderNetworks() {
    const totals = { pm25: 0, pm10: 0, no2: 0 };
    NETWORKS.forEach(({ code }) => {
      const rowEl = document.querySelector(`#network-summary-body [data-network="${code}"]`);
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
    });
    const totalRow = document.querySelector('#network-summary-body [data-network="total"]');
    POLLUTANTS.forEach((pollutant, index) => {
      totalRow.cells[index + 2].textContent = totals[pollutant.key].toLocaleString("en-GB");
    });
  }

  function renderUpdated() {
    let newest = null;
    rowsByPollutant.forEach((rows) => rows.forEach((row) => {
      const at = timestamp(row);
      if (at && (!newest || at > newest)) newest = at;
    }));
    updatedEl.textContent = newest ? `Updated ${formatDate(newest)}` : "Updated —";
    if (newest) updatedEl.setAttribute("datetime", newest.toISOString());
    else updatedEl.removeAttribute("datetime");
  }

  function render() {
    renderHighest();
    renderAreas();
    renderNetworks();
    renderUpdated();
  }

  async function load() {
    dashboard?.classList.add("is-loading");
    try {
      const results = await Promise.allSettled(POLLUTANTS.map(({ key }) => fetchRows(key)));
      let loaded = 0;
      results.forEach((result, index) => {
        const key = POLLUTANTS[index].key;
        if (result.status === "fulfilled") {
          rowsByPollutant.set(key, result.value);
          loaded += 1;
        } else {
          rowsByPollutant.set(key, []);
          debugLog(`Unable to load ${key}`, result.reason);
        }
      });
      render();
      if (!loaded) throw new Error("All latest-reading requests failed.");
      statusEl.hidden = loaded === POLLUTANTS.length;
      statusEl.classList.toggle("dashboard-status--error", loaded !== POLLUTANTS.length);
      statusEl.textContent = loaded === POLLUTANTS.length
        ? "" : "Some dashboard readings are temporarily unavailable.";
    } catch (error) {
      render();
      statusEl.hidden = false;
      statusEl.classList.add("dashboard-status--error");
      statusEl.textContent = "Live dashboard data is temporarily unavailable.";
      debugLog("Dashboard load failed", error);
    } finally {
      dashboard?.classList.remove("is-loading");
    }
  }

  networkFilter?.addEventListener("change", render);
  load();
})();
