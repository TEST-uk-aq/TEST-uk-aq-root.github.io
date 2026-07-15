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
const resolveSelectedEntries = section.indexOf("resolveChartableSelectedEntries(\"station-history\")");
const paintAqi = section.indexOf("primaryRecord.aqi_points = headMerge.points");
const paintObservations = section.indexOf("primaryRecord.observation_points = window.UkAqStationHistoryLoader.replaceAuthoritativeObservationHead");
const secondaryRequest = section.indexOf("fetchStationSeriesBundle(entry, range, windowValue, false");
const aqiHistory = section.indexOf("const aqiPromise");
const observationHistory = section.indexOf("const observationPromises");
assert.ok(requestHead >= 0 && paintAqi > requestHead && paintObservations > paintAqi, "AQI head is rendered before recent observations");
assert.ok(resolveSelectedEntries >= 0 && resolveSelectedEntries < requestHead, "a resolved selected entry reaches fetchStationSeriesBundle before any fallback can occur");
assert.ok(secondaryRequest > paintObservations, "secondary current observations start after the primary recent observations");
assert.ok(aqiHistory >= 0 && aqiHistory < secondaryRequest && observationHistory > secondaryRequest, "AQI chunks start with priority while secondary and historical observations remain independent");
assert.match(section, /initChartFrame\(dom, range, MAX_SELECTED_SENSORS\)/, "full requested range fixes the x-axis before data arrives");
assert.match(page, /include_aqi", includeAqi \? "true" : "false"/);
assert.match(section, /fetchStationSeriesBundle\(entry, range, windowValue, false, signal\)/);
assert.match(section, /Current recent data is unavailable\. Cached historical data is shown as stale\./);
assert.match(page, /aqi_replacement_contract_error/);
assert.match(section, /replaceAuthoritativeAqiHead/);
assert.match(section, /replaceAuthoritativeObservationHead/);
assert.match(section, /resolveChartableSelectedEntries\("station-history"\)/);
assert.match(page, /station_history_selected_entry_unresolved/);
assert.match(page, /selectedEntries: new Map\(\)/);
assert.match(page, /resolveSelectedStationEntries/);
assert.match(page, /rememberVisibleSelectedEntries\(entries\)/);
assert.match(section, /includeCached: false/);
assert.match(section, /forceClearAqi: true/);
assert.match(page, /renderOptions\.forceClearAqi === true/);
assert.match(section, /currentObservationStationIds/);
assert.match(section, /Cached line\$\{count === 1 \? " is" : "s are"\} hidden/);
assert.match(page, /if \(existing\) return existing/);
assert.match(page, /primaryRecord\?\.guideline \|\| legacyGuideline/);
assert.match(section, /station_history_time_to_first_aqi_render_ms/);
assert.match(page, /record\.completed_chunks\[key\]/);
assert.match(page, /record\.failed_chunks\[key\]/);
assert.match(page, /Continue backwards/);

const head = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T12:00:00.000Z", daqi_index_level: 2, eaqi_index_level: "Low" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const replacement = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T12:00:00.000Z", daqi_index_level: 8, eaqi_index_level: "Very High" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const guarded = loader.mergeAqiWithoutReplacement([head], [replacement]);
assert.equal(guarded.points[0].daqi, 2);
assert.equal(guarded.conflicts.length, 1, "later history cannot replace a stable AQI hour");

const refreshedHead = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T12:00:00.000Z", daqi_index_level: 4, eaqi_index_level: "Moderate" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const olderHistory = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T11:00:00.000Z", daqi_index_level: 2, eaqi_index_level: "Low" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const refreshed = loader.replaceAuthoritativeAqiHead([olderHistory, head], [refreshedHead], "2026-07-15T12:00:00.000Z", "2026-07-15T13:00:00.000Z");
assert.equal(refreshed.points.length, 2);
assert.equal(refreshed.points.at(-1).daqi, 4, "a later authoritative station-series head can replace its own interval");

const cachedObservation = loader.normalizeObservationPoint({ observed_at: "2026-07-15T12:15:00.000Z", value: 12 });
const retainedObservation = loader.normalizeObservationPoint({ observed_at: "2026-07-15T13:15:00.000Z", value: 13 });
const freshObservations = loader.replaceAuthoritativeObservationHead(
  [cachedObservation, retainedObservation],
  [retainedObservation],
  "2026-07-15T12:00:00.000Z",
  "2026-07-15T13:00:00.000Z",
);
assert.deepEqual(freshObservations.map((point) => point.date.toISOString()), ["2026-07-15T13:15:00.000Z"], "a fresh observation head removes cached rows from its interval");

const shortRange = loader.nextChunkRange("2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z", loader.HOUR_MS);
assert.equal(shortRange, null, "null next boundaries schedule no 12h/24h R2 chunks");

const visiblePrimary = { stationId: "7", timeseriesId: "70", connectorId: "1" };
const retainedSecondary = { stationId: "8", timeseriesId: "80", connectorId: "2" };
const resolvedSelected = loader.resolveSelectedStationEntries([7, 8], [visiblePrimary], new Map([["8", retainedSecondary]]));
assert.deepEqual(resolvedSelected.entries, [visiblePrimary, retainedSecondary], "selected order and primary identity survive a visible-filter refresh");
assert.equal(resolvedSelected.entries[0].timeseriesId, "70", "the selected primary retains its request identity for fetchStationSeriesBundle");

console.log("Hex Map station-history loader harness passed");
