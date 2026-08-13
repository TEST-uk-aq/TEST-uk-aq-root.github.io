import assert from "node:assert/strict";
import fs from "node:fs";
import controllerModule from "../shared/station-chart/station-chart-controller.js";
import sourceModule from "../shared/station-chart/aqi-source-controller.js";
import cacheModule from "../shared/station-chart/station-chart-cache.js";
import historyLoaderModule from "../shared/station-chart/station-history-loader.js";
import rendererModule from "../shared/station-chart/station-chart-renderer.js";

const page = fs.readFileSync(new URL("../hex_map/index.html", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../hex_map/hex-map-station-chart-adapter.js", import.meta.url), "utf8");
const controllerSource = fs.readFileSync(new URL("../shared/station-chart/station-chart-controller.js", import.meta.url), "utf8");
const rendererSource = fs.readFileSync(new URL("../shared/station-chart/station-chart-renderer.js", import.meta.url), "utf8");
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
  assert.doesNotMatch(page, new RegExp(`<script src="/shared/station-chart/${script.replaceAll(".", "\\.")}"></script>`));
}
assert.match(page, /<link rel="stylesheet" href="\/shared\/station-chart\/station-chart\.css">/);
assert.match(page, /<script type="module" src="\/hex_map\/hex-map-bootstrap\.js"><\/script>/);
assert.doesNotMatch(page, /async function loadStationHistoryChartData|async function loadLegacyChartData|function renderAqiBands|function updateChart\(|const stationHistoryCache|window\.hexChartMode\s*=/);

for (const source of [calculatedClientSource, compatibilityClientSource]) {
  assert.match(source, /loadCurrent/);
  assert.match(source, /loadOlder/);
  assert.match(source, /prefetchAqi/);
}
assert.match(controllerSource, /function setSelection/);
assert.match(controllerSource, /function replacePollutantContext/);
assert.match(controllerSource, /function setAqiSource/);
assert.match(controllerSource, /function setRange/);
assert.match(controllerSource, /function refresh/);
assert.match(controllerSource, /function resize/);
assert.match(controllerSource, /function destroy/);
assert.doesNotMatch(controllerSource, /\bd3\.|querySelector|createElement|appendChild/);
assert.match(controllerSource, /createOrderedSettlementBuffer/);
assert.match(controllerSource, /renderer\.updateProgress/);
assert.match(rendererSource, /ChartCore\.renderProgressBar/);
assert.match(rendererSource, /function animateDomains/);
assert.match(rendererSource, /function replacePollutantContext/);
assert.match(rendererSource, /const endY = observationDomain\(state\)/);
assert.match(rendererSource, /startY\[0\] \+ \(endY\[0\] - startY\[0\]\) \* eased/);
assert.match(rendererSource, /pendingDomainState = retainNewestState/);
assert.match(rendererSource, /classed\("is-hovered"/);
assert.match(rendererSource, /classed\("is-dimmed"/);

const hoverStart = Date.parse("2026-08-12T00:00:00.000Z");
const stationA = [
  { date: new Date(hoverStart), value: 10 },
  { date: new Date(hoverStart + 60 * 60 * 1000), value: 20 },
];
const stationB = [
  { date: new Date(hoverStart), value: 70 },
  { date: new Date(hoverStart + 60 * 60 * 1000), value: 80 },
];
const hoverObservations = new Map([["a", stationA], ["b", stationB]]);
const nearestSeries = rendererModule.findNearestSeriesAtPointer(
  [{ station_id: "a" }, { station_id: "b" }],
  hoverObservations,
  new Date(hoverStart + 30 * 60 * 1000),
  76,
  (value) => value,
  (points) => [points],
);
assert.equal(nearestSeries.entry.station_id, "b", "pointer Y, not equal timestamp or selection order, owns hover");

const gapRight = { date: new Date(hoverStart + 10 * 60 * 60 * 1000), value: 100 };
const gapPoints = [...stationA, gapRight];
assert.equal(
  rendererModule.getSeriesValueAtDate(
    gapPoints,
    [stationA, [gapRight]],
    new Date(hoverStart + 5 * 60 * 60 * 1000),
  ),
  20,
  "hover geometry uses the nearest segment endpoint instead of interpolating an invisible bridge",
);

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

function createContextGuard(generation) {
  const abortController = new AbortController();
  let current = true;
  return {
    value: Object.freeze({
      generation,
      signal: abortController.signal,
      isCurrent: () => current && !abortController.signal.aborted,
    }),
    invalidate() {
      current = false;
      abortController.abort();
    },
  };
}

const replacementRequests = [];
const replacementRenders = [];
let releasePm10Current;
const replacementClient = {
  kind: "calculated",
  async loadCurrent(request, parts) {
    replacementRequests.push({ ...request });
    if (request.pollutant === "pm10") {
      await new Promise((resolve) => { releasePm10Current = resolve; });
    }
    return makeResult(request, parts);
  },
  async loadOlder(request, parts) { return makeResult(request, parts); },
  async prefetchAqi(request) { return makeResult(request, { observations: false, aqi: true }); },
};
const replacementController = controllerModule.createStationChartController({
  renderer: {
    initialise() {}, setLoading() {}, clearProgress() {}, updateProgress() {}, destroy() {},
    replacePollutantContext(state) {
      replacementRenders.push({ type: "replace", pollutant: state.pollutant, renderMode: state.render_mode });
    },
    renderAxes(state) { replacementRenders.push({ type: "axes", pollutant: state.pollutant }); },
    renderObservations() {}, renderAqi() {},
  },
  calculatedClient: replacementClient,
  compatibilityClient: replacementClient,
  backgroundAqiPrefetch: false,
});
replacementController.mount({});
await replacementController.setRange({ start_utc: "2026-08-12T00:00:00Z", end_utc: "2026-08-12T01:00:00Z" });

const pm25Guard = createContextGuard(1);
const pm25Replacement = await replacementController.replacePollutantContext({
  pollutant: "pm25",
  status: "ready",
  entries: [{ station_id: 101, timeseries_id: 201, connector_id: 301, pollutant: "pm25" }],
  selectedStationIds: ["101"],
  primaryStationId: "101",
  aqiSourceStationId: "101",
  renderMode: "initial",
  contextGuard: pm25Guard.value,
});
assert.equal(pm25Replacement.committed, true);
const requestsBeforeLoading = replacementRequests.length;
const no2LoadingGuard = createContextGuard(2);
await replacementController.replacePollutantContext({
  pollutant: "no2", status: "loading", entries: [], selectedStationIds: ["101"],
  renderMode: "pollutant-replacement", contextGuard: no2LoadingGuard.value,
});
assert.equal(replacementRequests.length, requestsBeforeLoading,
  "loading target context invalidates old work without starting target history");
assert.equal(replacementController.range.startIso, "2026-08-12T00:00:00.000Z", "pollutant loading preserves range");

const no2ReadyGuard = createContextGuard(2);
const no2Replacement = await replacementController.replacePollutantContext({
  pollutant: "no2",
  status: "ready",
  entries: [{ station_id: 101, timeseries_id: 901, connector_id: 902, pollutant: "no2" }],
  selectedStationIds: ["101"],
  primaryStationId: "101",
  aqiSourceStationId: "101",
  renderMode: "pollutant-replacement",
  contextGuard: no2ReadyGuard.value,
});
assert.equal(no2Replacement.committed, true);
assert.equal(replacementController.selection[0].timeseries_id, 901, "target entry replaces the retained timeseries identity");
assert.equal(replacementController.selection[0].connector_id, 902, "target entry replaces the retained connector identity");
assert.equal(replacementRequests.at(-1).pollutant, "no2");
assert.equal(replacementRequests.at(-1).timeseries_id, 901);
assert.equal(replacementRequests.at(-1).connector_id, 902);
assert.equal(replacementRenders.filter((event) => event.type === "replace").at(-1).renderMode, "pollutant-replacement",
  "pollutant replacement reaches the renderer with its explicit non-initial mode");

const pm10Guard = createContextGuard(3);
const latePm10 = replacementController.replacePollutantContext({
  pollutant: "pm10",
  status: "ready",
  entries: [{ station_id: 101, timeseries_id: 1001, connector_id: 1002, pollutant: "pm10" }],
  selectedStationIds: ["101"],
  primaryStationId: "101",
  aqiSourceStationId: "101",
  renderMode: "pollutant-replacement",
  contextGuard: pm10Guard.value,
});
await new Promise((resolve) => setImmediate(resolve));
const rendersBeforePm10Release = replacementRenders.length;
pm10Guard.invalidate();
const rapidNo2Guard = createContextGuard(4);
await replacementController.replacePollutantContext({
  pollutant: "no2", status: "loading", entries: [], selectedStationIds: ["101"],
  renderMode: "pollutant-replacement", contextGuard: rapidNo2Guard.value,
});
releasePm10Current();
const latePm10Result = await latePm10;
assert.equal(latePm10Result.committed, false);
assert.equal(replacementRenders.length, rendersBeforePm10Release,
  "a late obsolete PM10 response performs no progressive visible commit after NO2 loading begins");

const emptyGuard = createContextGuard(5);
const emptyReplacement = await replacementController.replacePollutantContext({
  pollutant: "no2", status: "ready", entries: [], selectedStationIds: [],
  renderMode: "pollutant-replacement", contextGuard: emptyGuard.value,
});
assert.equal(emptyReplacement.committed, true, "an authoritative empty target settles normally");
assert.deepEqual(replacementController.selection, [], "authoritative empty target retains no old-pollutant entry fallback");
replacementController.destroy();

const independentRange = {
  startIso: "2026-07-01T00:00:00.000Z",
  endIso: "2026-07-10T00:00:00.000Z",
  startMs: Date.parse("2026-07-01T00:00:00.000Z"),
  endMs: Date.parse("2026-07-10T00:00:00.000Z"),
};
const independentPlan = controllerModule.buildOlderWorkPlan(
  cacheModule.createCacheRecord(),
  {
    observations: {
      stable_head_start_utc: "2026-07-08T00:00:00.000Z",
      next_older_observation_chunk_end_utc: "2026-07-08T00:00:00.000Z",
    },
    aqi: {
      stable_head_start_utc: "2026-07-06T00:00:00.000Z",
      next_older_aqi_chunk_end_utc: "2026-07-06T00:00:00.000Z",
    },
  },
  independentRange,
  { observations: true, aqi: true },
  24 * 60 * 60 * 1000,
  0,
);
assert.equal(independentPlan.filter((item) => item.observations).length, 7,
  "observation work independently reaches its own older boundary");
assert.equal(independentPlan.filter((item) => item.aqi).length, 5,
  "AQI work independently reaches its own older boundary");
assert.equal(independentPlan.some((item) => item.observations && item.aqi), false,
  "different stable-head boundaries are not collapsed into ambiguous combined requests");

const rangeDurations = new Map([
  ["12h", 12 * 60 * 60 * 1000],
  ["24h", 24 * 60 * 60 * 1000],
  ["7d", 7 * 24 * 60 * 60 * 1000],
  ["31d", 31 * 24 * 60 * 60 * 1000],
  ["90d", 90 * 24 * 60 * 60 * 1000],
]);
for (const [label, durationMs] of rangeDurations) {
  const endMs = Date.parse("2026-08-10T00:00:00.000Z");
  const startMs = endMs - durationMs;
  const tracedRange = {
    startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString(), startMs, endMs,
  };
  const tracedPlan = controllerModule.buildOlderWorkPlan(
    cacheModule.createCacheRecord(),
    { observations: {
      stable_head_start_utc: tracedRange.endIso,
      next_older_observation_chunk_end_utc: tracedRange.endIso,
    } },
    tracedRange,
    { observations: true, aqi: false },
    controllerModule.defaultOlderChunkMs(label),
    1,
  );
  assert.equal(tracedPlan[0].range.end_utc, tracedRange.endIso, `${label} work starts with the newest interval`);
  assert.equal(tracedPlan.at(-1).range.start_utc, tracedRange.startIso, `${label} work reaches the requested start`);
}

const settlementBuffer = historyLoaderModule.createOrderedSettlementBuffer(0);
const settlementLaunches = [];
const settlementCommits = [];
let releaseFirstCommit;
const firstCommitGate = new Promise((resolve) => { releaseFirstCommit = resolve; });
await controllerModule.runQueueWithConcurrency([
  { sequence: 0 }, { sequence: 1 }, { sequence: 2 },
], 2, async (item) => {
  settlementLaunches.push(item.sequence);
  controllerModule.scheduleOrderedSettlement(settlementBuffer, item.sequence, item, async (value) => {
    if (value.sequence === 0) await firstCommitGate;
    settlementCommits.push(value.sequence);
  });
});
assert.deepEqual(settlementLaunches, [0, 1, 2],
  "a fetch worker launches later network work while an ordered commit chain is still waiting");
assert.deepEqual(settlementCommits, [], "ordered visible settlement remains blocked at the unfinished newest commit");
releaseFirstCommit();
await settlementBuffer.flush();
assert.deepEqual(settlementCommits, [0, 1, 2], "decoupled network work still commits newest to oldest");

const rejectedSettlementBuffer = historyLoaderModule.createOrderedSettlementBuffer(0);
controllerModule.scheduleOrderedSettlement(rejectedSettlementBuffer, 0, {}, async () => {
  throw new Error("ordered_commit_failed");
});
await assert.rejects(rejectedSettlementBuffer.flush(), /ordered_commit_failed/,
  "ordered commit errors remain observable at the final flush");

const concurrentRequests = [];
const committedEnds = [];
const progressUpdates = [];
let activeOlder = 0;
let maxActiveOlder = 0;
const concurrentClient = {
  kind: "calculated",
  async loadCurrent(request, parts) {
    const result = makeResult(request, parts);
    return {
      ...result,
      observations: {
        ...result.observations,
        stable_head_start_utc: "2026-07-05T00:00:00.000Z",
        stable_head_end_utc: request.end_utc,
        next_older_observation_chunk_end_utc: "2026-07-05T00:00:00.000Z",
      },
      aqi: {
        ...result.aqi,
        stable_head_start_utc: "2026-07-05T00:00:00.000Z",
        stable_head_end_utc: request.end_utc,
        next_older_aqi_chunk_end_utc: "2026-07-05T00:00:00.000Z",
      },
    };
  },
  async loadOlder(request, parts) {
    concurrentRequests.push(request.end_utc);
    activeOlder += 1;
    maxActiveOlder = Math.max(maxActiveOlder, activeOlder);
    const day = new Date(request.end_utc).getUTCDate();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, day - 2) * 4));
    activeOlder -= 1;
    return makeResult(request, parts);
  },
  async prefetchAqi(request) { return makeResult(request, { observations: false, aqi: true }); },
};
const concurrentRecords = new Map();
const concurrentController = controllerModule.createStationChartController({
  renderer: {
    initialise() {}, renderAxes() {}, renderObservations() {}, renderAqi() {}, setLoading() {},
    updateProgress(settled, total) { progressUpdates.push([settled, total]); },
    clearProgress() {}, destroy() {},
  },
  calculatedClient: concurrentClient,
  compatibilityClient: concurrentClient,
  records: concurrentRecords,
  backgroundAqiPrefetch: false,
  olderChunkMs: 24 * 60 * 60 * 1000,
  primaryObservationConcurrency: 3,
  diagnostics: {
    timing() {},
    event(name, details) {
      if (name === "station_history_chunk_committed" && details.kind === "observations") committedEnds.push(details.end_utc);
    },
  },
});
concurrentController.mount({});
await concurrentController.setRange(independentRange);
await concurrentController.setSelection([
  { station_id: 501, timeseries_id: 601, connector_id: 701, pollutant: "pm25" },
]);
assert.equal(maxActiveOlder, 3, "primary older history uses its bounded per-stream concurrency");
assert.deepEqual(concurrentRequests.slice(0, 3), [
  "2026-07-05T00:00:00.000Z",
  "2026-07-04T00:00:00.000Z",
  "2026-07-03T00:00:00.000Z",
], "newest primary chunks launch first without serial waiting");
assert.deepEqual(committedEnds, [
  "2026-07-05T00:00:00.000Z",
  "2026-07-04T00:00:00.000Z",
  "2026-07-03T00:00:00.000Z",
  "2026-07-02T00:00:00.000Z",
], "out-of-order network completions commit newest to oldest");
assert.deepEqual(progressUpdates.at(-1), [4, 4], "observation progress settles every planned history chunk");
const concurrentRecord = concurrentRecords.values().next().value;
assert.equal(cacheModule.getUncoveredRanges(concurrentRecord, "observations", independentRange).length, 0,
  "the complete requested observation range is covered after history settlement");
assert.equal(cacheModule.getUncoveredRanges(concurrentRecord, "aqi", independentRange).length, 0,
  "the complete requested AQI range is covered independently");
concurrentController.destroy();

let failOlderInterval = true;
const incompleteEvents = [];
const incompleteMessages = [];
let incompleteRenderErrorCount = 0;
let incompleteLastState = null;
const failedEndUtc = "2026-07-03T00:00:00.000Z";
const incompleteRequests = [];
const incompleteClient = {
  kind: "calculated",
  async loadCurrent(request, parts) {
    const result = makeResult(request, parts);
    return {
      ...result,
      observations: {
        ...result.observations,
        points: [{ date: new Date("2026-07-08T12:00:00.000Z"), value: 8 }],
        stable_head_start_utc: "2026-07-05T00:00:00.000Z",
        stable_head_end_utc: request.end_utc,
        next_older_observation_chunk_end_utc: "2026-07-05T00:00:00.000Z",
      },
      aqi: {
        ...result.aqi,
        stable_head_start_utc: "2026-07-05T00:00:00.000Z",
        stable_head_end_utc: request.end_utc,
        next_older_aqi_chunk_end_utc: "2026-07-05T00:00:00.000Z",
      },
    };
  },
  async loadOlder(request, parts) {
    incompleteRequests.push(request.end_utc);
    if (failOlderInterval && request.end_utc === failedEndUtc) throw new Error("history_transport_failed");
    return makeResult(request, parts);
  },
  async prefetchAqi(request) { return makeResult(request, { observations: false, aqi: true }); },
};
const incompleteRecords = new Map();
const incompleteController = controllerModule.createStationChartController({
  renderer: {
    initialise() {}, renderAxes() {}, renderAqi() {}, setLoading() {}, clearProgress() {}, updateProgress() {}, destroy() {},
    renderObservations(state) { incompleteLastState = state; },
    renderError() { incompleteRenderErrorCount += 1; },
  },
  calculatedClient: incompleteClient,
  compatibilityClient: incompleteClient,
  records: incompleteRecords,
  backgroundAqiPrefetch: false,
  olderChunkMs: 24 * 60 * 60 * 1000,
  onMessage(message) { incompleteMessages.push(message); },
  diagnostics: {
    timing() {},
    event(name, details) { incompleteEvents.push([name, details]); },
  },
});
incompleteController.mount({});
await incompleteController.setRange(independentRange);
const incompleteState = await incompleteController.setSelection([
  { station_id: 801, timeseries_id: 901, connector_id: 1001, pollutant: "pm25" },
]);
assert.equal(incompleteState.complete, false, "a failed required observation interval is not labelled complete");
assert.equal(incompleteState.observation_complete, false);
assert.equal(incompleteState.observation_coverage.failed_interval_count, 1);
assert.equal(incompleteRenderErrorCount, 0, "valid retained chart data is not blanked by one older transport failure");
assert.equal(incompleteLastState.observations.get("801").length, 1, "valid current observations remain rendered");
assert.equal(incompleteMessages.some(Boolean), false, "no new user-facing partial-failure wording is invented");
const incompleteDiagnostic = incompleteEvents.find(([name]) => name === "station_chart_load_incomplete")?.[1];
assert.equal(incompleteDiagnostic?.retryable_transport_failure, true);
assert.equal(incompleteDiagnostic?.source_partial, false, "transport failure remains distinct from source-data partiality");
assert.equal(incompleteEvents.some(([name]) => name === "station_chart_load_completed"), false);

failOlderInterval = false;
const requestsBeforeRetry = incompleteRequests.filter((endUtc) => endUtc === failedEndUtc).length;
const recoveredState = await incompleteController.refresh();
assert.equal(recoveredState.complete, true, "a later normal load can complete the previously failed interval");
assert.equal(incompleteRequests.filter((endUtc) => endUtc === failedEndUtc).length, requestsBeforeRetry + 1,
  "the failed observation interval remains retryable");
incompleteController.destroy();

console.log("Hex Map shared station-chart harness passed");
