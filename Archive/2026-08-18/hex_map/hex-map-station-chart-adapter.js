// Hex Map integration only: page selection, controls, and shared-controller lifecycle.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("../shared/station-chart/station-chart-domain.js") : null);
  const api = factory(root, domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqHexMapStationChartAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, domain) {
  "use strict";

  if (!domain) throw new Error("UkAqStationChartDomain is required");
  const MAX_SELECTED_SENSORS = 4;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RANGE_VALUES = new Set(["12h", "24h", "7d", "31d", "90d"]);

  // Narrow page-readiness facade for the shared pollutant-context controller.
  function createHexMapStationChartAdapter(options = {}) {
    const eventTarget = options.eventTarget || (typeof window !== "undefined" ? window : null);
    const controller = options.controller;
    if (!controller?.setPollutantContext) throw new Error("pollutant_context_controller_required");
    let mounted = false;

    function selection() {
      const value = typeof options.getSelection === "function" ? options.getSelection() : {};
      return value && typeof value === "object" ? value : {};
    }

    function request(pollutant) {
      const normalized = domain.normalizePollutant(pollutant);
      if (!normalized || (typeof options.isActive === "function" && !options.isActive())) return false;
      void controller.setPollutantContext({
        pollutant: normalized,
        entries: [],
        status: "loading",
        preserveRange: true,
        preserveSelection: true,
        ...selection(),
      });
      return true;
    }

    function resolveStatus(context, explicitStatus) {
      const status = String(explicitStatus || context?.dataStatus || "").trim().toLowerCase();
      if (status === "failed") return "failed";
      const pollutant = domain.normalizePollutant(context?.pollutant);
      const loadedPollutant = domain.normalizePollutant(context?.loadedPollutant);
      return status === "ready" && pollutant && loadedPollutant === pollutant ? "ready" : "loading";
    }

    function sync(context, explicitStatus) {
      if (!context || (typeof options.isActive === "function" && !options.isActive(context.mapKey))) return false;
      const pollutant = domain.normalizePollutant(context.pollutant);
      if (!pollutant) return false;
      const status = resolveStatus(context, explicitStatus);
      void controller.setPollutantContext({
        pollutant,
        entries: status === "ready" ? (Array.isArray(context.entries) ? context.entries : []) : [],
        status,
        preserveRange: true,
        preserveSelection: true,
        ...selection(),
      });
      return true;
    }

    function handlePollutantChange(event) { request(event?.detail?.pollutant); }
    function mount() {
      if (mounted || !eventTarget?.addEventListener) return false;
      eventTarget.addEventListener("pollutantchange", handlePollutantChange);
      mounted = true;
      return true;
    }
    function destroy() {
      if (mounted && eventTarget?.removeEventListener) eventTarget.removeEventListener("pollutantchange", handlePollutantChange);
      mounted = false;
    }
    return Object.freeze({ mount, destroy, request, sync, resolveStatus, get mounted() { return mounted; } });
  }

  function parseBooleanFlag(value, fallback) {
    if (value === null || value === undefined || value === "") return Boolean(fallback);
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return Boolean(fallback);
  }

  function cacheBaseUrl(params) {
    const explicit = String(params.get("cache_base") || "").trim();
    if (explicit) return explicit.replace(/\/+$/, "");
    if (root.location?.protocol === "http:" || root.location?.protocol === "https:") {
      return `${root.location.origin.replace(/\/$/, "")}/api/aq`;
    }
    return "https://cic-test.chronicillnesschannel.co.uk/api/aq";
  }

  function normalizeRangeLabel(value) {
    const label = String(value || "").trim();
    return RANGE_VALUES.has(label) ? label : "24h";
  }

  function resolveRange(label) {
    const endDate = new Date();
    const duration = label === "12h" ? 12 * 60 * 60 * 1000
      : label === "7d" ? 7 * DAY_MS
        : label === "31d" ? 31 * DAY_MS
          : label === "90d" ? 90 * DAY_MS
            : DAY_MS;
    return domain.snapshotChartRange({
      start_utc: new Date(endDate.getTime() - duration).toISOString(),
      end_utc: endDate.toISOString(),
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function normalizeEntry(entry, context) {
    if (!entry) return null;
    const stationId = entry.stationId ?? entry.station_id ?? entry.row?.station_id ?? entry.row?.station?.id;
    const timeseriesId = entry.timeseriesId ?? entry.timeseries_id ?? entry.time_series_id
      ?? entry.row?.timeseries_id ?? entry.row?.time_series_id ?? entry.row?.timeseries?.id;
    const connectorId = entry.connectorId ?? entry.connector_id ?? entry.row?.connector_id
      ?? entry.row?.connector?.id ?? entry.row?.connectorId;
    const pollutant = domain.normalizePollutant(entry.pollutant || context?.pollutant);
    if (stationId === null || stationId === undefined || !timeseriesId || !connectorId || !pollutant) return null;
    return Object.freeze({
      ...entry,
      station_id: String(stationId).trim(),
      stationId: String(stationId).trim(),
      timeseries_id: Number(timeseriesId),
      connector_id: Number(connectorId),
      pollutant,
      units: entry.units || context?.units || "µg/m³",
    });
  }

  function contextIdentity(mapKey, context) {
    const value = context?.areaCode ?? context?.area_code ?? context?.pcon_code ?? context?.lad_code
      ?? context?.la_code ?? context?.code ?? context?.hexCellKey ?? context?.hex_cell_key
      ?? context?.visualHexCellKey ?? context?.visual_hex_cell_key ?? context?.cellKey ?? context?.cell_key;
    const identity = String(value || "").trim().toUpperCase();
    return identity ? `${mapKey}|${identity}` : "";
  }

  function installHexMapStationChart() {
    if (!root.document?.body?.classList.contains("hex-map-page") || root.hexChartMode) return null;
    const pageMode = root.UkAqHexMapPageMode;
    if (!pageMode?.getState || !pageMode?.isChartMode || !pageMode?.enterChart || !pageMode?.exitChart) {
      throw new Error("UkAqHexMapPageMode is required");
    }
    const params = new URLSearchParams(root.location.search);
    const baseUrl = cacheBaseUrl(params);
    const scheduler = root.UkAqStationHistoryLoader.createPriorityFetchScheduler(6);
    const fetchApi = (url, init) => typeof root.ukAqFetchCacheApi === "function"
      ? root.ukAqFetchCacheApi(url, init)
      : root.fetch(url, init);
    const diagnostics = root.UkAqStationChartDiagnostics.createDiagnostics({
      recordEvent: root.ukAqWebsiteDebugLog?.recordEvent,
      recordTiming: root.ukAqWebsiteDebugLog?.recordTiming,
    });
    const calculatedClient = root.UkAqCalculatedStationHistoryClient.createCalculatedStationHistoryClient({
      stationSeriesUrl: `${baseUrl}/station-series`,
      historyUrl: `${baseUrl}/timeseries`,
      fetchApi,
      scheduler,
      priorities: { current: 0, older: 1, prefetch: 2 },
      onRequestFailure: ({ url, response, body, request }) => root.ukAqWebsiteDebugLog?.recordEvent?.("station_chart_fetch_failed", {
        url: root.ukAqWebsiteDebugLog?.sanitizeUrl?.(url) || url,
        status: response?.status || null,
        timeseries_id: request?.timeseries_id || null,
        body: root.ukAqWebsiteDebugLog?.capText?.(body, 2048)?.text || "",
      }),
    });
    const explicitAqiBase = String(params.get("aqi_history_base") || "").trim();
    const compatibilityClient = root.UkAqCompatibilityStationHistoryClient.createCompatibilityStationHistoryClient({
      observationUrl: `${baseUrl}/timeseries`,
      aqiHistoryUrls: [explicitAqiBase, `${baseUrl}/aqi-history`, "https://cic-test.chronicillnesschannel.co.uk/api/aq/aqi-history"].filter(Boolean),
      fetchApi,
      scheduler,
      proxyV2Enabled: parseBooleanFlag(params.get("timeseries_v2"), true),
      priorities: { observations: 0, aqi: 0, prefetch: 2 },
      onRequestFailure: ({ kind, url, error, attempt, retryable }) => root.ukAqWebsiteDebugLog?.recordEvent?.("station_chart_compatibility_fetch_failed", {
        kind, url: root.ukAqWebsiteDebugLog?.sanitizeUrl?.(url) || url,
        status: error?.ukAqHttpStatus || null, attempt: attempt || null, retryable: retryable === true,
      }),
    });

    const backButton = root.document.getElementById("chart-back-to-map");
    const rangeSelect = root.document.getElementById("hex-chart-window-toolbar");
    const domByMap = Object.fromEntries(["uk", "cr"].map((key) => {
      const panel = root.document.getElementById(`${key}-hex-chart-mode`);
      return [key, {
        panel,
        reading: root.document.getElementById(`${key}-hex-chart-reading`),
        message: root.document.getElementById(`${key}-hex-chart-message`),
        wrap: root.document.getElementById(`${key}-hex-chart-wrap`),
        svg: root.document.getElementById(`${key}-hex-chart-svg`),
        tooltip: root.document.getElementById(`${key}-hex-chart-tooltip`),
      }];
    }));
    const state = {
      lifecycleMounted: false,
      sessionIdentity: "",
      rangeLabel: "24h",
      visibleEntries: [],
      selectedIds: new Set(),
      retainedEntries: new Map(),
      aqiSourceId: null,
      controller: null,
      renderer: null,
      pollutantContextController: null,
      pollutantAdapter: null,
    };

    function chartMapKey() { return pageMode.getState().chartMapKey; }
    function isLifecycleMounted(mapKey = null) {
      return Boolean(state.lifecycleMounted && (!mapKey || chartMapKey() === mapKey));
    }
    function mapAdapter(mapKey = chartMapKey()) { return mapKey === "cr" ? root.crMap : root.ukMap; }
    function currentContext(mapKey = chartMapKey()) { return mapAdapter(mapKey)?.getChartModeContext?.() || null; }
    function dom() { return domByMap[chartMapKey()] || null; }
    function selectedEntries() {
      const visible = new Map(state.visibleEntries.map((entry) => [entry.station_id, entry]));
      return Array.from(state.selectedIds).map((id) => visible.get(id) || state.retainedEntries.get(id)).filter(Boolean);
    }
    function setMessage(text, options = {}) {
      const element = dom()?.message;
      if (!element) return;
      element.textContent = String(text || "");
      element.classList.toggle("is-error", options.error === true);
    }

    function selectionContext() {
      const selectedStationIds = Array.from(state.selectedIds);
      return {
        selectedStationIds,
        primaryStationId: selectedStationIds[0] || null,
        aqiSourceStationId: state.aqiSourceId,
      };
    }

    function contextGuard(load) {
      return Object.freeze({
        generation: load.generation,
        signal: load.signal,
        isCurrent: load.isCurrent,
      });
    }

    function stationContext(load, status) {
      return {
        pollutant: load.pollutant,
        status,
        entries: status === "ready" ? load.entries : [],
        selectedStationIds: load.selectedStationIds,
        primaryStationId: load.primaryStationId,
        aqiSourceStationId: load.aqiSourceStationId,
        renderMode: load.renderMode,
        contextGuard: contextGuard(load),
      };
    }

    function applyReadyPollutantContext(load) {
      const context = currentContext();
      const entries = load.entries.map((entry) => normalizeEntry(entry, context)).filter(Boolean);
      const byStationId = new Map(entries.map((entry) => [entry.station_id, entry]));
      const selected = load.selectedStationIds.map((stationId) => byStationId.get(stationId)).filter(Boolean);
      state.visibleEntries = entries;
      state.selectedIds = new Set(selected.map((entry) => entry.station_id));
      state.retainedEntries = new Map(selected.map((entry) => [entry.station_id, entry]));
      state.aqiSourceId = state.selectedIds.has(load.aqiSourceStationId)
        ? load.aqiSourceStationId
        : selected[0]?.station_id || null;
      renderChips(context);
      syncTable(chartMapKey());
      notifySelection();
    }

    function createPollutantHandoff() {
      if (!root.UkAqPollutantContextController?.createPollutantContextController) {
        throw new Error("pollutant_context_controller_required");
      }
      state.pollutantContextController = root.UkAqPollutantContextController.createPollutantContextController({
        onLoading(load) {
          void state.controller?.replacePollutantContext(stationContext(load, "loading"));
        },
        onFailed(load) {
          void state.controller?.replacePollutantContext(stationContext(load, "failed"));
          setMessage(`${String(currentContext()?.pollutantLabel || load.pollutant).toUpperCase()} map data is unavailable. Try Refresh.`, { error: true });
        },
        async onRender(load) {
          const replacement = state.controller?.replacePollutantContext(stationContext(load, "ready"));
          if (!replacement) return;
          load.commitVisible(function () { applyReadyPollutantContext(load); });
          const result = await replacement;
          if (result?.committed !== true) return;
          load.complete(function () { setMessage(""); });
        },
      });
      state.pollutantAdapter = createHexMapStationChartAdapter({
        controller: state.pollutantContextController,
        eventTarget: root,
        isActive: isLifecycleMounted,
        getSelection: selectionContext,
      });
      state.pollutantAdapter.mount();
    }

    function createController(mapKey) {
      state.renderer = root.UkAqStationChartRenderer.createStationChartRenderer({
        getWindowLabel: () => state.rangeLabel,
        noHistoryMessage: "No chart data is available for these sensors in the selected range",
      });
      state.controller = root.UkAqStationChartController.createStationChartController({
        renderer: state.renderer,
        calculatedClient,
        compatibilityClient,
        diagnostics,
        maxSelection: MAX_SELECTED_SENSORS,
        useCompatibility: !parseBooleanFlag(params.get("station_history_loader"), true),
        getWindowLabel: () => state.rangeLabel,
        cacheContract: "hex-map-station-history-v8-shared-controller",
        onMessage: setMessage,
        emptyMessage: "Select a sensor from the list to draw a chart.",
        loadErrorMessage: "Could not load chart data. Try Refresh.",
      });
      const refs = domByMap[mapKey];
      state.controller.mount({ svg: refs.svg, tooltip: refs.tooltip, wrap: refs.wrap });
      createPollutantHandoff();
    }

    function syncChartSelectionTables() {
      syncTable("uk");
      syncTable("cr");
    }

    function renderPageModeAndTables() {
      pageMode.render();
      syncChartSelectionTables();
    }

    function tableRefs(mapKey) {
      return mapKey === "cr"
        ? { wrap: root.document.getElementById("cr-sensor-table-wrap"), body: root.document.getElementById("cr-sensor-table-body") }
        : { wrap: root.document.getElementById("sensor-table-wrap"), body: root.document.getElementById("sensor-table-body") };
    }

    function orderedVisibleIds(mapKey = chartMapKey()) {
      const table = tableRefs(mapKey).body;
      const visible = new Set(state.visibleEntries.map((entry) => entry.station_id));
      const ordered = Array.from(table?.querySelectorAll(".sensor-name-button[data-station-id]") || [])
        .map((button) => String(button.dataset.stationId || "").trim()).filter((id) => visible.has(id));
      return ordered.length ? Array.from(new Set(ordered)) : Array.from(visible);
    }

    function syncTable(mapKey) {
      const refs = tableRefs(mapKey);
      if (!refs.wrap || !refs.body) return;
      const active = pageMode.isChartMode(mapKey) && isLifecycleMounted(mapKey);
      refs.wrap.classList.toggle("is-chart-select-mode", active);
      const selected = Array.from(state.selectedIds);
      refs.body.querySelectorAll("tr").forEach((row) => {
        if (row.classList.contains("sensor-row-divider")) return;
        const name = row.querySelector(".sensor-name-button[data-station-id]");
        const selectCell = row.querySelector("td.sensor-chart-select-col");
        const symbolCell = row.querySelector("td.sensor-chart-symbol-col");
        if (!name || !selectCell || !symbolCell) return;
        const id = String(name.dataset.stationId || "").trim();
        const isSelected = active && state.selectedIds.has(id);
        row.classList.toggle("sensor-row--chart-selected", isSelected);
        row.classList.toggle("is-selected", isSelected);
        if (!active) {
          selectCell.innerHTML = "";
          symbolCell.innerHTML = id ? `<button type="button" class="sensor-chart-launch" data-station-id="${escapeHtml(id)}" aria-label="Open chart for ${escapeHtml(name.textContent.trim())}" title="Open chart"><img src="/images/UK-AQ-Sensor-Buttons-chart.svg" alt="" aria-hidden="true" /></button>` : "";
          return;
        }
        const index = Math.max(0, selected.indexOf(id));
        selectCell.innerHTML = `<button type="button" class="hex-chart-selector" data-station-id="${escapeHtml(id)}" aria-label="${isSelected ? "Remove" : "Add"} ${escapeHtml(name.textContent.trim())} from chart" aria-pressed="${isSelected ? "true" : "false"}"></button>`;
        symbolCell.innerHTML = root.ChartCore.getSymbolSvgMarkup(index, { className: "hex-chart-symbol-svg chart-mode-sensor-symbol-svg", sizePx: 28, area: 160 });
      });
      const ordered = active ? orderedVisibleIds(mapKey) : [];
      const selectFill = refs.wrap.querySelector(".hex-chart-selector[data-chart-header-action='select-fill']");
      const keepTop = refs.wrap.querySelector(".hex-chart-selector[data-chart-header-action='keep-top']");
      if (selectFill) selectFill.disabled = !active || state.selectedIds.size >= MAX_SELECTED_SENSORS || !ordered.some((id) => !state.selectedIds.has(id));
      if (keepTop) keepTop.disabled = !active || state.selectedIds.size <= 1 || !ordered.length;
    }

    function renderChips(context = currentContext()) {
      const reading = dom()?.reading;
      if (!reading) return;
      const selected = selectedEntries();
      const adapter = mapAdapter();
      reading.innerHTML = selected.map((entry, index) => {
        const id = entry.station_id;
        const stationName = String(entry.stationName || entry.station_name || "Unknown sensor");
        const network = String(entry.networkLabel || entry.network_label || "Unknown network");
        const value = Number(entry.value);
        const readingValue = Number.isFinite(value) ? `${value.toFixed(1)} ${entry.units || context?.units || ""}`.trim() : "No data";
        const updated = entry.timestamp ? new Date(entry.timestamp).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "--:--";
        const colour = adapter?.getSensorCurrentColor?.(id) || "var(--no-data)";
        const source = id === state.aqiSourceId;
        const symbol = root.ChartCore.getSymbolSvgMarkup(index, { className: "hex-chart-symbol-svg chart-mode-sensor-symbol-svg", sizePx: 22, area: 120 });
        return `<div class="hex-chart-selected-sensor-chip${source ? " is-aqi-source" : ""}" role="button" tabindex="0" data-aqi-source-station-id="${escapeHtml(id)}" aria-pressed="${source ? "true" : "false"}" aria-label="Use ${escapeHtml(stationName)} for DAQI and EAQI bands"><span class="hex-chart-chip-symbol">${symbol}</span><span class="hex-chart-chip-label"><span class="hex-chart-chip-name">${escapeHtml(stationName)}</span><span class="hex-chart-chip-network">· ${escapeHtml(network)}</span></span><span class="hex-chart-chip-value"><span class="sensor-reading-dot" style="--sensor-reading-color:${escapeHtml(colour)}"></span>${escapeHtml(readingValue)}</span><span class="hex-chart-chip-time">${escapeHtml(updated)}</span></div>`;
      }).join("");
    }

    function notifySelection() {
      root.dispatchEvent(new CustomEvent("hexchartselectionchange", { detail: {
        isChartMode: pageMode.isChartMode(),
        mapKey: chartMapKey(),
        selectedPrimaryId: Array.from(state.selectedIds)[0] || null,
        selectedAqiSensorId: state.aqiSourceId,
        selectedSensorIds: Array.from(state.selectedIds),
      } }));
    }

    function commitSelection(options = {}) {
      selectedEntries().forEach((entry) => state.retainedEntries.set(entry.station_id, entry));
      if (!state.selectedIds.has(state.aqiSourceId)) state.aqiSourceId = Array.from(state.selectedIds)[0] || null;
      renderChips();
      syncTable(chartMapKey());
      notifySelection();
      return options.reload === false ? Promise.resolve() : state.controller?.setSelection(selectedEntries());
    }

    function enter(options = {}) {
      const mapKey = options.mapKey || root.mapTabController?.getActiveTab?.() || "uk";
      if (mapKey !== "uk" && mapKey !== "cr") return false;
      const context = currentContext(mapKey);
      const identity = contextIdentity(mapKey, context);
      if (!identity) return false;
      exit();
      state.lifecycleMounted = true;
      state.sessionIdentity = identity;
      state.rangeLabel = "24h";
      state.visibleEntries = (context.entries || []).map((entry) => normalizeEntry(entry, context)).filter(Boolean);
      const requested = String(options.initialSensorId ?? options.initialStationId ?? "").trim();
      const initial = state.visibleEntries.find((entry) => entry.station_id === requested) || state.visibleEntries[0] || null;
      state.selectedIds = new Set(initial ? [initial.station_id] : []);
      state.retainedEntries = new Map(initial ? [[initial.station_id, initial]] : []);
      state.aqiSourceId = initial?.station_id || null;
      if (rangeSelect) rangeSelect.value = state.rangeLabel;
      pageMode.enterChart(mapKey);
      syncChartSelectionTables();
      createController(mapKey);
      void state.controller.setRange(resolveRange(state.rangeLabel));
      state.pollutantAdapter.sync({ ...context, entries: state.visibleEntries }, context.dataStatus);
      return true;
    }

    function exit() {
      const previousMapKey = chartMapKey();
      state.pollutantAdapter?.destroy?.();
      state.pollutantContextController?.destroy?.();
      state.controller?.destroy?.();
      state.pollutantAdapter = null;
      state.pollutantContextController = null;
      state.controller = null;
      state.renderer = null;
      state.lifecycleMounted = false;
      state.sessionIdentity = "";
      state.visibleEntries = [];
      state.selectedIds = new Set();
      state.retainedEntries = new Map();
      state.aqiSourceId = null;
      pageMode.exitChart();
      syncChartSelectionTables();
      if (previousMapKey) syncTable(previousMapKey);
      notifySelection();
    }

    function selectSensor(stationId, options = {}) {
      const id = String(stationId || "").trim();
      if (!isLifecycleMounted(options.mapKey) || !id) return false;
      if (!state.visibleEntries.some((entry) => entry.station_id === id)) return false;
      if (options.mode !== "toggle") {
        state.selectedIds = new Set([id]);
        state.aqiSourceId = id;
      } else if (state.selectedIds.has(id)) {
        if (state.selectedIds.size <= 1) { setMessage("Keep at least 1 sensor selected."); return false; }
        state.selectedIds.delete(id);
      } else {
        if (state.selectedIds.size >= MAX_SELECTED_SENSORS) { setMessage("You can compare up to 4 sensors."); return false; }
        state.selectedIds.add(id);
      }
      void commitSelection();
      return true;
    }

    function setAqiSource(id) {
      const stationId = String(id || "").trim();
      if (!state.selectedIds.has(stationId) || stationId === state.aqiSourceId) return false;
      state.aqiSourceId = stationId;
      renderChips();
      syncTable(chartMapKey());
      notifySelection();
      void state.controller.setAqiSource(stationId);
      return true;
    }

    function applyHeaderSelectionAction(action, options = {}) {
      if (!isLifecycleMounted(options.mapKey)) return false;
      const ordered = orderedVisibleIds(chartMapKey());
      if (action === "keep-top" && ordered[0]) {
        state.selectedIds = new Set([ordered[0]]);
        state.aqiSourceId = ordered[0];
      } else if (action === "select-fill") {
        for (const id of ordered) {
          if (state.selectedIds.size >= MAX_SELECTED_SENSORS) break;
          state.selectedIds.add(id);
        }
      } else return false;
      void commitSelection();
      return true;
    }

    function syncFromMap(mapKey = chartMapKey(), options = {}) {
      if (!isLifecycleMounted(mapKey)) return false;
      const context = currentContext(mapKey);
      if (contextIdentity(mapKey, context) !== state.sessionIdentity) {
        if (options.preserveChartMode) { renderPageModeAndTables(); return false; }
        exit();
        return false;
      }
      const visibleEntries = (context.entries || []).map((entry) => normalizeEntry(entry, context)).filter(Boolean);
      const normalizedContext = { ...context, entries: visibleEntries };
      const status = state.pollutantAdapter?.resolveStatus(normalizedContext, options.dataStatus);
      const pollutant = domain.normalizePollutant(normalizedContext.pollutant);
      if (status !== "ready" || pollutant !== state.pollutantContextController?.renderedPollutant) {
        return state.pollutantAdapter?.sync(normalizedContext, options.dataStatus) === true;
      }
      state.visibleEntries = visibleEntries;
      const visibleIds = new Set(state.visibleEntries.map((entry) => entry.station_id));
      state.selectedIds.forEach((id) => {
        const visible = state.visibleEntries.find((entry) => entry.station_id === id);
        if (visible) state.retainedEntries.set(id, visible);
        else if (domain.normalizePollutant(state.retainedEntries.get(id)?.pollutant) !== domain.normalizePollutant(context.pollutant)) state.retainedEntries.delete(id);
      });
      const nextIds = Array.from(state.selectedIds).filter((id) => visibleIds.has(id));
      if (!nextIds.length && state.visibleEntries[0]) nextIds.push(state.visibleEntries[0].station_id);
      state.selectedIds = new Set(nextIds);
      if (!state.selectedIds.has(state.aqiSourceId)) state.aqiSourceId = nextIds[0] || null;
      void commitSelection({ reload: options.updateChart !== false });
      return true;
    }

    async function refresh() {
      if (!isLifecycleMounted()) return;
      await mapAdapter()?.refreshForChartMode?.();
      const pollutant = domain.normalizePollutant(currentContext()?.pollutant);
      if (pollutant && pollutant === state.pollutantContextController?.renderedPollutant) {
        await state.controller?.setRange(resolveRange(state.rangeLabel));
      }
    }

    rangeSelect?.addEventListener("change", () => {
      if (!isLifecycleMounted()) return;
      state.rangeLabel = normalizeRangeLabel(rangeSelect.value);
      rangeSelect.value = state.rangeLabel;
      void state.controller?.setRange(resolveRange(state.rangeLabel));
    });
    backButton?.addEventListener("click", exit);
    root.addEventListener("resize", () => {
      if (isLifecycleMounted()) state.controller?.resize({});
    });
    Object.values(domByMap).forEach((refs) => {
      refs.panel?.addEventListener("click", (event) => event.stopPropagation());
      const activateSource = (event) => {
        if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
        const target = event.target instanceof Element ? event.target.closest("[data-aqi-source-station-id]") : null;
        if (!target) return;
        if (event.type === "keydown") event.preventDefault();
        setAqiSource(target.getAttribute("data-aqi-source-station-id"));
      };
      refs.reading?.addEventListener("click", activateSource);
      refs.reading?.addEventListener("keydown", activateSource);
    });

    root.hexChartMode = Object.freeze({
      enter,
      exit,
      refresh,
      syncFromMap,
      applyHeaderSelectionAction,
      selectSensor,
      isActive: (mapKey = null) => pageMode.isChartMode(mapKey),
      isSensorSelected: (mapKey = null, id = "") => Boolean(pageMode.isChartMode(mapKey) && isLifecycleMounted(mapKey) && state.selectedIds.has(String(id))),
      getSelectedSensorIds: (mapKey = null) => pageMode.isChartMode(mapKey) && isLifecycleMounted(mapKey) ? Array.from(state.selectedIds) : [],
      getSelectedSensorIndex: (mapKey = null, id = "") => pageMode.isChartMode(mapKey) && isLifecycleMounted(mapKey) ? Array.from(state.selectedIds).indexOf(String(id)) : -1,
    });
    return root.hexChartMode;
  }

  if (root.document?.addEventListener && root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", installHexMapStationChart, { once: true });
  } else if (root.document) {
    queueMicrotask(installHexMapStationChart);
  }

  return { createHexMapStationChartAdapter, installHexMapStationChart, normalizeEntry, resolveRange };
});
