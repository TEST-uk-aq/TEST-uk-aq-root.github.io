import assert from "node:assert/strict";
import fs from "node:fs";
import loader from "../station-history-loader.js";

const page = fs.readFileSync(new URL("../hex_map/index.html", import.meta.url), "utf8");
const start = page.indexOf("async function loadStationHistoryChartData");
const end = page.indexOf("function ensureChartFrame", start);
const section = page.slice(start, end);

assert.ok(start >= 0, "Hex Map progressive station-history loader exists");
assert.match(page, /station_history_loader/);
assert.match(page, /HEX_MAP_STATION_HISTORY_CACHE_CONTRACT = "hex-map-station-history-v3"/);
assert.match(page, /const periodEndIndex = columns\.indexOf\("period_end_utc"\)/);
assert.match(page, /periodEndIndex >= 0 \? row\[periodEndIndex\] : timestampHourIndex >= 0/);
assert.match(page, /periodStart: new Date\(periodEnd\.getTime\(\) - HOUR_MS\)/);
assert.match(page, /const clippedStartMs = Math\.max\(frame\.startMs, periodStartMs\)/);
assert.match(page, /const clippedEndMs = Math\.min\(frame\.endMs, endpointMs\)/);
assert.doesNotMatch(page, /carryForwardLevels/);
assert.match(page, /<script src="\/station-history-loader\.js"><\/script>/);
assert.match(page, /return loadLegacyChartData\(reason\)/, "legacy loader remains available for TEST rollback");
assert.match(page, /A selected sensor is missing its timeseries identity\./, "missing timeseries retains a visible frontend diagnostic");
assert.doesNotMatch(page, /A selected sensor is missing its timeseries or connector identity\./);

const requestHead = section.indexOf("primaryPayload = await fetchStationSeriesBundle");
const resolveSelectedEntries = section.indexOf("resolveChartableSelectedEntries(\"station-history\")");
const paintAqi = section.indexOf("primaryRecord.aqi_points = headMerge.points");
const paintObservations = section.indexOf("primaryRecord.observation_points = window.UkAqStationHistoryLoader.replaceAuthoritativeObservationHead");
const secondaryRequest = section.indexOf("fetchStationSeriesBundle(entry, range, windowValue, false");
const aqiHistory = section.indexOf("const aqiPromise");
const aqiPhaseSettled = section.indexOf("await aqiPromise");
const observationHistory = section.indexOf("const observationHeads");
const coveredWindowBranch = section.indexOf("if (requestedRangeCovered)");
assert.ok(requestHead >= 0 && paintAqi > requestHead && paintObservations > paintAqi, "AQI head is rendered before recent observations");
assert.ok(coveredWindowBranch >= 0 && coveredWindowBranch < requestHead, "a fully covered window returns before any network head request");
assert.ok(resolveSelectedEntries >= 0 && resolveSelectedEntries < requestHead, "a resolved selected entry reaches fetchStationSeriesBundle before any fallback can occur");
assert.ok(secondaryRequest > paintObservations, "secondary current observations start after the primary recent observations");
assert.ok(aqiHistory >= 0 && aqiHistory < secondaryRequest && aqiPhaseSettled > secondaryRequest && observationHistory > aqiPhaseSettled, "historical observation work starts only after the AQI phase settles");
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
assert.match(section, /const preserveExistingFrame = frameValid && \["window-change", "refresh"\]\.includes\(reason\)/);
assert.match(section, /const retainedWindowEndMs = reason === "window-change" && frameValid/);
assert.match(section, /station_history_window_cache_hit/);
assert.match(section, /request_count: 0/);
assert.match(section, /const cachedHeadsReusable = reason === "window-change"/);
assert.match(section, /station_history_window_cache_extended/);
assert.match(section, /stageCachedStationHistoryForDomainAnimation/);
assert.match(section, /animateChartDomains\(dom\.chartFrame, range, dom\.chartFrame\.yScale\.domain\(\), token/);
assert.match(section, /includeCached: false/);
assert.match(section, /forceClearAqi: !frameValid/, "only a genuinely new frame is explicitly cleared");
assert.doesNotMatch(section, /includeCached: false, forceClearAqi: true/);
assert.match(page, /renderOptions\.forceClearAqi === true/);
assert.match(section, /currentObservationStationIds/);
assert.match(section, /Cached line\$\{count === 1 \? " is" : "s are"\} hidden/);
assert.match(page, /if \(existing\) return existing/);
assert.match(page, /primaryRecord\?\.guideline \|\| legacyGuideline/);
assert.match(section, /station_history_time_to_first_aqi_render_ms/);
assert.match(page, /record\.completed_chunks\[key\]/);
assert.match(page, /record\.failed_chunks\[key\]/);
assert.match(page, /buildMissingChunkWorkList\(record, kind, range\.startIso/);
assert.match(page, /recordCoverageInterval\(record, kind, requestRange/);
assert.match(page, /inspectAqiChunk\(payload\)/);
assert.match(page, /aqi_chunk_partial/);
assert.match(page, /observations_chunk_partial/);
assert.match(page, /retained_rows: observationChunk\.rows\.length/);
assert.match(page, /createOrderedSettlementBuffer\(1\)/);
assert.match(page, /runChunkQueueWithConcurrency\(olderWork, concurrency/);
assert.match(page, /const newestSettled = await settle\(work\[0\]\);[\s\S]*await commit\(newestSettled\);/, "the newest missing range settles and commits before older parallel work starts");
assert.match(page, /STATION_HISTORY_AQI_CHUNK_CONCURRENCY = 2/);
assert.match(page, /STATION_HISTORY_OBSERVATION_CHUNK_CONCURRENCY = 2/);
assert.match(page, /Math\.floor\(CHART_GLOBAL_FETCH_CAP \/ STATION_HISTORY_OBSERVATION_CHUNK_CONCURRENCY\)/);
assert.match(page, /runChunkQueueWithConcurrency\(\s*entries,\s*STATION_HISTORY_OBSERVATION_STREAM_CONCURRENCY/, "selected observation streams use the bounded global scheduler");
assert.match(page, /if \(token !== state\.loadToken \|\| signal\.aborted\) return \{ workItem, aborted: true \}/, "obsolete queued work is ignored before fetching");
assert.match(page, /if \(!settled \|\| settled\.aborted \|\| token !== state\.loadToken \|\| signal\.aborted\) return/, "obsolete network results are ignored before commit");
assert.match(page, /requestAnimationFrame\(run\)/, "historical response renders are coalesced by animation frame");
assert.match(page, /await historyRenderScheduler\.flush\(\)/, "final completion flushes the last coalesced chart render");
assert.doesNotMatch(section, /Promise\.all\(\[aqiPromise, observationPromise\]\)/, "historical AQI and observation phases are not concurrent");
assert.match(section, /await cachedAqiPromise;[\s\S]*await runChunkQueueWithConcurrency\(\s*entries,\s*STATION_HISTORY_OBSERVATION_STREAM_CONCURRENCY/, "cached range expansion also settles AQI before observation history starts");
assert.match(section, /const beginObservationProgress = \(totalChunks\)/);
assert.match(section, /ChartCore\.renderProgressBar\(dom\.chartFrame\.svgEl, progressFrame\)/, "the established progress line is created for historical observations");
assert.match(section, /const observationChunkCount = entries\.reduce/, "progress totals observation chunks across every selected sensor");
assert.match(section, /settleObservationProgress,/, "complete, partial, and failed settled observation work advances progress before ordered commits");
assert.match(section, /clearObservationProgress\(\);/, "observation progress is removed after completion and in finally cleanup");
assert.ok(section.indexOf("beginObservationProgress(observationChunkCount)") > aqiPhaseSettled, "the progress line does not appear during the AQI-only phase");
assert.match(section, /primaryRecord\.identity = window\.UkAqStationHistoryLoader\.resolveAuthoritativeIdentity/);
assert.match(section, /record\.identity = window\.UkAqStationHistoryLoader\.resolveAuthoritativeIdentity/);
assert.match(page, /fetchStationHistoryChunk\(kind, entry, record, workItem\.range/);
assert.match(section, /Current data identity could not be resolved for the selected sensor\./);

const boundsStart = page.indexOf("function stationSeriesHeadBounds");
const boundsEnd = page.indexOf("async function fetchStationSeriesBundle", boundsStart);
const boundsSection = page.slice(boundsStart, boundsEnd);
assert.match(boundsSection, /resolveStationSeriesHeadBounds\(payload, kind, fallbackRange\)/);
assert.doesNotMatch(boundsSection, /payload\?\.source\?\.output_/);
assert.match(section, /stationSeriesHeadBounds\(primaryPayload, "aqi", range\)/);
assert.match(section, /stationSeriesHeadBounds\(primaryPayload, "observations", range\)/);
assert.match(section, /stationSeriesHeadBounds\(payload, "observations", range\)/, "observations-only secondary heads use their own bounds");
assert.match(section, /current_observation_next_chunk_end_utc = stationHistoryNextBoundary\(primaryPayload\.observations, "observations"\)/);
assert.match(section, /current_observation_next_chunk_end_utc = stationHistoryNextBoundary\(payload\.observations, "observations"\)/);
assert.doesNotMatch(section, /current_observation_next_chunk_end_utc = (?:aqiHeadBounds|observationHeadBounds|headBounds)\?\.startUtc/);

const fetchHeadStart = page.indexOf("async function fetchStationSeriesBundle");
const fetchHeadEnd = page.indexOf("async function fetchStationHistoryChunk", fetchHeadStart);
const fetchHeadSection = page.slice(fetchHeadStart, fetchHeadEnd);
assert.match(fetchHeadSection, /hasPositiveTimeseriesIdentity\(entry\)/);
assert.doesNotMatch(fetchHeadSection, /!connectorId/);
assert.match(fetchHeadSection, /if \(\/\^\\d\+\$\/\.test\(String\(connectorId \|\| ""\)\)/, "a valid connector hint is included when available");
assert.doesNotMatch(fetchHeadSection, /networkLabel|AURN|aurn/, "the head request contains no network-to-connector guessing");

const head = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T12:00:00.000Z", daqi_index_level: 2, eaqi_index_level: "Low" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const replacement = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T12:00:00.000Z", daqi_index_level: 8, eaqi_index_level: "Very High" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const guarded = loader.mergeAqiWithoutReplacement([head], [replacement]);
assert.equal(guarded.points[0].daqi, 2);
assert.equal(guarded.conflicts.length, 1, "later history cannot replace a stable AQI hour");

const refreshedHead = loader.normalizeAqiPoint({ period_end_utc: "2026-07-15T13:00:00.000Z", daqi_index_level: 4, eaqi_index_level: "Moderate" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const olderHistory = loader.normalizeAqiPoint({ period_start_utc: "2026-07-15T11:00:00.000Z", daqi_index_level: 2, eaqi_index_level: "Low" }, { daqiField: "daqi_index_level", eaqiField: "eaqi_index_level" });
const refreshed = loader.replaceAuthoritativeAqiHead([olderHistory, head], [refreshedHead], "2026-07-15T12:00:00.000Z", "2026-07-15T13:00:00.000Z");
assert.equal(refreshed.points.length, 3);
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

const visiblePrimary = { stationId: "7", timeseriesId: "70" };
const retainedSecondary = { stationId: "8", timeseriesId: "80", connectorId: "2" };
const resolvedSelected = loader.resolveSelectedStationEntries([7, 8], [visiblePrimary], new Map([["8", retainedSecondary]]));
assert.deepEqual(resolvedSelected.entries, [visiblePrimary, retainedSecondary], "selected order and primary identity survive a visible-filter refresh");
assert.equal(resolvedSelected.entries[0].timeseriesId, "70", "the selected primary retains its request identity for fetchStationSeriesBundle");
assert.equal(loader.hasPositiveTimeseriesIdentity(resolvedSelected.entries[0]), true, "an AURN-style selected entry remains requestable without connector metadata");

const authoritative = loader.resolveAuthoritativeIdentity({
  identity: { source: "authoritative_timeseries_lookup", timeseries_id: 70, connector_id: 6, station_id: 7, pollutant: "pm25" },
}, { timeseriesId: "70", pollutant: "PM2.5" });
assert.equal(authoritative.connector_id, 6);
assert.equal(authoritative.station_id, 7);
assert.equal(loader.resolveAuthoritativeIdentity({ identity: { timeseries_id: 71, connector_id: 6, station_id: 7, pollutant: "pm25" } }, { timeseriesId: 70, pollutant: "pm25" }), null, "a head cannot replace the requested timeseries identity");

console.log("Hex Map station-history loader harness passed");
