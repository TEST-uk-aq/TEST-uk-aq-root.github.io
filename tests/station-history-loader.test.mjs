import assert from "node:assert/strict";
import fs from "node:fs";
import loader from "../shared/station-chart/station-history-loader.js";
import cache from "../shared/station-chart/station-chart-cache.js";
import sensorsAdapterModule from "../sensors/sensor-station-chart-adapter.js";

const fields = {
  daqiField: "daqi_pm25_rolling24h_index_level",
  eaqiField: "eaqi_pm25_index_level",
};
const hour = "2026-07-15T10:00:00.000Z";

const head = loader.normalizeAqiPoint({
  period_end_utc: hour,
  timestamp_hour_utc: "2026-07-15T09:00:00.000Z",
  period_start_utc: "2026-07-15T08:00:00.000Z",
  daqi_pm25_rolling24h_index_level: 3,
  eaqi_pm25_index_level: "Moderate",
}, fields);
assert.equal(head.date.toISOString(), hour, "period_end_utc is the canonical endpoint");
assert.equal(head.periodEnd.toISOString(), hour);
assert.equal(head.periodStart.toISOString(), "2026-07-15T09:00:00.000Z");
const conflictingHistory = loader.normalizeAqiPoint({
  period_start_utc: hour,
  daqi_pm25_rolling24h_index_level: 7,
  eaqi_pm25_index_level: "Poor",
}, fields);
const guarded = loader.mergeAqiWithoutReplacement([head], [conflictingHistory]);
assert.equal(guarded.points.length, 1);
assert.equal(guarded.points[0].daqi, 3);
assert.equal(guarded.conflicts.length, 1);

const endpointAtHeadStart = loader.normalizeAqiPoint({
  period_end_utc: "2026-07-15T12:00:00.000Z",
  daqi_pm25_rolling24h_index_level: 1,
  eaqi_pm25_index_level: "Good",
}, fields);
const endpointInsideHead = loader.normalizeAqiPoint({
  period_end_utc: "2026-07-15T13:00:00.000Z",
  daqi_pm25_rolling24h_index_level: 5,
  eaqi_pm25_index_level: "Poor",
}, fields);
const endpointHeadReplacement = loader.replaceAuthoritativeAqiHead(
  [endpointAtHeadStart, endpointInsideHead],
  [],
  "2026-07-15T12:00:00.000Z",
  "2026-07-15T13:00:00.000Z",
);
assert.deepEqual(
  endpointHeadReplacement.points.map((point) => point.date.toISOString()),
  ["2026-07-15T12:00:00.000Z"],
  "an endpoint equal to the stable-head start remains in the preceding interval",
);

const matchingHistory = loader.normalizeAqiPoint({
  period_start_utc: hour,
  daqi_pm25_rolling24h_index_level: 3,
  eaqi_pm25_index_level: "Moderate",
}, fields);
assert.equal(loader.mergeAqiWithoutReplacement([head], [matchingHistory]).conflicts.length, 0);

const range = loader.nextChunkRange(
  "2026-07-01T00:00:00.000Z",
  "2026-07-15T00:00:00.000Z",
  7 * 24 * loader.HOUR_MS,
);
assert.deepEqual(range, {
  start_utc: "2026-07-08T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
});
assert.equal(loader.isOlderChunk(range.start_utc, range.end_utc, range.end_utc), true);
assert.equal(loader.isOlderChunk(range.start_utc, range.end_utc, "2026-07-14T23:00:00.000Z"), false);

const retryKey = loader.chunkKey("aqi", range);
const record = loader.createCacheRecord({ completed_chunks: { [retryKey]: range } });
assert.equal(record.completed_chunks[retryKey].end_utc, range.end_utc);
assert.equal(record.contract_version, "station-history-v5-shared-cache");
assert.equal(record.identity, null);
assert.equal(cache.isCacheRecordFresh({ updated_at: "2026-07-27T12:00:00.000Z" }, 60_000, Date.parse("2026-07-27T12:00:30.000Z")), true);
const invalidatedEntries = new Map([["keep", {}], ["remove", {}]]);
assert.equal(cache.invalidateMatchingEntries(invalidatedEntries, (_value, key) => key === "remove"), 1);
assert.deepEqual([...invalidatedEntries.keys()], ["keep"]);
assert.equal(loader.isCalculatedCombinedResponse({
  schema_version: 2,
  observations: { enabled: true, rows: [] },
  aqi: { enabled: true, calculation_source: "calculated_from_observations", rows: [] },
}), true);

loader.recordCoverageInterval(record, "aqi", {
  start_utc: "2026-07-08T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
}, "complete");
assert.deepEqual(record.coverage.aqi.settled_intervals, record.coverage.aqi.covered_intervals, "a complete AQI interval is settled");
assert.deepEqual(
  loader.getUncoveredRanges(record, "aqi", {
    start_utc: "2026-07-01T00:00:00.000Z",
    end_utc: "2026-07-15T00:00:00.000Z",
  }).map((interval) => [interval.start_utc, interval.end_utc]),
  [["2026-07-01T00:00:00.000Z", "2026-07-08T00:00:00.000Z"]],
  "a 24h-to-7d style expansion requests only the uncovered interval",
);
loader.recordCoverageInterval(record, "aqi", {
  start_utc: "2026-06-14T00:00:00.000Z",
  end_utc: "2026-07-08T00:00:00.000Z",
}, "complete");
assert.equal(loader.getUncoveredRanges(record, "aqi", {
  start_utc: "2026-06-14T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
}).length, 0, "changed chunk boundaries do not refetch covered 31d data");
assert.equal(loader.getUncoveredRanges(record, "aqi", {
  start_utc: "2026-07-08T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
}).length, 0, "contracting to a covered 7d range makes no request");

const neighbouringCoverage = loader.createCacheRecord();
loader.recordCoverageInterval(neighbouringCoverage, "aqi", {
  start_utc: "2026-07-01T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
}, "complete");
loader.recordCoverageInterval(neighbouringCoverage, "aqi", {
  start_utc: "2026-07-07T00:00:00.000Z",
  end_utc: "2026-07-08T00:00:00.000Z",
}, "failed");
assert.deepEqual(
  neighbouringCoverage.coverage.aqi.covered_intervals,
  [
    { startMs: Date.parse("2026-07-01T00:00:00.000Z"), endMs: Date.parse("2026-07-07T00:00:00.000Z") },
    { startMs: Date.parse("2026-07-08T00:00:00.000Z"), endMs: Date.parse("2026-07-15T00:00:00.000Z") },
  ],
  "a failed interval does not remove successful neighbouring coverage",
);
assert.deepEqual(
  loader.getUncoveredRanges(neighbouringCoverage, "aqi", {
    start_utc: "2026-06-30T00:00:00.000Z",
    end_utc: "2026-07-16T00:00:00.000Z",
  }).map((interval) => [interval.start_utc, interval.end_utc]),
  [
    ["2026-07-15T00:00:00.000Z", "2026-07-16T00:00:00.000Z"],
    ["2026-07-07T00:00:00.000Z", "2026-07-08T00:00:00.000Z"],
    ["2026-06-30T00:00:00.000Z", "2026-07-01T00:00:00.000Z"],
  ],
  "uncovered intervals are returned newest first",
);

const queuedRecord = loader.createCacheRecord();
loader.recordCoverageInterval(queuedRecord, "aqi", {
  start_utc: "2026-07-02T00:00:00.000Z",
  end_utc: "2026-07-03T00:00:00.000Z",
}, "complete");
const queuedWork = loader.buildMissingChunkWorkList(
  queuedRecord,
  "aqi",
  "2026-07-01T00:00:00.000Z",
  "2026-07-04T00:00:00.000Z",
  24 * loader.HOUR_MS,
);
assert.deepEqual(
  queuedWork.map((item) => [item.sequence, item.range.start_utc, item.range.end_utc]),
  [
    [0, "2026-07-03T00:00:00.000Z", "2026-07-04T00:00:00.000Z"],
    [1, "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"],
  ],
  "the work list is newest first and excludes complete covered intervals",
);

const queuedObservationWork = loader.buildMissingChunkWorkList(
  loader.createCacheRecord(),
  "observations",
  "2026-07-01T00:00:00.000Z",
  "2026-07-04T00:00:00.000Z",
  24 * loader.HOUR_MS,
);
assert.deepEqual(
  queuedObservationWork.map((item) => [item.kind, item.sequence, item.range.start_utc, item.range.end_utc]),
  [
    ["observations", 0, "2026-07-03T00:00:00.000Z", "2026-07-04T00:00:00.000Z"],
    ["observations", 1, "2026-07-02T00:00:00.000Z", "2026-07-03T00:00:00.000Z"],
    ["observations", 2, "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"],
  ],
  "observation work is also derived newest first before bounded fetching",
);

const commitOrder = [];
const orderedSettlements = loader.createOrderedSettlementBuffer(1);
await orderedSettlements.settle(2, { state: "complete", id: "older" }, async (value) => commitOrder.push(value.id));
assert.deepEqual(commitOrder, [], "an older out-of-order response waits for the preceding range");
await orderedSettlements.settle(1, { state: "failed", id: "newer-failed" }, async (value) => commitOrder.push(value.id));
await orderedSettlements.flush();
assert.deepEqual(commitOrder, ["newer-failed", "older"], "a failed newer settlement records in order without blocking older success");
assert.equal(orderedSettlements.pending_count, 0);

const distinctHeadPayload = {
  aqi: {
    stable_head_start_utc: "2026-07-08T00:00:00.000Z",
    stable_head_end_utc: "2026-07-15T00:00:00.000Z",
  },
  observations: {
    stable_head_start_utc: "2026-07-12T00:00:00.000Z",
    stable_head_end_utc: "2026-07-15T00:00:00.000Z",
  },
};
assert.deepEqual(loader.resolveStationSeriesHeadBounds(distinctHeadPayload, "aqi"), {
  startUtc: "2026-07-08T00:00:00.000Z",
  endUtc: "2026-07-15T00:00:00.000Z",
});
assert.deepEqual(loader.resolveStationSeriesHeadBounds(distinctHeadPayload, "observations"), {
  startUtc: "2026-07-12T00:00:00.000Z",
  endUtc: "2026-07-15T00:00:00.000Z",
}, "observation bounds remain independent from the older AQI head");
assert.deepEqual(loader.resolveStationSeriesHeadBounds({ observations: distinctHeadPayload.observations }, "observations"), {
  startUtc: "2026-07-12T00:00:00.000Z",
  endUtc: "2026-07-15T00:00:00.000Z",
}, "an observations-only response does not depend on an AQI section");

const partialAqiChunk = loader.inspectAqiChunk({
  response_complete: false,
  has_gap: true,
  partial_reasons: ["missing_expected_aqi_hours"],
  points: [{ period_start_utc: hour, daqi_index_level: 3, eaqi_index_level: 2 }],
});
assert.equal(partialAqiChunk.rows.length, 1);
assert.equal(partialAqiChunk.complete, false);
assert.equal(partialAqiChunk.retryable, true);
assert.equal(partialAqiChunk.settled, false, "an undocumented compatibility partial remains unsettled");
const partialPoint = loader.normalizeAqiPoint(partialAqiChunk.rows[0], {
  daqiField: "daqi_index_level",
  eaqiField: "eaqi_index_level",
});
assert.equal(loader.mergeAqiWithoutReplacement([head], [partialPoint]).points[0], head, "a partial history row cannot replace the stable head");

const settledPartialRange = {
  start_utc: "2026-07-10T00:00:00.000Z",
  end_utc: "2026-07-11T00:00:00.000Z",
};
const settledPartial = loader.inspectAqiChunk({
  enabled: true,
  calculation_source: "calculated_from_observations",
  response_complete: false,
  has_gap: true,
  partial_reasons: ["missing_visible_aqi_hours", "calculated_aqi_status_incomplete"],
  gap_ranges: [{ start_utc: "2026-07-10T03:00:00.000Z", end_utc: "2026-07-10T04:00:00.000Z" }],
  points: [{
    timestamp_hour_utc: "2026-07-10T05:00:00.000Z",
    daqi_index_level: null,
    eaqi_index_level: 2,
    daqi_calculation_status: "insufficient_samples",
    eaqi_calculation_status: "ok",
    daqi_missing_reason: "insufficient_rolling_24h_hours",
    eaqi_missing_reason: null,
  }],
});
assert.equal(settledPartial.complete, false);
assert.equal(settledPartial.settled, true, "a confirmed calculation-data partial is settled without becoming complete");
assert.equal(settledPartial.retryable, false);
assert.equal(settledPartial.actual_failure, false);
assert.equal(settledPartial.failure_reason, null);
const settledPartialOutcome = loader.classifyAqiTransitionOutcome({ settlement: settledPartial });
assert.deepEqual({
  settled: settledPartialOutcome.settled,
  retryable_incomplete: settledPartialOutcome.retryable_incomplete,
  actual_failure: settledPartialOutcome.actual_failure,
}, { settled: true, retryable_incomplete: false, actual_failure: false });
const retainedValidBand = loader.normalizeAqiPoint(settledPartial.rows[0], {
  daqiField: "daqi_index_level",
  eaqiField: "eaqi_index_level",
});
assert.equal(retainedValidBand.daqi, null);
assert.equal(retainedValidBand.eaqi, 2, "a valid EAQI band survives beside an authoritative blank DAQI value");
const settledPartialRecord = loader.createCacheRecord();
loader.recordCoverageInterval(settledPartialRecord, "aqi", settledPartialRange, "partial", settledPartial);
assert.equal(loader.getUncoveredRanges(settledPartialRecord, "aqi", settledPartialRange).length, 0, "settled partial AQI is excluded from missing-request planning");
assert.equal(loader.getIncompleteRanges(settledPartialRecord, "aqi", settledPartialRange).length, 1, "settlement does not relabel a partial response complete");
assert.equal(loader.buildMissingChunkWorkList(
  settledPartialRecord,
  "aqi",
  settledPartialRange.start_utc,
  settledPartialRange.end_utc,
  24 * loader.HOUR_MS,
).length, 0, "settled partial AQI schedules no repeat chunk request");
assert.equal(settledPartialRecord.coverage.aqi.interval_states[0].has_gap, true);
assert.deepEqual(settledPartialRecord.coverage.aqi.interval_states[0].missing_reasons, ["insufficient_rolling_24h_hours"]);

const statusProvenPartial = loader.inspectAqiSettlement({
  enabled: true,
  calculation_source: "calculated_from_observations",
  response_complete: false,
  has_gap: true,
  partial_reasons: [],
  rows: [{
    timestamp_hour_utc: "2026-07-10T06:00:00.000Z",
    daqi_calculation_status: "missing_input",
    eaqi_calculation_status: "ok",
    daqi_missing_reason: "breakpoint_not_found",
    eaqi_missing_reason: null,
  }],
});
assert.equal(statusProvenPartial.authoritative_partial, true, "current calculation status and missing-reason metadata can prove an authoritative gap without a partial reason string");
assert.equal(statusProvenPartial.settled, true);
assert.equal(statusProvenPartial.actual_failure, false);

const authoritativeBlankInterval = loader.inspectAqiSettlement({
  enabled: true,
  calculation_source: "calculated_from_observations",
  response_complete: false,
  has_gap: true,
  partial_reasons: ["missing_visible_aqi_hours"],
  rows: [],
});
assert.equal(authoritativeBlankInterval.settled, true, "a Worker-confirmed blank AQI interval is settled even with no AQI row to render");
assert.equal(authoritativeBlankInterval.complete, false);

const unresolvedPartial = loader.inspectAqiChunk({
  enabled: true,
  calculation_source: "calculated_from_observations",
  response_complete: false,
  has_gap: true,
  partial_reasons: ["required_observation_source_incomplete"],
  points: [{ period_start_utc: "2026-07-10T07:00:00.000Z", daqi_index_level: 2, eaqi_index_level: 1 }],
});
assert.equal(unresolvedPartial.settled, true);
assert.equal(unresolvedPartial.retryable, false, "a structurally valid calculated partial settles without a diagnostic allow-list");
assert.equal(unresolvedPartial.actual_failure, false, "an unfamiliar calculated partial is not a hard failure");
const unresolvedOutcome = loader.classifyAqiTransitionOutcome({ settlement: unresolvedPartial });
assert.equal(unresolvedOutcome.retryable_incomplete, false);
assert.equal(unresolvedOutcome.actual_failure, false);
const unresolvedRecord = loader.createCacheRecord();
loader.recordCoverageInterval(unresolvedRecord, "aqi", settledPartialRange, "partial", unresolvedPartial);
assert.equal(loader.getUncoveredRanges(unresolvedRecord, "aqi", settledPartialRange).length, 0, "unknown calculated diagnostics do not create another fetch");

const completeSettlement = loader.inspectAqiSettlement({
  response_complete: true,
  has_gap: false,
  rows: [],
});
assert.deepEqual({
  complete: completeSettlement.complete,
  settled: completeSettlement.settled,
  retryable: completeSettlement.retryable,
  actual_failure: completeSettlement.actual_failure,
}, { complete: true, settled: true, retryable: false, actual_failure: false });

const networkFailure = loader.classifyAqiTransitionOutcome({ error: new Error("network_failed") });
assert.equal(networkFailure.actual_failure, true);
assert.equal(networkFailure.failure_reason, "network_failed");
const malformedSettlement = loader.inspectAqiSettlement({ response_complete: false });
assert.equal(malformedSettlement.actual_failure, true);
assert.equal(loader.classifyAqiTransitionOutcome({ settlement: malformedSettlement }).failure_reason, "aqi_response_malformed");
assert.equal(loader.classifyAqiTransitionOutcome({
  settlement: completeSettlement,
  identity_valid: false,
}).failure_reason, "station_series_authoritative_identity_invalid");
assert.equal(loader.classifyAqiTransitionOutcome({
  settlement: completeSettlement,
  conflict_count: 1,
}).failure_reason, "aqi_replacement_contract_error");
const invalidCalculatedStatus = loader.inspectAqiSettlement({
  enabled: true,
  calculation_source: "calculated_from_observations",
  response_complete: false,
  has_gap: true,
  partial_reasons: ["calculated_aqi_status_incomplete"],
  rows: [{ daqi_calculation_status: "unexpected_status", eaqi_calculation_status: "ok" }],
});
assert.equal(invalidCalculatedStatus.settled, true, "unfamiliar calculated status text stays non-user-facing and settled");
assert.equal(invalidCalculatedStatus.actual_failure, false);
assert.equal(invalidCalculatedStatus.failure_reason, null);
const abortedOutcome = loader.classifyAqiTransitionOutcome({
  settlement: unresolvedPartial,
  aborted: true,
});
assert.deepEqual({
  settled: abortedOutcome.settled,
  retryable_incomplete: abortedOutcome.retryable_incomplete,
  actual_failure: abortedOutcome.actual_failure,
  failure_reason: abortedOutcome.failure_reason,
  ignored: abortedOutcome.ignored,
  settlement: abortedOutcome.settlement,
  partial_reasons: abortedOutcome.partial_reasons,
  calculation_statuses: abortedOutcome.calculation_statuses,
  missing_reasons: abortedOutcome.missing_reasons,
}, {
  settled: false,
  retryable_incomplete: false,
  actual_failure: false,
  failure_reason: null,
  ignored: true,
  settlement: "ignored",
  partial_reasons: ["required_observation_source_incomplete"],
  calculation_statuses: [],
  missing_reasons: [],
}, "an aborted transition cannot become a retryable or hard terminal message result");
loader.recordCoverageInterval(record, "observations", {
  start_utc: "2026-07-14T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
}, "partial", { partial_reasons: ["missing_parquet"] });
assert.equal(loader.getUncoveredRanges(record, "observations", {
  start_utc: "2026-07-14T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
}).length, 1, "partial observation intervals remain retryable");

const authoritativeIdentity = loader.resolveAuthoritativeIdentity({
  request: { timeseries_id: 420, connector_id: 2, station_id: 42, pollutant: "no2" },
}, { timeseriesId: "420", pollutant: "NO2" });
assert.deepEqual(authoritativeIdentity, {
  source: "authoritative_timeseries_lookup",
  timeseries_id: 420,
  connector_id: 2,
  station_id: 42,
  pollutant: "no2",
});
const calculatedHistoryIdentity = loader.resolveAuthoritativeIdentity({
  request: { requested_timeseries_id: 420, connector_id: 2, station_id: 42, pollutant: "no2" },
}, { timeseriesId: "420", pollutant: "NO2" });
assert.deepEqual(calculatedHistoryIdentity, authoritativeIdentity, "calculated older-history chunks retain the requested logical-series identity");
assert.equal(loader.resolveAuthoritativeIdentity({
  request: { timeseries_id: 421, requested_timeseries_id: 420, connector_id: 2, station_id: 42, pollutant: "no2" },
}, { timeseriesId: "420", pollutant: "NO2" }), null, "conflicting physical and requested timeseries identities remain unsafe");
assert.equal(loader.createCacheRecord({ identity: authoritativeIdentity }).identity.connector_id, 2);

// A 12h/24h response that says its next boundary is the requested start has
// no historical R2 work to schedule.
assert.equal(loader.nextChunkRange(range.start_utc, range.start_utc, loader.HOUR_MS), null);

const observation = loader.normalizeObservationPoint({
  observed_at: "2026-07-15T10:15:00.000Z",
  value: 12.5,
});
assert.equal(loader.mergeObservationPoints([observation], [observation]).length, 1);

const partialObservationChunk = loader.inspectObservationChunk({
  response_complete: false,
  has_gap: true,
  partial_reasons: ["missing_parquet"],
  rows: [{ observed_at: "2026-07-15T10:15:00.000Z", value: 12.5 }],
});
assert.equal(partialObservationChunk.rows.length, 1, "valid rows survive a partial observation chunk");
assert.equal(partialObservationChunk.complete, false);
assert.equal(partialObservationChunk.retryable, true);
assert.equal(loader.mergeObservationPoints([observation], partialObservationChunk.rows.map(loader.normalizeObservationPoint)).length, 1, "a successful retry deduplicates retained partial rows");

const retainedEntry = { stationId: "42", timeseriesId: "420", connectorId: "2" };
const selectedResolution = loader.resolveSelectedStationEntries(
  [7, "42", "missing"],
  [{ stationId: "7", timeseriesId: "70", connectorId: "1" }],
  new Map([["42", retainedEntry]]),
);
assert.deepEqual(selectedResolution.entries.map((entry) => String(entry.stationId)), ["7", "42"], "numeric selected IDs resolve against string entry IDs in selected order");
assert.equal(selectedResolution.entries[1], retainedEntry, "a retained selected entry remains chartable outside the current visible filter");
assert.deepEqual(selectedResolution.unresolvedIds, ["missing"]);

const cachedObservation = loader.normalizeObservationPoint({
  observed_at: "2026-07-15T10:15:00.000Z",
  value: 12.5,
});
const freshObservation = loader.normalizeObservationPoint({
  observed_at: "2026-07-15T11:15:00.000Z",
  value: 13.5,
});
const replacedObservations = loader.replaceAuthoritativeObservationHead(
  [cachedObservation, freshObservation],
  [freshObservation],
  "2026-07-15T10:00:00.000Z",
  "2026-07-15T11:00:00.000Z",
);
assert.deepEqual(replacedObservations.map((point) => point.date.toISOString()), ["2026-07-15T11:15:00.000Z"]);

const page = fs.readFileSync(new URL("../sensors/index.html", import.meta.url), "utf8");
const sensorsAdapter = fs.readFileSync(new URL("../sensors/sensor-station-chart-adapter.js", import.meta.url), "utf8");
const sensorsPage = fs.readFileSync(new URL("../sensors/sensors-page.js", import.meta.url), "utf8");
assert.deepEqual(sensorsAdapterModule.normalizeEntry({
  station_id: "42",
  timeseries_id: "420",
  connector_id: "2",
  pollutant: "PM2.5",
  units: "ug/m3",
}), {
  station_id: "42",
  timeseries_id: 420,
  connector_id: 2,
  pollutant: "pm25",
  units: "ug/m3",
}, "the Sensors adapter passes the authoritative logical-series identity to the shared controller");
assert.equal(sensorsAdapterModule.normalizeEntry({
  station_id: "42",
  timeseries_id: "420",
  pollutant: "PM2.5",
}), null, "the Sensors adapter fails closed when connector identity is absent");
for (const script of [
  "station-chart-domain.js",
  "station-chart-cache.js",
  "station-chart-diagnostics.js",
  "aqi-source-controller.js",
  "station-history-loader.js",
  "station-history-client.js",
  "station-history-compatibility-client.js",
  "station-chart-renderer.js",
  "station-chart-controller.js",
  "pollutant-context-controller.js",
]) {
  assert.match(page, new RegExp(`<script src="/shared/station-chart/${script.replaceAll(".", "\\.")}"></script>`));
}
assert.match(page, /<script src="\/sensors\/sensor-station-chart-adapter\.js"><\/script>/);
assert.match(page, /<script src="\/sensors\/sensors-page\.js"><\/script>/);
assert.match(page, /<link rel="stylesheet" href="\/shared\/station-chart\/station-chart\.css">/);
assert.doesNotMatch(page, /function loadSeriesData|function renderAqiBands|stationHistoryCacheByKey|chartLoadingSvg|d3\.select/,
  "the Sensors inline chart architecture is no longer active");
assert.match(sensorsAdapter, /UkAqStationChartController\.createStationChartController/);
assert.match(sensorsAdapter, /UkAqStationChartRenderer\.createStationChartRenderer/);
assert.match(sensorsAdapter, /UkAqPollutantContextController\.createPollutantContextController/);
assert.match(sensorsAdapter, /UkAqCalculatedStationHistoryClient\.createCalculatedStationHistoryClient/);
assert.match(sensorsAdapter, /UkAqCompatibilityStationHistoryClient\.createCompatibilityStationHistoryClient/);
assert.match(sensorsAdapter, /station_id:[\s\S]*timeseries_id:[\s\S]*connector_id:[\s\S]*pollutant/,
  "the Sensors adapter constructs the shared controller's authoritative identity");
assert.doesNotMatch(sensorsAdapter, /\bd3\.|fetchStation|renderAqiBands|stationHistoryCacheByKey/);
assert.doesNotMatch(sensorsPage, /createStationChartController|createStationChartRenderer|renderAqiBands|stationHistoryCacheByKey|\bd3\./,
  "Sensors page UI does not retain chart implementation");

console.log("station-history loader harness passed");
