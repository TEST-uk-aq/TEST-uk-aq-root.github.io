import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../hex_map/index.html", import.meta.url), "utf8");
const sensorsPage = fs.readFileSync(new URL("../sensors/index.html", import.meta.url), "utf8");
const loadStart = page.indexOf("async function loadStationHistoryChartData");
const loadEnd = page.indexOf("function resizeChartFrame", loadStart);
const loadSection = page.slice(loadStart, loadEnd);
const targetedStart = loadSection.indexOf("if (frameValid && (reason === \"sensor-change\" || isAqiSourceChangeOnly))");
const targetedEnd = loadSection.indexOf("const preserveExistingFrame", targetedStart);
const targetedSection = loadSection.slice(targetedStart, targetedEnd);

assert.ok(loadStart >= 0 && targetedStart >= 0 && targetedEnd > targetedStart, "Hex Map targeted station-history loader exists");
assert.match(page, /HEX_MAP_STATION_HISTORY_CACHE_CONTRACT = "hex-map-station-history-v5-explicit-response-parts"/);
assert.match(page, /<script src="\/station-history-loader\.js"><\/script>/);
assert.match(page, /const clippedStartMs = Math\.max\(frame\.startMs, periodStartMs\)/);
assert.match(page, /const clippedEndMs = Math\.min\(frame\.endMs, endpointMs\)/);
assert.doesNotMatch(page, /carryForwardLevels/);

const sourceSetterStart = page.indexOf("function setAqiSourceSensor");
const sourceSetterEnd = page.indexOf("function buildChartHeaderHtml", sourceSetterStart);
const sourceSetterSection = page.slice(sourceSetterStart, sourceSetterEnd);
assert.match(sourceSetterSection, /state\.aqiTransitionToken = Number\(state\.aqiTransitionToken \|\| 0\) \+ 1/, "a second selection invalidates the older transition synchronously");
assert.match(sourceSetterSection, /syncAqiBands\(chartFrame,[\s\S]*forceClear: true,[\s\S]*aqiLoading: true/, "the previous source bands disappear at selection time, even while an older load is aborting");

assert.match(targetedSection, /forceClearAqi: aqiSourceChanged/, "the previous source bands are cleared immediately");
assert.match(targetedSection, /waitForTransition\(AQI_SOURCE_TRANSITION_MS, signal\)/, "the intentional transition delay remains");
assert.match(targetedSection, /createAtomicAqiRenderGate/, "source switching uses an explicit visible render gate");
assert.match(targetedSection, /aqiTransitionGate\?\.stage\(\)/, "settled head and chunk work is staged");
assert.match(targetedSection, /const aqiScheduler = aqiSourceChanged[\s\S]*schedule: \(\) => \{[\s\S]*aqiTransitionGate\?\.stage\(\)[\s\S]*flush: \(\) => Promise\.resolve\(\)/, "AQI switch chunks settle without a render callback");
assert.match(targetedSection, /await Promise\.all\(\[aqiHistoryPromise, observationHistoryPromise, aqiTransitionPromise\]\)/);
assert.match(targetedSection, /aqiTransitionGate\?\.markTerminal\(\)/);
assert.match(targetedSection, /aqiTransitionGate\.commit\(commitTargetedRender\)/, "the visible AQI layer commits once at terminal state");
assert.match(targetedSection, /aqiTransitionIncomplete[\s\S]*available intervals are shown/, "terminal partial results retain valid intervals and report incompleteness");
assert.match(targetedSection, /token === state\.loadToken[\s\S]*aqiTransitionToken === state\.aqiTransitionToken/, "obsolete load and transition tokens cannot commit");

assert.match(targetedSection, /addedStationIds: new Set\(\), removedStationIds: new Set\(\), retainedStationIds:/, "an AQI-only change has no observation selection diff");
assert.match(targetedSection, /const sourceNeedsObservations = selectionDiff\.addedStationIds\.has\(primary\.stationId\)/);
assert.match(targetedSection, /observations: sourceNeedsObservations,[\s\S]*aqi: sourceNeedsAqi/, "the AQI-only request explicitly excludes observations");
assert.match(targetedSection, /skipAqiRepaint: true/, "observation-only targeted renders cannot expose staged AQI");
assert.match(targetedSection, /aqiChangeOnly: aqiSourceChanged && !addedEntries\.length/, "the final AQI-only commit takes the non-observation repaint path");

const updateStart = page.indexOf("function updateChart(");
const updateEnd = page.indexOf("function ensureChartFrame", updateStart);
const updateSection = page.slice(updateStart, updateEnd);
assert.ok(updateSection.indexOf("if (renderOptions.aqiChangeOnly && !xChanged && !yChanged)") < updateSection.indexOf("const drawPaths"), "AQI-only commits return before observation path drawing");

const legacyStart = page.indexOf("async function loadLegacyChartData");
const legacyEnd = page.indexOf("async function loadStationHistoryChartData", legacyStart);
const legacySection = page.slice(legacyStart, legacyEnd);
assert.match(legacySection, /const atomicAqiSourceSwitch = isAqiSourceChangeOnly && frameValid/);
assert.match(legacySection, /aqiTransitionGate\.stage\(\);[\s\S]*return;[\s\S]*syncAqiBands/, "legacy fallback also gates per-chunk AQI painting");
assert.match(legacySection, /aqiTransitionGate\.commit\(commitAqiSourceSwitch\)/, "legacy fallback also commits once");

assert.match(sensorsPage, /<script src="\/station-history-loader\.js"><\/script>/, "Sensors uses the shared loader");
assert.match(sensorsPage, /include_observations/);
assert.match(sensorsPage, /include_aqi/);
assert.match(sensorsPage, /isCalculatedCombinedResponse/, "Sensors retains the combined-response consumer");
assert.doesNotMatch(sensorsPage, /data-aqi-source-station-id/, "the single-sensor chart has no AQI source-switch control");

console.log("Hex Map atomic AQI source-switch harness passed");
