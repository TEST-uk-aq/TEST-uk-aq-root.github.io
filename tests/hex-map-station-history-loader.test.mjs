import assert from "node:assert/strict";
import fs from "node:fs";
import controllerModule from "../shared/station-chart/station-chart-controller.js";
import sourceModule from "../shared/station-chart/aqi-source-controller.js";

const page = fs.readFileSync(new URL("../hex_map/index.html", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../hex_map/hex-map-station-chart-adapter.js", import.meta.url), "utf8");
const networkControls = fs.readFileSync(new URL("../hex_map/hex-map-network-controls.js", import.meta.url), "utf8");
const controllerSource = fs.readFileSync(new URL("../shared/station-chart/station-chart-controller.js", import.meta.url), "utf8");
const calculatedClientSource = fs.readFileSync(new URL("../shared/station-chart/station-history-client.js", import.meta.url), "utf8");
const compatibilityClientSource = fs.readFileSync(new URL("../shared/station-chart/station-history-compatibility-client.js", import.meta.url), "utf8");

for (const script of [
  "station-chart-domain.js",
  "station-chart-cache.js",
  "station-chart-diagnostics.js",
  "aqi-source-controller.js",
  "pollutant-context-controller.js",
  "station-history-loader.js",
  "station-history-client.js",
  "station-history-compatibility-client.js",
  "station-chart-renderer.js",
  "station-chart-controller.js",
]) {
  assert.match(page, new RegExp(`<script src="/shared/station-chart/${script.replaceAll(".", "\\.")}"></script>`));
}
assert.match(page, /<link rel="stylesheet" href="\/shared\/station-chart\/station-chart\.css">/);
assert.match(page, /<script src="\/hex_map\/hex-map-website-debug\.js"><\/script>/);
assert.doesNotMatch(page, /async function loadStationHistoryChartData|async function loadLegacyChartData|function renderAqiBands|function updateChart\(|const stationHistoryCache|window\.hexChartMode\s*=/);

for (const source of [calculatedClientSource, compatibilityClientSource]) {
  assert.match(source, /loadCurrent/);
  assert.match(source, /loadOlder/);
  assert.match(source, /prefetchAqi/);
}
assert.match(controllerSource, /function setSelection/);
assert.match(controllerSource, /function setAqiSource/);
assert.match(controllerSource, /function setRange/);
assert.match(controllerSource, /function refresh/);
assert.match(controllerSource, /function resize/);
assert.match(controllerSource, /function destroy/);
assert.doesNotMatch(controllerSource, /\bd3\.|querySelector|createElement|appendChild/);

assert.match(networkControls, /installNetworkScopeDropdownGuard/);
assert.match(networkControls, /guardedEnsureSearchDataLoaded/);
assert.doesNotMatch(adapter, /installNetworkScopeDropdownGuard|guardedEnsureSearchDataLoaded/);
assert.doesNotMatch(adapter, /\bd3\.|fetchStation|fetchAqi|stationHistoryCache|aqiBandCache|seriesDataCache/);

const counters = { current: 0, older: 0, prefetch: 0, axes: 0, observations: 0, aqi: 0, clearAqi: 0 };
const makeResult = (request, parts) => ({
  result_version: "station-history-browser-v1",
  source: "calculated",
  identity_valid: true,
  identity: {
    source: "test",
    timeseries_id: request.timeseries_id,
    connector_id: request.connector_id,
    station_id: request.station_id,
    pollutant: request.pollutant,
  },
  observations: {
    enabled: parts.observations === true,
    rows: [],
    points: [],
    response_complete: true,
    has_gap: false,
  },
  aqi: {
    enabled: parts.aqi === true,
    rows: [],
    points: [],
    response_complete: true,
    has_gap: false,
    calculation_source: "calculated_from_observations",
  },
  raw: {},
});
const client = {
  kind: "calculated",
  async loadCurrent(request, parts) { counters.current += 1; return makeResult(request, parts); },
  async loadOlder(request, parts) { counters.older += 1; return makeResult(request, parts); },
  async prefetchAqi(request) { counters.prefetch += 1; return makeResult(request, { observations: false, aqi: true }); },
};
const renderer = {
  initialise() {},
  renderAxes() { counters.axes += 1; },
  renderObservations() { counters.observations += 1; },
  renderAqi() { counters.aqi += 1; },
  clearAqi() { counters.clearAqi += 1; },
  setLoading() {},
  destroy() {},
};
const aqiSourceController = sourceModule.createAqiSourceController({ transitionMs: 0, wait: async () => {} });
const controller = controllerModule.createStationChartController({
  renderer,
  calculatedClient: client,
  compatibilityClient: client,
  aqiSourceController,
});
controller.mount({});
await controller.setRange({ start_utc: "2026-08-12T00:00:00Z", end_utc: "2026-08-12T01:00:00Z" });
await controller.setSelection([
  { station_id: 101, timeseries_id: 201, connector_id: 301, pollutant: "pm25" },
  { station_id: 102, timeseries_id: 202, connector_id: 302, pollutant: "pm25" },
]);
await new Promise((resolve) => setTimeout(resolve, 0));
const beforeSwitch = { ...counters };
await controller.setAqiSource("102");
assert.equal(counters.current, beforeSwitch.current, "a settled AQI source switch starts no current request");
assert.equal(counters.older, beforeSwitch.older, "a settled AQI source switch starts no older request");
assert.equal(counters.prefetch, beforeSwitch.prefetch, "a settled AQI source switch starts no AQI request");
assert.equal(counters.axes, beforeSwitch.axes, "AQI-only source switching does not repaint axes");
assert.equal(counters.observations, beforeSwitch.observations, "AQI-only source switching does not repaint observations");
assert.equal(counters.clearAqi, beforeSwitch.clearAqi + 1, "the old AQI layer is cleared once");
assert.equal(counters.aqi, beforeSwitch.aqi + 1, "the target AQI layer commits once");
controller.destroy();

console.log("Hex Map shared station-chart harness passed");
