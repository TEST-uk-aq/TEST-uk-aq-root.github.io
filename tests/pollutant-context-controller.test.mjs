import assert from "node:assert/strict";
import controllerModule from "../shared/station-chart/pollutant-context-controller.js";
import adapterModule from "../hex_map/hex-map-station-chart-adapter.js";

const { createPollutantContextController, RENDER_MODES } = controllerModule;
const { createHexMapStationChartAdapter } = adapterModule;

function entry(stationId, pollutant, timeseriesId = `${stationId}-${pollutant}`) {
  return { stationId, pollutant, timeseriesId };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createControlledHarness() {
  const events = [];
  const renderGates = new Map();
  const controller = createPollutantContextController({
    onCancel: (load) => events.push({ type: "cancel", ...load }),
    onLoading: (load) => events.push({ type: "loading", pollutant: load.pollutant, generation: load.generation }),
    onFailed: (load) => events.push({ type: "failed", pollutant: load.pollutant, generation: load.generation }),
    onRender: async (load) => {
      events.push({ type: "render", pollutant: load.pollutant, generation: load.generation, load });
      const gate = renderGates.get(load.pollutant);
      if (gate) await gate.promise;
      load.complete(() => events.push({ type: "visible-commit", pollutant: load.pollutant, generation: load.generation }));
    },
  });
  return {
    controller,
    events,
    holdRender(pollutant) {
      const gate = deferred();
      renderGates.set(pollutant, gate);
      return gate;
    },
  };
}

function readyContext(pollutant, stationId = "A") {
  return {
    pollutant,
    entries: [entry(stationId, pollutant)],
    status: "ready",
    selectedStationIds: [stationId],
    primaryStationId: stationId,
    aqiSourceStationId: stationId,
  };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

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

// A same-target loading notification cannot downgrade an authoritative ready
// context while that ready render is still active.
{
  const harness = createControlledHarness();
  await harness.controller.setPollutantContext(readyContext("pm25"));
  await harness.controller.setPollutantContext({ pollutant: "pm10", entries: [], status: "loading", selectedStationIds: ["A"] });
  const pm10Gate = harness.holdRender("pm10");
  const readyResultPromise = harness.controller.setPollutantContext(readyContext("pm10"));
  await nextTurn();

  const activeReadyLoad = harness.controller.active;
  const loadingCount = harness.events.filter((event) => event.type === "loading").length;
  const redundantResult = await harness.controller.setPollutantContext({
    pollutant: "pm10",
    entries: [],
    status: "loading",
    selectedStationIds: ["A"],
  });

  assert.equal(redundantResult.status, "ignored", "same-target loading is explicitly non-committing");
  assert.equal(activeReadyLoad.signal.aborted, false, "the active ready PM10 load is not aborted");
  assert.equal(harness.controller.active, activeReadyLoad, "the active ready PM10 load remains current");
  assert.equal(harness.controller.targetStatus, "ready", "target status does not regress to loading");
  assert.equal(
    harness.events.filter((event) => event.type === "loading").length,
    loadingCount,
    "redundant loading does not emit another loading callback",
  );

  pm10Gate.resolve();
  const readyResult = await readyResultPromise;
  assert.equal(readyResult.status, "committed");
  assert.equal(harness.controller.renderedPollutant, "pm10");
  assert.equal(harness.controller.targetStatus, "ready", "the controller does not remain stranded in loading state");

  const loadingCountAfterCommit = harness.events.filter((event) => event.type === "loading").length;
  const duplicateAfterCommit = await harness.controller.setPollutantContext({
    pollutant: "pm10",
    entries: [],
    status: "loading",
    selectedStationIds: ["A"],
  });
  assert.equal(duplicateAfterCommit.status, "ignored");
  assert.equal(harness.controller.renderedPollutant, "pm10", "rendered PM10 remains visible");
  assert.equal(harness.controller.targetStatus, "ready");
  assert.equal(
    harness.events.filter((event) => event.type === "loading").length,
    loadingCountAfterCommit,
    "already-rendered PM10 is not replaced by a loading message",
  );
}

// Reproduce the browser's real cached Countries and Regions listener order:
// the map listener is registered first and synchronously supplies ready cache
// entries before the adapter's pollutantchange listener requests loading.
{
  const harness = createControlledHarness();
  await harness.controller.setPollutantContext(readyContext("pm25"));
  const pm10Gate = harness.holdRender("pm10");
  const eventTarget = new EventTarget();
  let orderedAdapter;
  eventTarget.addEventListener("pollutantchange", () => {
    orderedAdapter.sync({
      mapKey: "cr",
      pollutant: "pm10",
      loadedPollutant: "pm10",
      dataStatus: "ready",
      entries: [entry("A", "pm10")],
    });
  });
  orderedAdapter = createHexMapStationChartAdapter({
    controller: harness.controller,
    eventTarget,
    isActive: () => true,
    getSelection: () => ({ selectedStationIds: ["A"], primaryStationId: "A", aqiSourceStationId: "A" }),
  });
  orderedAdapter.mount();

  const pollutantEvent = new Event("pollutantchange");
  Object.defineProperty(pollutantEvent, "detail", { value: { pollutant: "pm10" } });
  eventTarget.dispatchEvent(pollutantEvent);
  await nextTurn();

  assert.equal(harness.events.filter((event) => event.type === "loading").length, 0, "cached listener order emits no late loading callback");
  assert.equal(harness.controller.targetPollutant, "pm10");
  assert.equal(harness.controller.targetStatus, "ready");
  pm10Gate.resolve();
  await nextTurn();
  assert.equal(
    harness.events.filter((event) => event.type === "visible-commit" && event.pollutant === "pm10").length,
    1,
    "cached PM10 visibly commits exactly once",
  );
  assert.equal(harness.controller.renderedPollutant, "pm10");
  assert.equal(harness.controller.targetStatus, "ready");
  orderedAdapter.destroy();
}

// A genuine uncached loading -> ready sequence is unchanged.
{
  const harness = createControlledHarness();
  await harness.controller.setPollutantContext({ pollutant: "pm10", entries: [], status: "loading", selectedStationIds: ["A"] });
  await harness.controller.setPollutantContext(readyContext("pm10"));
  assert.equal(harness.events.filter((event) => event.type === "loading").length, 1);
  assert.equal(harness.events.filter((event) => event.type === "render" && event.pollutant === "pm10").length, 1);
  assert.equal(harness.events.filter((event) => event.type === "visible-commit" && event.pollutant === "pm10").length, 1);
  assert.equal(harness.controller.renderedPollutant, "pm10");
  assert.equal(harness.controller.targetStatus, "ready");
}

// A genuinely different target still invalidates an active ready render.
{
  const harness = createControlledHarness();
  await harness.controller.setPollutantContext(readyContext("pm25"));
  await harness.controller.setPollutantContext({ pollutant: "pm10", entries: [], status: "loading", selectedStationIds: ["A"] });
  const pm10Gate = harness.holdRender("pm10");
  const pm10ResultPromise = harness.controller.setPollutantContext(readyContext("pm10"));
  await nextTurn();
  const pm10Load = harness.controller.active;

  await harness.controller.setPollutantContext({ pollutant: "no2", entries: [], status: "loading", selectedStationIds: ["A"] });
  assert.equal(pm10Load.signal.aborted, true, "different-target loading aborts active PM10 work");
  await harness.controller.setPollutantContext(readyContext("no2"));
  pm10Gate.resolve();
  const pm10Result = await pm10ResultPromise;
  assert.equal(pm10Result.status, "obsolete");
  assert.equal(
    harness.events.filter((event) => event.type === "visible-commit" && event.pollutant === "pm10").length,
    0,
    "obsolete PM10 never commits",
  );
  assert.equal(harness.events.filter((event) => event.type === "visible-commit").at(-1).pollutant, "no2");
  assert.equal(harness.controller.targetPollutant, "no2");
  assert.equal(harness.controller.renderedPollutant, "no2");
}

console.log("shared pollutant-context controller harness passed");
