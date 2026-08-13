(function initHexMapCoordinator(root) {
  "use strict";

  if (!root?.document || !document.body.classList.contains("hex-map-page")) return;

  const pollutantDomain = root.UkAqPollutants;
  const networkController = root.UkAqHexMapNetworkController;
  if (!pollutantDomain?.normalize || !networkController?.setActiveScope) {
    throw new Error("Hex coordinator dependencies must load before the coordinator.");
  }

  const MAP_KEYS = new Set(["uk", "cr"]);
  const METRICS = new Set(["mean", "median"]);
  const COLOR_SCALES = new Set(["linear", "power"]);
  const WINDOWS = new Set(["3h", "6h", "1d", "7d", "all"]);
  const params = new URLSearchParams(root.location.search);
  const maps = new Map();
  let activeMapPresenter = null;
  const state = {
    activeMap: "uk",
    pollutant: pollutantDomain.normalize(params.get("pollutant")) || "pm25",
    settings: {
      metric: METRICS.has(params.get("metric")) ? params.get("metric") : "mean",
      colorScale: COLOR_SCALES.has(params.get("color_scale")) ? params.get("color_scale") : "power",
      window: "6h",
    },
  };

  function mapSettingsSnapshot() {
    return Object.freeze({ ...state.settings });
  }

  function stateSnapshot() {
    return Object.freeze({
      activeMap: state.activeMap,
      pollutant: state.pollutant,
      mapSettings: mapSettingsSnapshot(),
    });
  }

  function replaceQueryParam(key, value) {
    const url = new URL(root.location.href);
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    root.history.replaceState({}, "", url);
  }

  function orderedMapAdapters(source) {
    const entries = Array.from(maps.entries());
    if (!MAP_KEYS.has(source)) return entries;
    return [
      ...entries.filter(([mapKey]) => mapKey === source),
      ...entries.filter(([mapKey]) => mapKey !== source),
    ];
  }

  function setPollutant(value, options = {}) {
    const pollutant = pollutantDomain.normalize(value);
    if (!pollutant || pollutant === state.pollutant) return false;
    state.pollutant = pollutant;
    if (options.updateUrl !== false) replaceQueryParam("pollutant", pollutant);

    orderedMapAdapters(options.source).forEach(([, adapter]) => {
      adapter.setPollutant?.(pollutant, { source: options.source || null });
    });
    root.dispatchEvent(new CustomEvent("pollutantchange", {
      detail: { pollutant, source: options.source || null },
    }));
    return true;
  }

  function updateMapSettings(partial, options = {}) {
    if (!partial || typeof partial !== "object") return false;
    const next = {
      metric: METRICS.has(partial.metric) ? partial.metric : state.settings.metric,
      colorScale: COLOR_SCALES.has(partial.colorScale) ? partial.colorScale : state.settings.colorScale,
      window: WINDOWS.has(partial.window) ? partial.window : state.settings.window,
    };
    const changed = next.metric !== state.settings.metric
      || next.colorScale !== state.settings.colorScale
      || next.window !== state.settings.window;
    state.settings = next;

    if (partial.metric) replaceQueryParam("metric", next.metric);
    if (partial.colorScale) replaceQueryParam("color_scale", next.colorScale);
    if (!changed) return false;

    const snapshot = mapSettingsSnapshot();
    orderedMapAdapters(options.source).forEach(([, adapter]) => {
      adapter.setMapSettings?.(snapshot, { source: options.source || null });
    });
    root.dispatchEvent(new CustomEvent("mapsettingschange", {
      detail: { ...snapshot, source: options.source || null },
    }));
    return true;
  }

  function setActiveMap(value, options = {}) {
    const mapKey = String(value || "").trim().toLowerCase();
    if (!MAP_KEYS.has(mapKey)) return false;
    const previousMap = state.activeMap;
    const changed = previousMap !== mapKey;
    state.activeMap = mapKey;

    activeMapPresenter?.(mapKey, {
      previousMap,
      changed,
      source: options.source || null,
    });
    networkController.setActiveScope(mapKey);
    maps.get(mapKey)?.activate?.({
      previousMap,
      changed,
      source: options.source || null,
    });
    return changed;
  }

  function registerMap(mapKey, adapter) {
    const normalized = String(mapKey || "").trim().toLowerCase();
    if (!MAP_KEYS.has(normalized) || !adapter || typeof adapter !== "object") return false;
    maps.set(normalized, Object.freeze({ ...adapter }));
    return true;
  }

  function registerActiveMapPresenter(presenter) {
    if (typeof presenter !== "function") return false;
    activeMapPresenter = presenter;
    return true;
  }

  const api = Object.freeze({
    getState: stateSnapshot,
    getActiveMap: () => state.activeMap,
    setActiveMap,
    getPollutant: () => state.pollutant,
    setPollutant,
    getMapSettings: mapSettingsSnapshot,
    updateMapSettings,
    registerMap,
    registerActiveMapPresenter,
    getNetworkController: () => networkController,
  });

  root.UkAqHexMapCoordinator = api;
  Object.defineProperty(root, "mapSettingsState", {
    configurable: true,
    enumerable: true,
    get: mapSettingsSnapshot,
  });
  root.updateMapSettings = (partial, source) => api.updateMapSettings(partial, { source });
})(typeof globalThis !== "undefined" ? globalThis : this);
