import assert from "node:assert/strict";
import fs from "node:fs";
import loader from "../station-history-loader.js";

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
assert.equal(record.contract_version, "station-history-v2-calculated-aqi");
assert.equal(record.identity, null);
assert.equal(loader.isCalculatedCombinedResponse({
  schema_version: 2,
  observations: { rows: [] },
  aqi: { enabled: true, calculation_source: "calculated_from_observations", rows: [] },
}), true);

loader.recordCoverageInterval(record, "aqi", {
  start_utc: "2026-07-08T00:00:00.000Z",
  end_utc: "2026-07-15T00:00:00.000Z",
}, "complete");
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
const partialPoint = loader.normalizeAqiPoint(partialAqiChunk.rows[0], {
  daqiField: "daqi_index_level",
  eaqiField: "eaqi_index_level",
});
assert.equal(loader.mergeAqiWithoutReplacement([head], [partialPoint]).points[0], head, "a partial history row cannot replace the stable head");
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
const stationHead = page.indexOf('"station_series_head"');
const headRender = page.indexOf('applyAqiContextState(record.aqiPoints, context);', stationHead);
const observationRender = page.indexOf('record.observationPoints = parseStationSeriesObservationPoints', stationHead);
assert.ok(headRender >= 0 && observationRender > headRender, "AQI head is processed before observations");
assert.match(page, /domainStartMs: fullRange\.startMs,[\s\S]*domainEndMs: fullRange\.endMs/);
assert.match(page, /renderSeriesChart\(\[\], meta, windowValue/);
assert.match(page, /Current recent data is unavailable\. Cached historical data is shown as stale\./);
assert.match(page, /aqi_replacement_contract_error/);
assert.match(page, /AQI history response overlaps stable head/);
assert.match(page, /retained completed chunks after failure/);
assert.match(page, /const periodEndIndex = columns\.indexOf\("period_end_utc"\)/);
assert.match(page, /return createAqiIntervalPoint\(endpoint, daqiRaw, eaqiRaw\)/);
assert.match(page, /const clippedStartMs = Math\.max\(domainStart\.getTime\(\), periodStartMs\)/);
assert.match(page, /const clippedEndMs = Math\.min\(domainEnd\.getTime\(\), endpointMs\)/);
assert.match(page, /point\.date\.getTime\(\) > stableHeadStartMs/);
assert.match(page, /point\.date\.getTime\(\) <= stableHeadStartMs/);

console.log("station-history loader harness passed");
