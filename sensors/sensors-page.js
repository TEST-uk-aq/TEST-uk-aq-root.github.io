// Sensors page-owned search, table, filtering, and station-selection UI.
(function (root) {
  "use strict";

  function installSensorsPage() {
    if (!root.document?.body?.classList.contains("sensors-page") || root.ukAqSensorsPage) return null;
    const pollutantDomain = root.UkAqPollutants;
    const adapterModule = root.UkAqSensorStationChartAdapter;
    if (!pollutantDomain?.normalizeSupportedLabel || !adapterModule?.createSensorStationChartAdapter) {
      throw new Error("Sensors page dependencies are missing");
    }

    const params = new URLSearchParams(root.location.search);
    const baseUrl = adapterModule.cacheBaseUrl(params);
    const endpoint = `${baseUrl}/stations-chart`;
    const limit = String(params.get("limit") || "1000");
    const fetchApi = (url, init) => typeof root.ukAqFetchCacheApi === "function"
      ? root.ukAqFetchCacheApi(url, init)
      : root.fetch(url, init);
    const refs = {
      status: root.document.getElementById("status"),
      error: root.document.getElementById("error"),
      tableBody: root.document.getElementById("table-body"),
      rowCount: root.document.getElementById("row-count"),
      lastUpdated: root.document.getElementById("last-updated"),
      regionBadge: root.document.getElementById("region-badge"),
      endpointHint: root.document.getElementById("endpoint-hint"),
      searchInput: root.document.getElementById("station-search"),
      searchButton: root.document.getElementById("search-submit"),
      pollutantSelect: root.document.getElementById("pollutant-filter"),
      stationSelect: root.document.getElementById("station-select"),
      refreshButton: root.document.getElementById("refresh"),
    };
    let currentStationLike = normalizeStationLike(params.get("station_like") || params.get("q")) || "Bristol";
    let cachedRows = [];
    let selectedSeriesId = null;
    let seriesLookup = new Map();
    const etagBySearch = new Map();
    const chartAdapter = adapterModule.createSensorStationChartAdapter({ params, fetchApi });

    function normalizeStationLike(value) {
      const text = String(value || "").trim();
      return text || null;
    }

    function getPollutantLabel(row) {
      return row?.pollutant_label
        || row?.phenomenon?.pollutant_label
        || row?.phenomenon?.label
        || row?.phenomenon_label
        || "Unknown";
    }

    function getNetworkLabel(row) {
      const direct = String(row?.network_name || "").trim();
      if (direct) return direct;
      const memberships = Array.isArray(row?.station_network_memberships) ? row.station_network_memberships : [];
      const primary = memberships.find((entry) => entry?.is_primary);
      const membership = primary || memberships[0];
      const membershipLabel = String(membership?.network_label || membership?.network_code || "").trim();
      if (membershipLabel) return membershipLabel;
      return String(row?.connector_label || row?.connector_code || "Unknown").trim() || "Unknown";
    }

    function stripMissingFolio(value) {
      return String(value || "").replace(/,?\s*GB_SamplingFeature_missingFOI\b/gi, "").trim();
    }

    function dedupeSegments(value) {
      const result = [];
      const seen = new Set();
      String(value || "").split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
        const key = part.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(part);
      });
      return result.join(", ");
    }

    function formatStationLabel(row) {
      return dedupeSegments(stripMissingFolio(row?.display_name || row?.station?.display_name || "")) || "Unknown station";
    }

    function formatValue(value) {
      if (value === null || value === undefined) return "—";
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value);
    }

    function formatTime(value) {
      if (!value) return "—";
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
    }

    function isStale(value) {
      const timestamp = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(timestamp) && Date.now() - timestamp > 2 * 60 * 60 * 1000;
    }

    function selectedPollutantLabel() {
      return String(refs.pollutantSelect?.value || "");
    }

    function selectedPollutant() {
      return pollutantDomain.normalizeSupportedLabel(selectedPollutantLabel());
    }

    function filteredRows() {
      const pollutant = selectedPollutantLabel();
      return pollutant ? cachedRows.filter((row) => getPollutantLabel(row) === pollutant) : cachedRows;
    }

    function sortRows(rows) {
      return [...rows].sort((left, right) => getPollutantLabel(left).localeCompare(getPollutantLabel(right))
        || formatStationLabel(left).localeCompare(formatStationLabel(right)));
    }

    function renderRows() {
      const ordered = sortRows(filteredRows());
      refs.tableBody.innerHTML = "";
      ordered.forEach((row) => {
        const tr = root.document.createElement("tr");
        const values = [
          formatStationLabel(row),
          getNetworkLabel(row),
          getPollutantLabel(row),
          formatValue(row.last_value),
          row.uom_display || row.uom || "",
          formatTime(row.last_value_at),
        ];
        values.forEach((value, index) => {
          const cell = root.document.createElement("td");
          cell.textContent = value;
          if (index === 3) cell.className = `value ${isStale(row.last_value_at) ? "stale" : ""}`;
          tr.appendChild(cell);
        });
        refs.tableBody.appendChild(tr);
      });
      refs.rowCount.textContent = `${ordered.length} series`;
    }

    function updatePollutantOptions() {
      const current = selectedPollutantLabel();
      const labels = Array.from(new Set(cachedRows.map(getPollutantLabel)))
        .filter((label) => label && label !== "Unknown")
        .sort((left, right) => left.localeCompare(right));
      refs.pollutantSelect.innerHTML = "";
      const all = root.document.createElement("option");
      all.value = "";
      all.textContent = "All pollutants";
      refs.pollutantSelect.appendChild(all);
      labels.forEach((label) => {
        const option = root.document.createElement("option");
        option.value = label;
        option.textContent = label;
        refs.pollutantSelect.appendChild(option);
      });
      if (current && labels.includes(current)) refs.pollutantSelect.value = current;
    }

    function entryFromRow(row) {
      const connectorId = row?.connector_id ?? row?.connector?.id ?? row?.timeseries?.connector_id ?? null;
      return adapterModule.normalizeEntry({
        timeseries_id: row?.id,
        connector_id: connectorId,
        station_id: row?.station_id,
        pollutant: getPollutantLabel(row),
        units: row?.uom_display || row?.uom || "",
        station_name: formatStationLabel(row),
        network_name: getNetworkLabel(row),
        last_value_at: row?.last_value_at || null,
      });
    }

    function buildSeriesOptions() {
      const unique = new Map();
      filteredRows().forEach((row) => {
        const entry = entryFromRow(row);
        if (!entry || unique.has(String(entry.timeseries_id))) return;
        const pollutantLabel = getPollutantLabel(row);
        unique.set(String(entry.timeseries_id), Object.freeze({
          entry,
          label: `${formatStationLabel(row)} — ${pollutantLabel}`,
        }));
      });
      const options = Array.from(unique.entries()).sort((left, right) => left[1].label.localeCompare(right[1].label));
      refs.stationSelect.innerHTML = "";
      options.forEach(([id, value]) => {
        const option = root.document.createElement("option");
        option.value = id;
        option.textContent = value.label;
        refs.stationSelect.appendChild(option);
      });
      seriesLookup = new Map(options);
      if (!seriesLookup.has(String(selectedSeriesId || ""))) selectedSeriesId = options[0]?.[0] || null;
      if (selectedSeriesId) refs.stationSelect.value = selectedSeriesId;
    }

    function selectedEntry() {
      return seriesLookup.get(String(selectedSeriesId || ""))?.entry || null;
    }

    async function syncChartSelection() {
      return chartAdapter.setEntry(selectedEntry(), { pollutant: selectedPollutant() });
    }

    async function applyPollutantSelection() {
      const previous = selectedSeriesId;
      renderRows();
      buildSeriesOptions();
      if (!selectedSeriesId) {
        await syncChartSelection();
        return;
      }
      if (selectedSeriesId !== previous) await syncChartSelection();
    }

    function buildEndpoint() {
      const url = new URL(endpoint);
      url.searchParams.set("station_like", currentStationLike);
      url.searchParams.set("limit", limit);
      return url.toString();
    }

    async function loadData() {
      refs.status.textContent = "Loading…";
      refs.error.textContent = "";
      try {
        const searchKey = currentStationLike.toLowerCase();
        const headers = {};
        const etag = etagBySearch.get(searchKey);
        if (etag) headers["If-None-Match"] = etag;
        const response = await fetchApi(buildEndpoint(), { headers });
        if (response.status === 304) {
          await chartAdapter.refresh();
          refs.lastUpdated.textContent = `Unchanged ${new Date().toLocaleTimeString()}`;
          refs.status.textContent = "Live";
          return;
        }
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const responseEtag = response.headers.get("etag");
        if (responseEtag) etagBySearch.set(searchKey, responseEtag);
        const payload = await response.json();
        cachedRows = Array.isArray(payload?.data) ? payload.data : [];
        updatePollutantOptions();
        renderRows();
        buildSeriesOptions();
        await syncChartSelection();
        refs.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
        refs.status.textContent = "Live";
      } catch (error) {
        cachedRows = [];
        selectedSeriesId = null;
        seriesLookup = new Map();
        updatePollutantOptions();
        renderRows();
        buildSeriesOptions();
        await syncChartSelection();
        refs.lastUpdated.textContent = "Waiting for data";
        refs.error.textContent = error instanceof Error ? error.message : String(error);
        refs.status.textContent = "Error";
      }
    }

    async function runStationSearch() {
      const next = normalizeStationLike(refs.searchInput.value);
      if (!next) {
        refs.error.textContent = "Enter a station search term.";
        return;
      }
      currentStationLike = next;
      refs.regionBadge.textContent = `Search: ${currentStationLike}`;
      const nextParams = new URLSearchParams(root.location.search);
      nextParams.set("station_like", currentStationLike);
      nextParams.delete("q");
      const query = nextParams.toString();
      root.history.replaceState(null, "", `${root.location.pathname}${query ? `?${query}` : ""}`);
      await loadData();
    }

    function handleSearchKeydown(event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void runStationSearch();
    }

    async function mount() {
      refs.searchInput.value = currentStationLike;
      refs.regionBadge.textContent = `Search: ${currentStationLike}`;
      refs.endpointHint.textContent = `Endpoint: ${endpoint}`;
      refs.refreshButton.addEventListener("click", loadData);
      refs.searchButton.addEventListener("click", runStationSearch);
      refs.searchInput.addEventListener("keydown", handleSearchKeydown);
      refs.pollutantSelect.addEventListener("change", applyPollutantSelection);
      refs.stationSelect.addEventListener("change", () => {
        selectedSeriesId = refs.stationSelect.value || null;
        void syncChartSelection();
      });
      await chartAdapter.mount();
      await loadData();
      root.setInterval(loadData, 5 * 60 * 1000);
      return true;
    }

    const api = Object.freeze({ mount, loadData, runStationSearch, chartAdapter });
    root.ukAqSensorsPage = api;
    void mount();
    return api;
  }

  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", installSensorsPage, { once: true });
  } else if (root.document) {
    queueMicrotask(installSensorsPage);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
