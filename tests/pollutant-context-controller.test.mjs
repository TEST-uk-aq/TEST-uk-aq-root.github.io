import assert from "node:assert/strict";
import controllerModule from "../station_chart/pollutant-context-controller.js";
import adapterModule from "../hex_map/hex-map-station-chart-adapter.js";

const { createPollutantContextController, RENDER_MODES } = controllerModule;
const { createHexMapStationChartAdapter } = adapterModule;

function entry(stationId, pollutant, timeseriesId = `${stationId}-${pollutant}`) {
  return { stationId, pollutant, timeseriesId };
}

const calls = [];
const pending = new Map();
const controller = createPollutantContextController({
  onLoading: (load) => calls.push({ type: "loading", pollutant: load.pollutant, generation: load.generation }),
  onFailed: (load) => calls.push({ type: "failed", pollutant: load.pollutant, generation: load.generation }),
  onRender: async (load) => {
    calls.push({
      type: "render",
      pollutant: load.pollutant,
      generation: load.generation,
      renderMode: load.renderMode,
      preserveRange: load.preserveRange,
      selectedStationIds: [...load.selectedStationIds],
      primaryStationId: load.primaryStationId,
      aqiSourceStationId: load.aqiSourceStationId,
      empty: load.empty,
      animation: load.renderMode === RENDER_MODES.initial,
    });
    if (pending.has(load.pollutant)) await pending.get(load.pollutant).promise;
    load.complete(() => {
      calls.push({ type: "visible-commit", pollutant: load.pollutant, generation: load.generation });
    });
  },
});
const adapter = createHexMapStationChartAdapter({ controller, isActive: () => true });
assert.equal(
  adapter.resolveStatus({ pollutant: "pm10", loadedPollutant: "pm25", dataStatus: "ready" }),
  "loading",
  "the adapter does not confuse the UI pollutant with loaded map identity",
);
assert.equal(
  adapter.resolveStatus({ pollutant: "pm10", loadedPollutant: "pm10", dataStatus: "ready", entries: [] }),
  "ready",
  "a successfully loaded empty target is authoritative",
);

await controller.setPollutantContext({
  pollutant: "pm25",
  entries: [entry("A", "pm25"), entry("B", "pm25")],
  status: "ready",
  selectedStationIds: ["A", "B"],
  primaryStationId: "A",
  aqiSourceStationId: "B",
  preserveRange: true,
  preserveSelection: true,
});
const initialRender = calls.find((call) => call.type === "render" && call.pollutant === "pm25");
assert.equal(initialRender.renderMode, RENDER_MODES.initial);
assert.equal(initialRender.animation, true, "the first chart render keeps the animated mode");
assert.equal(controller.renderedPollutant, "pm25");

await controller.setPollutantContext({
  pollutant: "pm10",
  entries: [],
  status: "loading",
  selectedStationIds: ["A", "B"],
});
const renderCountBeforeMismatchedReady = calls.filter((call) => call.type === "render").length;
const mismatchedReady = await controller.setPollutantContext({
  pollutant: "pm10",
  entries: [entry("A", "pm25")],
  status: "ready",
  selectedStationIds: ["A", "B"],
});
assert.equal(mismatchedReady.status, "not-ready");
assert.equal(
  calls.filter((call) => call.type === "render").length,
  renderCountBeforeMismatchedReady,
  "PM10 cannot render while the supplied entries still belong to PM2.5",
);

await controller.setPollutantContext({
  pollutant: "pm10",
  entries: [entry("A", "pm10")],
  status: "ready",
  selectedStationIds: ["A", "B"],
  primaryStationId: "B",
  aqiSourceStationId: "B",
  preserveRange: true,
  preserveSelection: true,
});
const pm10Render = calls.find((call) => call.type === "render" && call.pollutant === "pm10");
assert.equal(pm10Render.renderMode, RENDER_MODES.pollutantReplacement);
assert.equal(pm10Render.animation, false, "pollutant replacement disables the first-render animation");
assert.equal(pm10Render.preserveRange, true);
assert.deepEqual(pm10Render.selectedStationIds, ["A"], "supported stations remain in original order");
assert.equal(pm10Render.primaryStationId, "A", "the primary source is reconciled to a valid station");
assert.equal(pm10Render.aqiSourceStationId, "A", "the AQI source is reconciled to a valid station");
assert.equal(controller.renderedPollutant, "pm10");

await controller.setPollutantContext({
  pollutant: "pm25",
  entries: [],
  status: "loading",
  selectedStationIds: ["A"],
});
await controller.setPollutantContext({
  pollutant: "pm25",
  entries: [],
  status: "ready",
  selectedStationIds: ["A"],
  primaryStationId: "A",
  aqiSourceStationId: "A",
});
const emptyRender = calls.filter((call) => call.type === "render" && call.pollutant === "pm25").at(-1);
assert.equal(emptyRender.empty, true, "a ready zero-entry result is authoritative");
assert.deepEqual(emptyRender.selectedStationIds, [], "confirmed empty removes old selections and entry objects");
assert.equal(calls.at(-1).type, "visible-commit", "confirmed empty commits without an unresolved-selection error path");

let releasePm10;
pending.set("pm10", {});
pending.get("pm10").promise = new Promise((resolve) => { releasePm10 = resolve; });
await controller.setPollutantContext({ pollutant: "pm10", entries: [], status: "loading", selectedStationIds: [] });
const latePm10 = controller.setPollutantContext({
  pollutant: "pm10",
  entries: [entry("A", "pm10")],
  status: "ready",
  selectedStationIds: ["A"],
});
await new Promise((resolve) => setImmediate(resolve));
await controller.setPollutantContext({ pollutant: "no2", entries: [], status: "loading", selectedStationIds: ["A"] });
await controller.setPollutantContext({
  pollutant: "no2",
  entries: [entry("A", "no2")],
  status: "ready",
  selectedStationIds: ["A"],
});
releasePm10();
const latePm10Result = await latePm10;
assert.equal(latePm10Result.committed, false);
const rapidVisiblePollutants = calls
  .filter((call) => call.type === "visible-commit")
  .map((call) => call.pollutant);
assert.equal(rapidVisiblePollutants.at(-1), "no2");
assert.equal(
  rapidVisiblePollutants.filter((pollutant, index) => pollutant === "pm10" && index > rapidVisiblePollutants.lastIndexOf("pm25")).length,
  0,
  "late PM10 work performs no visible commit after NO2 becomes the target",
);
pending.delete("pm10");

const renderedBeforeFailure = controller.renderedPollutant;
const callCountBeforeFailure = calls.length;
await controller.setPollutantContext({ pollutant: "pm10", entries: [], status: "loading", selectedStationIds: ["A"] });
await controller.setPollutantContext({ pollutant: "pm10", entries: [], status: "failed", selectedStationIds: ["A"] });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(controller.renderedPollutant, renderedBeforeFailure, "failed target data does not become rendered");
assert.equal(calls.filter((call) => call.type === "failed").length, 1);
assert.equal(calls.length, callCountBeforeFailure + 2, "failure does not create an automatic retry loop");

await controller.setPollutantContext({ pollutant: "no2", entries: [], status: "loading", selectedStationIds: ["A"] });
await controller.setPollutantContext({
  pollutant: "no2",
  entries: [entry("A", "no2"), entry("C", "no2")],
  status: "ready",
  selectedStationIds: ["A", "C"],
  primaryStationId: "A",
  aqiSourceStationId: "A",
});
const incremental = calls.filter((call) => call.type === "render" && call.pollutant === "no2").at(-1);
assert.equal(incremental.renderMode, RENDER_MODES.incrementalSelection);
assert.deepEqual(incremental.selectedStationIds, ["A", "C"]);
await controller.setPollutantContext({
  pollutant: "no2",
  entries: [entry("A", "no2"), entry("C", "no2")],
  status: "ready",
  selectedStationIds: ["A"],
  primaryStationId: "A",
  aqiSourceStationId: "A",
});
const incrementalRemoval = calls.filter((call) => call.type === "render" && call.pollutant === "no2").at(-1);
assert.equal(incrementalRemoval.renderMode, RENDER_MODES.incrementalSelection);
assert.deepEqual(incrementalRemoval.selectedStationIds, ["A"]);
assert.equal(
  incrementalRemoval.animation,
  false,
  "same-pollutant additions and removals stay on the incremental renderer path",
);

console.log("shared pollutant-context controller harness passed");
