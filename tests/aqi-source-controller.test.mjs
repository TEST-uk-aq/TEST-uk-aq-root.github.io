import assert from "node:assert/strict";
import cache from "../shared/station-chart/station-chart-cache.js";
import diagnosticsModule from "../shared/station-chart/station-chart-diagnostics.js";
import sourceControllerModule from "../shared/station-chart/aqi-source-controller.js";

const { DEFAULT_TRANSITION_MS, createAqiSourceController } = sourceControllerModule;
assert.equal(DEFAULT_TRANSITION_MS, 50, "the shared controller owns the 50ms transition");
assert.deepEqual(
  diagnosticsModule.shapeEvent("rows_are_bounded", { aqi_points: [{ value: 1 }] }).details,
  { aqi_points_count: 1 },
  "diagnostics retain a count instead of AQI row arrays",
);

const range = {
  startMs: Date.parse("2026-07-26T12:00:00.000Z"),
  endMs: Date.parse("2026-07-27T12:00:00.000Z"),
};
const calculatedPartial = cache.inspectAqiSettlement({
  enabled: true,
  calculation_source: "calculated_from_observations",
  response_complete: false,
  has_gap: true,
  partial_reasons: ["future_worker_reason"],
  rows: [{
    timestamp_hour_utc: "2026-07-27T11:00:00.000Z",
    daqi_calculation_status: "future_status",
    daqi_missing_reason: "future_missing_reason",
  }],
});
assert.equal(calculatedPartial.settled, true, "unknown calculated diagnostics do not prevent settlement");
const cacheRecord = cache.createCacheRecord();
cache.recordCoverageInterval(cacheRecord, "aqi", range, "partial", calculatedPartial);

const diagnosticEvents = [];
const diagnostics = diagnosticsModule.createDiagnostics({
  recordEvent: (type, details) => diagnosticEvents.push({ type, details }),
});
const controller = createAqiSourceController({ diagnostics });
let clearCount = 0;
let requestCount = 0;
let commitCount = 0;
let observationSettled = false;
let releaseObservation;
const unrelatedObservationWork = new Promise((resolve) => {
  releaseObservation = () => {
    observationSettled = true;
    resolve();
  };
});
const mutableRange = { ...range };
const startedAt = performance.now();
const cachedCompletionPromise = controller.switchSource({
  sourceId: "cached-source",
  range: mutableRange,
  clearAqi: () => { clearCount += 1; },
  isSettled: () => cache.getUncoveredRanges(cacheRecord, "aqi", range).length === 0,
  requestAqi: () => {
    requestCount += 1;
    return calculatedPartial;
  },
  commit: () => { commitCount += 1; },
  // The deliberately unresolved observation promise is not part of the switch.
  observationPromise: unrelatedObservationWork,
});
mutableRange.endMs += 5000;
assert.equal(clearCount, 1, "the previous AQI layer clears synchronously");
assert.equal(controller.active.range.endMs, range.endMs, "the controller keeps an exact immutable range snapshot");
assert.equal(Object.isFrozen(controller.active.range), true);
const cachedCompletion = await cachedCompletionPromise;
const cachedElapsedMs = performance.now() - startedAt;
assert.equal(requestCount, 0, "a settled exact-range cache hit starts no AQI request");
assert.equal(cachedCompletion.committed, true);
assert.equal(commitCount, 1, "a settled cache hit commits the AQI layer once");
assert.ok(cachedElapsedMs >= 40, "the settled switch observes the 50ms transition");
assert.ok(cachedElapsedMs < 500, "the settled switch has no network-scale wait");
assert.equal(observationSettled, false, "unresolved observation work does not delay the AQI commit");
releaseObservation();
await unrelatedObservationWork;
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(diagnosticEvents.at(-1)?.details?.aqi_source_switch_cache_hit, true);
assert.equal(diagnosticEvents.at(-1)?.details?.aqi_source_switch_network_required, false);
assert.equal(diagnosticEvents.at(-1)?.details?.aqi_source_switch_commit_count, 1);

const networkController = createAqiSourceController({ transitionMs: 0 });
let releaseRequiredAqi;
let networkCommitCount = 0;
const requiredAqiWork = new Promise((resolve) => { releaseRequiredAqi = resolve; });
const uncachedCompletionPromise = networkController.switchSource({
  sourceId: "uncached-source",
  range,
  isSettled: () => false,
  requestAqi: () => requiredAqiWork,
  commit: () => { networkCommitCount += 1; },
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(networkCommitCount, 0, "unsettled AQI waits for its required network work");
releaseRequiredAqi({
  settled: true,
  actual_failure: false,
  retryable_incomplete: false,
  settlement: "complete",
});
assert.equal((await uncachedCompletionPromise).committed, true);
assert.equal(networkCommitCount, 1);

const obsoleteController = createAqiSourceController({ transitionMs: 0 });
let releaseOldRequest;
let oldCommitCount = 0;
let replacementCommitCount = 0;
const oldCompletionPromise = obsoleteController.switchSource({
  sourceId: "old-source",
  range,
  isSettled: () => false,
  requestAqi: () => new Promise((resolve) => { releaseOldRequest = resolve; }),
  commit: () => { oldCommitCount += 1; },
});
const replacementCompletion = await obsoleteController.switchSource({
  sourceId: "replacement-source",
  range,
  isSettled: () => true,
  commit: () => { replacementCommitCount += 1; },
});
releaseOldRequest({ settled: true, actual_failure: false, settlement: "complete" });
const oldCompletion = await oldCompletionPromise;
assert.equal(oldCompletion.committed, false, "a rapid replacement makes the older result obsolete");
assert.equal(oldCommitCount, 0, "an obsolete result cannot paint AQI");
assert.equal(replacementCompletion.committed, true);
assert.equal(replacementCommitCount, 1);

const failedController = createAqiSourceController({ transitionMs: 0 });
let unavailableCount = 0;
let failedCommitCount = 0;
const failedCompletion = await failedController.switchSource({
  sourceId: "failed-source",
  range,
  isSettled: () => false,
  requestAqi: () => Promise.reject(new Error("network_failed")),
  commit: () => { failedCommitCount += 1; },
  renderUnavailable: () => { unavailableCount += 1; },
});
assert.equal(failedCompletion.actual_failure, true);
assert.equal(failedCompletion.committed, false);
assert.equal(failedCommitCount, 0);
assert.equal(unavailableCount, 1, "a hard AQI-only failure uses the chart-local unavailable callback");

console.log("shared AQI source controller harness passed");
