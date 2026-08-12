// Sensors-page integration for the shared station-chart subsystem.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("../shared/station-chart/station-chart-domain.js") : null);
  const api = factory(root, domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqSensorStationChartAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, domain) {
  "use strict";

  if (!domain) throw new Error("UkAqStationChartDomain is required");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RANGE_VALUES = new Set(["12h", "24h", "7d", "31d", "90d"]);

  function parseBooleanFlag(value, fallback) {
    if (value === null || value === undefined || value === "") return Boolean(fallback);
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return Boolean(fallback);
  }

  function positiveInteger(value) {
    const text = String(value ?? "").trim();
    return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
  }

  function normalizeIso(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function normalizeEntry(value) {
    const stationId = positiveInteger(value?.station_id ?? value?.stationId);
    const timeseriesId = positiveInteger(value?.timeseries_id ?? value?.timeseriesId ?? value?.id);
    const connectorId = positiveInteger(value?.connector_id ?? value?.connectorId);
    const pollutant = domain.normalizePollutant(value?.pollutant ?? value?.pollutant_code);
    if (!stationId || !timeseriesId || !connectorId || !pollutant) return null;
    return Object.freeze({
      ...value,
      station_id: String(stationId),
      timeseries_id: timeseriesId,
      connector_id: connectorId,
      pollutant,
      units: value?.units || value?.unit || "µg/m³",
    });
  }

  function cacheBaseUrl(params) {
    const explicit = String(params.get("cache_base") || "").trim();
    if (explicit) return explicit.replace(/\/+$/, "");
    if (root.location?.protocol === "http:" || root.location?.protocol === "https:") {
      return `${root.location.origin.replace(/\/$/, "")}/api/aq`;
    }
    return "https://cic-test.chronicillnesschannel.co.uk/api/aq";
  }

  function createRangeResolver(params, rangeSelect) {
    const fixedDays = positiveInteger(params.get("series_days") || params.get("days"));
    const fixedStart = normalizeIso(params.get("series_start") || params.get("start"));
    const fixedEnd = normalizeIso(params.get("series_end") || params.get("end"));
    const fixedExplicit = Boolean(fixedStart && fixedEnd && Date.parse(fixedEnd) > Date.parse(fixedStart));
    if (rangeSelect && (fixedExplicit || fixedDays)) {
      rangeSelect.disabled = true;
      rangeSelect.title = "Range is fixed by URL parameter.";
    }

    function label() {
      if (fixedExplicit) return "custom";
      if (fixedDays) return `${fixedDays}d`;
      const selected = String(rangeSelect?.value || "24h");
      return RANGE_VALUES.has(selected) ? selected : "24h";
    }

    function range() {
      if (fixedExplicit) return domain.snapshotChartRange({ start_utc: fixedStart, end_utc: fixedEnd });
      const end = new Date();
      const selected = label();
      const duration = fixedDays ? fixedDays * DAY_MS
        : selected === "12h" ? 12 * 60 * 60 * 1000
          : selected === "7d" ? 7 * DAY_MS
            : selected === "31d" ? 31 * DAY_MS
              : selected === "90d" ? 90 * DAY_MS
                : DAY_MS;
      return domain.snapshotChartRange({
        start_utc: new Date(end.getTime() - duration).toISOString(),
        end_utc: end.toISOString(),
      });
    }

    function olderChunkMs() {
      const value = range();
      const duration = value ? value.endMs - value.startMs : DAY_MS;
      if (duration <= DAY_MS * 1.1) return 6 * 60 * 60 * 1000;
      if (duration <= 7 * DAY_MS * 1.1) return DAY_MS;
      if (duration <= 31 * DAY_MS * 1.1) return 3 * DAY_MS;
      return 7 * DAY_MS;
    }

    return Object.freeze({ label, range, olderChunkMs, fixed: fixedExplicit || Boolean(fixedDays) });
  }

  function contextGuard(load) {
    return Object.freeze({ generation: load.generation, signal: load.signal, isCurrent: load.isCurrent });
  }

  function createSensorStationChartAdapter(options = {}) {
    const params = options.params || new URLSearchParams(root.location?.search || "");
    const rangeSelect = options.rangeSelect || root.document?.getElementById("window-select");
    const refreshButton = options.refreshButton || root.document?.getElementById("chart-refresh");
    const statusElement = options.statusElement || root.document?.getElementById("chart-status");
    const statusIndicator = statusElement?.closest?.(".status-indicator") || null;
    const errorElement = options.errorElement || root.document?.getElementById("chart-error");
    const hintElement = options.hintElement || root.document?.getElementById("chart-hint");
    const wrap = options.wrap || root.document?.querySelector(".station-chart-wrap");
    const svg = options.svg || root.document?.getElementById("line-chart");
    const tooltip = options.tooltip || root.document?.getElementById("chart-tooltip");
    const baseUrl = cacheBaseUrl(params);
    const rangeResolver = createRangeResolver(params, rangeSelect);
    const fetchApi = typeof options.fetchApi === "function" ? options.fetchApi : function (url, init) {
      return typeof root.ukAqFetchCacheApi === "function" ? root.ukAqFetchCacheApi(url, init) : root.fetch(url, init);
    };
    const scheduler = root.UkAqStationHistoryLoader.createPriorityFetchScheduler(6);
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
    });
    const explicitAqiBase = String(params.get("aqi_history_base") || "").trim();
    const compatibilityClient = root.UkAqCompatibilityStationHistoryClient.createCompatibilityStationHistoryClient({
      observationUrl: `${baseUrl}/timeseries`,
      aqiHistoryUrls: [
        explicitAqiBase,
        `${baseUrl}/aqi-history`,
        "https://cic-test.chronicillnesschannel.co.uk/api/aq/aqi-history",
      ].filter(Boolean),
      fetchApi,
      scheduler,
      proxyV2Enabled: parseBooleanFlag(params.get("timeseries_v2"), true),
      priorities: { observations: 0, aqi: 0, prefetch: 2 },
    });
    const renderer = root.UkAqStationChartRenderer.createStationChartRenderer({
      getWindowLabel: rangeResolver.label,
      noHistoryMessage: "No observations in this window.",
    });

    function setStatus(value) {
      if (statusElement) statusElement.textContent = String(value || "");
      if (statusIndicator) statusIndicator.dataset.state = value === "Live" ? "live" : "idle";
    }

    function setError(value) {
      if (errorElement) errorElement.textContent = String(value || "");
    }

    const controller = root.UkAqStationChartController.createStationChartController({
      renderer,
      calculatedClient,
      compatibilityClient,
      diagnostics,
      maxSelection: 1,
      useCompatibility: !parseBooleanFlag(params.get("station_history_loader"), true),
      getWindowLabel: rangeResolver.label,
      olderChunkMs: rangeResolver.olderChunkMs,
      cacheContract: "sensors-station-history-v8-shared-controller",
      onMessage(message, messageOptions = {}) {
        setError(messageOptions.error === true ? message : "");
        if (messageOptions.error === true) setStatus("Error");
      },
      emptyMessage: "Select a station to view a trend.",
      loadErrorMessage: "Unable to load station history.",
    });
    const pollutantController = root.UkAqPollutantContextController.createPollutantContextController({
      onLoading(load) {
        void controller.replacePollutantContext({
          pollutant: load.pollutant,
          status: "loading",
          entries: [],
          selectedStationIds: [],
          primaryStationId: null,
          aqiSourceStationId: null,
          renderMode: load.renderMode,
          contextGuard: contextGuard(load),
        });
      },
      onFailed(load) {
        void controller.replacePollutantContext({
          pollutant: load.pollutant,
          status: "failed",
          entries: [],
          selectedStationIds: [],
          primaryStationId: null,
          aqiSourceStationId: null,
          renderMode: load.renderMode,
          contextGuard: contextGuard(load),
        });
      },
      async onRender(load) {
        const result = await controller.replacePollutantContext({
          pollutant: load.pollutant,
          status: "ready",
          entries: load.entries,
          selectedStationIds: load.selectedStationIds,
          primaryStationId: load.primaryStationId,
          aqiSourceStationId: load.aqiSourceStationId,
          renderMode: load.renderMode,
          contextGuard: contextGuard(load),
        });
        if (result?.committed === true) load.complete();
      },
    });
    let currentEntry = null;
    let mounted = false;
    let resizeFallbackInstalled = false;

    function updateHint(entry) {
      if (!hintElement) return;
      const supportsAqi = ["pm25", "pm10", "no2"].includes(entry?.pollutant);
      hintElement.textContent = supportsAqi
        ? "Line chart of raw observations for the selected station with DAQI and EAQI bands."
        : "Line chart of raw observations for the selected station. DAQI and EAQI bands are only available for PM2.5, PM10, and NO2.";
    }

    async function setEntry(rawEntry, config = {}) {
      const entry = normalizeEntry(rawEntry);
      const pollutant = entry?.pollutant || domain.normalizePollutant(config.pollutant);
      setError("");
      if (!entry) {
        currentEntry = null;
        updateHint(null);
        if (!pollutant) {
          await controller.setSelection([]);
          setStatus("No station selected");
          return false;
        }
        setStatus("Loading...");
        const result = await pollutantController.setPollutantContext({
          pollutant,
          status: "ready",
          entries: [],
          selectedStationIds: [],
          preserveRange: true,
          preserveSelection: false,
        });
        if (result?.committed === true) setStatus("No station selected");
        return result?.committed === true;
      }

      currentEntry = entry;
      updateHint(entry);
      setStatus("Loading...");
      if (pollutantController.renderedPollutant === entry.pollutant) {
        const result = await controller.setSelection([entry]);
        if (currentEntry === entry && result) setStatus("Live");
        return Boolean(result);
      }
      const result = await pollutantController.setPollutantContext({
        pollutant: entry.pollutant,
        status: "ready",
        entries: [entry],
        selectedStationIds: [entry.station_id],
        primaryStationId: entry.station_id,
        aqiSourceStationId: entry.station_id,
        preserveRange: true,
        preserveSelection: true,
      });
      if (currentEntry === entry && result?.committed === true) setStatus("Live");
      return result?.committed === true;
    }

    async function refresh() {
      if (!mounted) return null;
      setError("");
      setStatus("Loading...");
      const result = await controller.refresh();
      if (result) setStatus("Live");
      return result;
    }

    async function changeRange() {
      if (!mounted) return null;
      setError("");
      setStatus("Loading...");
      const result = await controller.setRange(rangeResolver.range());
      if (result) setStatus(currentEntry ? "Live" : "No station selected");
      return result;
    }

    function resize() { controller.resize({}); }
    function handleRangeChange() { void changeRange(); }
    function handleRefresh() { void refresh(); }

    async function mount() {
      if (mounted) return true;
      if (!svg || !wrap) throw new Error("sensors_station_chart_mount_missing");
      controller.mount({ svg, tooltip, wrap });
      mounted = true;
      rangeSelect?.addEventListener("change", handleRangeChange);
      refreshButton?.addEventListener("click", handleRefresh);
      if (!root.ResizeObserver) {
        root.addEventListener?.("resize", resize);
        resizeFallbackInstalled = true;
      }
      await controller.setRange(rangeResolver.range());
      setStatus("Waiting for series...");
      return true;
    }

    function destroy() {
      if (!mounted) return;
      rangeSelect?.removeEventListener("change", handleRangeChange);
      refreshButton?.removeEventListener("click", handleRefresh);
      if (resizeFallbackInstalled) root.removeEventListener?.("resize", resize);
      resizeFallbackInstalled = false;
      pollutantController.destroy();
      controller.destroy();
      mounted = false;
      currentEntry = null;
    }

    return Object.freeze({
      mount,
      destroy,
      setEntry,
      refresh,
      resize,
      normalizeEntry,
      get currentEntry() { return currentEntry; },
      get controller() { return controller; },
      get pollutantController() { return pollutantController; },
      get mounted() { return mounted; },
    });
  }

  return { createSensorStationChartAdapter, normalizeEntry, createRangeResolver, cacheBaseUrl };
});
