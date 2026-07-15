import assert from "node:assert/strict";
import fs from "node:fs";
import loader from "../station-history-loader.js";

const page = fs.readFileSync(new URL("../hex_map/index.html", import.meta.url), "utf8");
const start = page.indexOf("async function loadStationHistoryChartData");
const end = page.indexOf("function ensureChartFrame", start);
const section = page.slice(start, end);

assert.ok(start >= 0, "Hex Map progressive station-history loader exists");
assert.match(page, /station_history_loader/);
assert.match(page, /HEX_MAP_STATION_HISTORY_CACHE_CONTRACT = "hex-map-station-history-v2"/);
assert.match(page, /<script src="\/station-history-loader\.js"><\/script>/);
assert.match(page, /return loadLegacyChartData\(reason\)/, "legacy loader remains available for TEST rollback");

const requestHead = section.indexOf("primaryPayload = await fetchStationSeriesBundle");
const paintAqi = section.indexOf("primaryRecord.aqi_points = headMerge.points");
const paintObservations = section.indexOf("primaryRecord.observation_points = window.UkAqStationHistoryLoader.mergeObservationPoints");
const secondaryRequest = section.indexOf("fetchStationSeriesBundle(entry, range, windowValue, false");
const aqiHistory = section.indexOf("const aqiPromise");
const observationHistory = section.indexOf("const observationPromises");
assert.ok(requestHead >= 0 && paintAqi > requestHead && paintObservations > paintAqi, "AQI head is rendered before recent observations");
assert.ok(secondaryRequest > paintObservations, "secondary current observations start after the primary recent observations");
assert.ok(aqiHistory >= 0 && observationHistory > aqiHistory, "AQI chunks are started before observation chunks");
assert.match(section, /initChartFrame\(dom, range, MAX_SELECTED_SENSORS\)/, "full requested range fixes the x-axis before data arrives");
assert.match(page, /include_aqi", includeAqi \? "true" : "false"/);
assert.match(section, /fetchStationSeriesBundle\(entry, range, windowValue, false, signal\)/);
assert.match(section, /Current recent data is unavailable\. Cached historical data is shown as stale\./);
assert.match(section, /aqi_replacement_contract_error/);
assert.match(page, /record\.completed_chunks\[key\]/);
assert.match(page, /record\.failed_chunks\[key\]/);
assert.match(page, /Continue backwards/);

const head = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T12:00:00.000Z", daqi_index_level: 2, eaqi_index_level: "Low" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const replacement = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T12:00:00.000Z", daqi_index_level: 8, eaqi_index_level: "Very High" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const guarded = loader.mergeAqiWithoutReplacement([head], [replacement]);
assert.equal(guarded.points[0].daqi, 2);
assert.equal(guarded.conflicts.length, 1, "later history cannot replace a stable AQI hour");

const shortRange = loader.nextChunkRange("2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z", loader.HOUR_MS);
assert.equal(shortRange, null, "null next boundaries schedule no 12h/24h R2 chunks");

console.log("Hex Map station-history loader harness passed");
