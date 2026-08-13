// Authoritative Hex Map application URL and browser-history adapter.
(function initHexMapUrlState(root) {
  "use strict";

  if (!root?.document || !root.document.body.classList.contains("hex-map-page")) return;
  if (root.UkAqHexMapUrlState) return;

  const pollutantDomain = root.UkAqPollutants;
  if (!pollutantDomain?.normalize) {
    throw new Error("UkAqPollutants must load before the Hex Map URL-state adapter.");
  }

  const REGION_OPTIONS = [
    "Northern Ireland",
    "Scotland",
    "Wales",
    "East Midlands",
    "East of England",
    "London",
    "North East",
    "North West",
    "South East",
    "South West",
    "West Midlands",
    "Yorkshire and The Humber",
  ];
  const REGION_LOOKUP = new Map(REGION_OPTIONS.map((name) => [name.toLowerCase(), name]));
  const METRICS = new Set(["mean", "median"]);
  const COLOR_SCALES = new Set(["linear", "power"]);
  const DEFAULT_CR_REGION = "London";

  function normalizeMap(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === "uk") return "UK";
    return REGION_LOOKUP.get(trimmed.toLowerCase()) || null;
  }

  function normalizeCrRegion(value) {
    const normalized = normalizeMap(value);
    return normalized && normalized !== "UK" ? normalized : null;
  }

  const initialParams = new URLSearchParams(root.location.search);
  const initialMapParam = initialParams.get("map");
  const initialMap = normalizeMap(initialMapParam) || "UK";
  const initialState = Object.freeze({
    map: initialMap,
    pollutant: pollutantDomain.normalize(initialParams.get("pollutant")) || "pm25",
    mapSettings: Object.freeze({
      metric: METRICS.has(initialParams.get("metric")) ? initialParams.get("metric") : "mean",
      colorScale: COLOR_SCALES.has(initialParams.get("color_scale")) ? initialParams.get("color_scale") : "power",
    }),
    shouldCanonicalizeMap: !initialMapParam,
  });
  let lastCrRegion = normalizeCrRegion(initialMap) || DEFAULT_CR_REGION;
  let bootstrapped = false;

  function initialStateSnapshot() {
    return Object.freeze({
      ...initialState,
      mapSettings: Object.freeze({ ...initialState.mapSettings }),
    });
  }

  function coordinator() {
    const value = root.UkAqHexMapCoordinator;
    if (!value?.getActiveMap || !value?.setActiveMap) {
      throw new Error("Hex Map coordinator is unavailable.");
    }
    return value;
  }

  function crController() {
    const value = root.UkAqHexMapCrController || root.crMap;
    if (!value?.setRegion) {
      throw new Error("C&R Hex Map controller is unavailable.");
    }
    return value;
  }

  function writeUrl(url, options = {}) {
    if (options.push) root.history.pushState({}, "", url);
    else root.history.replaceState({}, "", url);
  }

  function writeParameter(key, value, options = {}) {
    const url = new URL(root.location.href);
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    writeUrl(url, options);
  }

  function updateMapParam(value, options = {}) {
    writeParameter("map", value, options);
  }

  function syncPollutant(value) {
    const pollutant = pollutantDomain.normalize(value);
    if (!pollutant) return false;
    writeParameter("pollutant", pollutant);
    return true;
  }

  function syncMetric(value) {
    if (!METRICS.has(value)) return false;
    writeParameter("metric", value);
    return true;
  }

  function syncColorScale(value) {
    if (!COLOR_SCALES.has(value)) return false;
    writeParameter("color_scale", value);
    return true;
  }

  function noteCrRegion(value) {
    const normalized = normalizeCrRegion(value);
    if (!normalized) return false;
    lastCrRegion = normalized;
    return true;
  }

  function syncCrRegion(value, options = {}) {
    const normalized = normalizeCrRegion(value);
    if (!normalized) return false;
    lastCrRegion = normalized;
    updateMapParam(normalized, { push: Boolean(options.push) });
    return true;
  }

  function setCrRegion(region, options = {}) {
    const normalized = normalizeCrRegion(region) || DEFAULT_CR_REGION;
    lastCrRegion = normalized;
    crController().setRegion(normalized, { updateUrl: false });
    if (options.updateUrl !== false) {
      updateMapParam(normalized, { push: options.push !== false });
    }
    return normalized;
  }

  function applyMap(mapValue, options = {}) {
    if (mapValue === "UK") {
      coordinator().setActiveMap("uk", { source: options.source || "map" });
      if (options.updateUrl) updateMapParam("UK", { push: Boolean(options.push) });
      return "UK";
    }
    const normalized = normalizeCrRegion(mapValue) || DEFAULT_CR_REGION;
    lastCrRegion = normalized;
    coordinator().setActiveMap("cr", { source: options.source || "map" });
    setCrRegion(normalized, options);
    return normalized;
  }

  function switchToUk(options = {}) {
    return applyMap("UK", {
      updateUrl: options.updateUrl !== false,
      push: options.push !== false,
      source: options.source,
    });
  }

  function switchToCr(region, options = {}) {
    const target = normalizeCrRegion(region) || lastCrRegion || DEFAULT_CR_REGION;
    return applyMap(target, {
      updateUrl: options.updateUrl !== false,
      push: options.push !== false,
      source: options.source,
    });
  }

  function handlePopState() {
    const nextMap = normalizeMap(new URLSearchParams(root.location.search).get("map")) || "UK";
    applyMap(nextMap, { updateUrl: false, source: "map" });
  }

  function bootstrap() {
    if (bootstrapped) return false;
    bootstrapped = true;
    root.addEventListener("popstate", handlePopState);
    applyMap(initialState.map, {
      updateUrl: initialState.shouldCanonicalizeMap,
      push: false,
      source: "map",
    });
    return true;
  }

  const api = Object.freeze({
    getInitialState: initialStateSnapshot,
    getInitialCrRegion: () => normalizeCrRegion(initialState.map) || DEFAULT_CR_REGION,
    getLastCrRegion: () => lastCrRegion,
    getActiveTab: () => coordinator().getActiveMap(),
    switchToUk,
    switchToCr,
    setCrRegion,
    noteCrRegion,
    syncCrRegion,
    syncPollutant,
    syncMetric,
    syncColorScale,
    updateMapParam,
    handlePopState,
    bootstrap,
  });

  root.UkAqHexMapUrlState = api;
  root.mapTabController = Object.freeze({
    getActiveTab: () => api.getActiveTab(),
    switchToUk: (options) => api.switchToUk(options),
    switchToCr: (region, options) => api.switchToCr(region, options),
    setCrRegion: (region, options) => api.setCrRegion(region, options),
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
