import assert from "node:assert/strict";
import fs from "node:fs";
import loader from "../station-history-loader.js";

const fields = {
  daqiField: "daqi_pm25_rolling24h_index_level",
  eaqiField: "eaqi_pm25_index_level",
};
const hour = "2026-07-15T10:00:00.000Z";

const head = loader.normalizeAqiPoint({
  period_start_utc: hour,
  daqi_pm25_rolling24h_index_level: 3,
  eaqi_pm25_index_level: "Moderate",
}, fields);
const conflictingHistory = loader.normalizeAqiPoint({
  period_start_utc: hour,
  daqi_pm25_rolling24h_index_level: 7,
  eaqi_pm25_index_level: "Poor",
}, fields);
const guarded = loader.mergeAqiWithoutReplacement([head], [conflictingHistory]);
assert.equal(guarded.points.length, 1);
assert.equal(guarded.points[0].daqi, 3);
assert.equal(guarded.conflicts.length, 1);

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
assert.equal(record.contract_version, "station-history-v1");

// A 12h/24h response that says its next boundary is the requested start has
// no historical R2 work to schedule.
assert.equal(loader.nextChunkRange(range.start_utc, range.start_utc, loader.HOUR_MS), null);

const observation = loader.normalizeObservationPoint({
  observed_at: "2026-07-15T10:15:00.000Z",
  value: 12.5,
});
assert.equal(loader.mergeObservationPoints([observation], [observation]).length, 1);

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

console.log("station-history loader harness passed");
