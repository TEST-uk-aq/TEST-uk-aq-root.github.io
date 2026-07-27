import assert from "node:assert/strict";
import fs from "node:fs";
import loader from "../station-history-loader.js";

const page = fs.readFileSync(new URL("../hex_map/index.html", import.meta.url), "utf8");
const sensorsPage = fs.readFileSync(new URL("../sensors/index.html", import.meta.url), "utf8");
const controllerSource = fs.readFileSync(new URL("../station_chart/aqi-source-controller.js", import.meta.url), "utf8");
const loaderSource = fs.readFileSync(new URL("../station-history-loader.js", import.meta.url), "utf8");
const loadStart = page.indexOf("async function loadStationHistoryChartData");
const loadEnd = page.indexOf("function resizeChartFrame", loadStart);
const loadSection = page.slice(loadStart, loadEnd);
const targetedStart = loadSection.indexOf("if (frameValid && (reason === \"sensor-change\" || isAqiSourceChangeOnly))");
const targetedEnd = loadSection.indexOf("const preserveExistingFrame", targetedStart);
const targetedSection = loadSection.slice(targetedStart, targetedEnd);

const rangeHelperStart = page.indexOf("function normalizeDisplayedChartRange");
const rangeHelperEnd = page.indexOf("function isAqiSourceRangeSettled", rangeHelperStart);
const rangeHelpers = Function(`"use strict"; ${page.slice(rangeHelperStart, rangeHelperEnd)}; return { normalizeDisplayedChartRange, getDisplayedChartRange };`)();
const displayedFrame = {
  xScale: {
    domain: () => [new Date("2026-07-26T12:00:00.000Z"), new Date("2026-07-27T12:00:00.000Z")],
  },
  frame: {
    startMs: Date.parse("2026-07-26T11:59:55.000Z"),
    endMs: Date.parse("2026-07-27T11:59:55.000Z"),
  },
};
const displayedRange = rangeHelpers.getDisplayedChartRange(displayedFrame);
assert.equal(displayedRange.startIso, "2026-07-26T12:00:00.000Z");
assert.equal(displayedRange.endIso, "2026-07-27T12:00:00.000Z");
assert.equal(Object.isFrozen(displayedRange), true, "the displayed range is an immutable snapshot");
assert.equal(loader.subtractCoveredIntervals(displayedRange, [displayedRange]).length, 0, "the exact displayed range has no false uncovered tail");
const driftedRange = { ...displayedRange, endMs: displayedRange.endMs + 5000 };
assert.deepEqual(loader.subtractCoveredIntervals(driftedRange, [displayedRange]), [{
  startMs: displayedRange.endMs,
  endMs: displayedRange.endMs + 5000,
  start_utc: displayedRange.endIso,
  end_utc: "2026-07-27T12:00:05.000Z",
}], "recalculating the range later would create a false uncovered tail");

assert.ok(loadStart >= 0 && targetedStart >= 0 && targetedEnd > targetedStart, "the targeted station-history loader exists");
assert.match(page, /const AQI_SOURCE_TRANSITION_MS = 50;/);
assert.doesNotMatch(page, /const AQI_SOURCE_TRANSITION_MS = 200;/);
assert.match(page, /HEX_MAP_STATION_HISTORY_CACHE_CONTRACT = "hex-map-station-history-v7-shared-cache"/);
for (const script of [
  "station-chart-domain.js",
  "station-chart-cache.js",
  "station-chart-diagnostics.js",
  "aqi-source-controller.js",
]) {
  const pattern = new RegExp(`<script src="/station_chart/${script.replace(".", "\\.")}"></script>`);
  assert.match(page, pattern, `Hex Map loads ${script}`);
  assert.match(sensorsPage, pattern, `Sensors loads ${script}`);
}
assert.match(page, /<script src="\/station-history-loader\.js"><\/script>/);
assert.match(sensorsPage, /<script src="\/station-history-loader\.js"><\/script>/);

const removedPageOwnership = /aqiSourceSwitchMessages|aqiTransitionToken|createAtomicAqiRenderGate|completeAtomicAqiSourceSwitch|aqiTransitionGate|aqiSwitchIdentity/;
assert.doesNotMatch(page, removedPageOwnership, "Hex Map no longer owns a duplicate AQI switch controller or message state");
assert.doesNotMatch(loaderSource, /createAtomicAqiRenderGate|completeAtomicAqiSourceSwitch|createAqiSourceSwitchMessageController/, "the compatibility facade no longer exports the old controller");

const sourceSetterStart = page.indexOf("function setAqiSourceSensor");
const sourceSetterEnd = page.indexOf("function buildChartHeaderHtml", sourceSetterStart);
const sourceSetterSection = page.slice(sourceSetterStart, sourceSetterEnd);
assert.match(sourceSetterSection, /const displayedRange = frameIdentityValid \? getDisplayedChartRange\(chartFrame\) : null/);
assert.match(sourceSetterSection, /aqiSourceController\.begin\(\{[\s\S]*range: displayedRange/);
assert.match(sourceSetterSection, /clearAqi: \(\) => \{[\s\S]*syncAqiBands\(chartFrame,[\s\S]*forceClear: true/);
assert.match(sourceSetterSection, /displayedRange,[\s\S]*aqiTransition,[\s\S]*settledAqiCacheHit: isAqiSourceRangeSettled\(selectedEntry, displayedRange\)/);

assert.match(targetedSection, /const aqiTransition = aqiSourceChanged[\s\S]*aqiSourceController\.begin/);
assert.match(targetedSection, /const sourceNeedsAqi = aqiSourceChanged[\s\S]*aqiSourceController\.shouldRequest\([\s\S]*getUncoveredRanges\(primaryRecord, "aqi", requestedRange\)/);
assert.match(targetedSection, /const sourceLoadPromise = \(sourceNeedsObservations \|\| sourceNeedsAqi\)/, "a settled AQI-only switch starts no source request");
assert.match(targetedSection, /observations: sourceNeedsObservations,[\s\S]*aqi: sourceNeedsAqi/, "AQI-only requests exclude observations");
assert.match(targetedSection, /aqiSourceController\.stage\(aqiTransition\)/, "AQI work is staged without painting");
assert.match(targetedSection, /aqiSourceController\.complete\(\{[\s\S]*aqiWorkPromise,[\s\S]*commit: commitTargetedRender,[\s\S]*renderUnavailable:/);
assert.match(targetedSection, /if \(isAqiSourceChangeOnly\) \{[\s\S]*await aqiCompletionPromise;[\s\S]*\} else \{[\s\S]*observationHistoryPromise/, "AQI-only completion does not await observation history");
assert.match(targetedSection, /aqiChangeOnly: aqiSourceChanged && !addedEntries\.length/, "the one AQI commit takes the AQI-only renderer path");
assert.match(targetedSection, /void prefetchStationHistoryAqi/, "background prefetch remains non-blocking");
assert.doesNotMatch(targetedSection, /AQI bands could not be updated|setMessage\([^\n]*AQI/, "AQI-only outcomes do not own the page-wide message");

const legacyStart = page.indexOf("async function loadLegacyChartData");
const legacyEnd = page.indexOf("async function loadStationHistoryChartData", legacyStart);
const legacySection = page.slice(legacyStart, legacyEnd);
assert.match(legacySection, /const displayedAqiSourceRange = isAqiSourceChangeOnly && isCurrentChartFrame\(dom\?\.chartFrame\)[\s\S]*const range = displayedAqiSourceRange \|\| resolveRange\(windowValue\)/);
assert.match(legacySection, /getMissingRangesForRequest\(range, aqiCacheRecord\.settledRanges\)/);
assert.match(legacySection, /aqiSourceController\.shouldRequest\(aqiTransition, \(\) => aqiMissingRanges\.length === 0\)/);
assert.match(legacySection, /if \(!aqiCacheRecord \|\| !aqiNetworkRequired\)/, "a settled compatibility switch starts no AQI request");
assert.match(legacySection, /aqiSourceController\.complete\(\{[\s\S]*aqiWorkPromise: aqiProgressPromise,[\s\S]*commit: commitAqiSourceSwitch/);
assert.match(legacySection, /void prefetchAqiBandsForEntries/, "compatibility prefetch is not awaited");
assert.doesNotMatch(legacySection, /AQI bands could not be updated|aqiSourceSwitchMessages/);

const updateStart = page.indexOf("function updateChart(");
const updateEnd = page.indexOf("function ensureChartFrame", updateStart);
const updateSection = page.slice(updateStart, updateEnd);
assert.ok(updateSection.indexOf("if (renderOptions.aqiChangeOnly && !xChanged && !yChanged)") < updateSection.indexOf("const drawPaths"), "AQI-only commits return before observation path drawing");

const olderChunkStart = page.indexOf("async function loadStationHistoryOlderChunks");
const olderChunkEnd = page.indexOf("async function prefetchStationHistoryAqi", olderChunkStart);
const olderChunkSection = page.slice(olderChunkStart, olderChunkEnd);
assert.match(olderChunkSection, /inspectAqiChunk/);
assert.match(olderChunkSection, /aqiOutcome\.retryable_incomplete[\s\S]*record\.retryable_chunks/);
assert.match(olderChunkSection, /if \(aqiOutcome\.actual_failure\)[\s\S]*actualFailure = true/);

for (const field of [
  "aqi_source_switch_total_ms",
  "aqi_source_switch_transition_ms",
  "aqi_source_switch_cache_hit",
  "aqi_source_switch_network_required",
  "aqi_source_switch_commit_count",
]) {
  assert.match(controllerSource, new RegExp(field), `shared controller diagnostics include ${field}`);
}
assert.match(sensorsPage, /include_observations/);
assert.match(sensorsPage, /include_aqi/);
assert.match(sensorsPage, /isCalculatedCombinedResponse/);
assert.doesNotMatch(sensorsPage, /data-aqi-source-station-id/, "the single-sensor chart has no AQI source control");

console.log("Hex Map shared AQI source-controller harness passed");
