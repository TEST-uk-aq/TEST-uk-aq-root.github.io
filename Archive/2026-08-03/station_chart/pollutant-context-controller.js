// Shared owner of station-chart pollutant context replacement.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("./station-chart-domain.js") : null);
  const api = factory(domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqPollutantContextController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain) {
  "use strict";

  if (!domain) throw new Error("UkAqStationChartDomain is required");

  const DATA_STATUSES = Object.freeze({
    loading: "loading",
    ready: "ready",
    failed: "failed",
  });
  const RENDER_MODES = Object.freeze({
    initial: "initial",
    pollutantReplacement: "pollutant-replacement",
    incrementalSelection: "incremental-selection",
  });

  function normalizeStatus(value) {
    const status = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(DATA_STATUSES, status) ? status : null;
  }

  function uniqueStationIds(values) {
    const result = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach(function (value) {
      const stationId = domain.normalizeStationIdentity(value);
      if (!stationId || seen.has(stationId)) return;
      seen.add(stationId);
      result.push(stationId);
    });
    return result;
  }

  function reconcileSelection(config = {}) {
    const pollutant = domain.normalizePollutant(config.pollutant);
    const entries = [];
    const byStationId = new Map();
    (Array.isArray(config.entries) ? config.entries : []).forEach(function (entry) {
      const stationId = domain.normalizeStationIdentity(entry?.stationId ?? entry?.station_id);
      const entryPollutant = domain.normalizePollutant(entry?.pollutant ?? entry?.pollutant_code);
      if (!stationId || entryPollutant !== pollutant || byStationId.has(stationId)) return;
      byStationId.set(stationId, entry);
      entries.push(entry);
    });
    const selectedStationIds = uniqueStationIds(config.selectedStationIds)
      .filter(function (stationId) { return byStationId.has(stationId); });
    const selectedEntries = selectedStationIds.map(function (stationId) { return byStationId.get(stationId); });
    const requestedPrimaryId = domain.normalizeStationIdentity(config.primaryStationId);
    const requestedAqiSourceId = domain.normalizeStationIdentity(config.aqiSourceStationId);
    const primaryStationId = selectedStationIds.includes(requestedPrimaryId)
      ? requestedPrimaryId
      : selectedStationIds[0] || null;
    const aqiSourceStationId = selectedStationIds.includes(requestedAqiSourceId)
      ? requestedAqiSourceId
      : primaryStationId;
    return Object.freeze({
      entries: Object.freeze(entries.slice()),
      selectedEntries: Object.freeze(selectedEntries),
      selectedStationIds: Object.freeze(selectedStationIds),
      primaryStationId,
      aqiSourceStationId,
      empty: selectedStationIds.length === 0,
    });
  }

  function createPollutantContextController(options = {}) {
    const generations = domain.createGenerationTracker();
    const onCancel = typeof options.onCancel === "function" ? options.onCancel : function () {};
    const onLoading = typeof options.onLoading === "function" ? options.onLoading : function () {};
    const onFailed = typeof options.onFailed === "function" ? options.onFailed : function () {};
    const onRender = typeof options.onRender === "function" ? options.onRender : async function () {};
    const onCommit = typeof options.onCommit === "function" ? options.onCommit : function () {};
    let targetPollutant = null;
    let renderedPollutant = null;
    let targetStatus = null;
    let active = null;
    let destroyed = false;

    function abortActive(reason) {
      if (!active) return;
      active.invalidated = true;
      active.abortController.abort();
      onCancel({
        reason: reason || "obsolete",
        generation: active.generation,
        pollutant: active.pollutant,
      });
      active = null;
    }

    function isCurrent(load) {
      return Boolean(
        !destroyed
        && load
        && active === load
        && load.invalidated !== true
        && !load.signal.aborted
        && generations.isCurrent(load.generation)
        && load.pollutant === targetPollutant,
      );
    }

    function createLoad(config, generation, renderMode, selection) {
      const abortController = new AbortController();
      const load = {
        generation,
        pollutant: config.pollutant,
        status: config.status,
        renderMode,
        preserveRange: config.preserveRange !== false,
        preserveSelection: config.preserveSelection !== false,
        entries: selection.entries,
        selectedEntries: selection.selectedEntries,
        selectedStationIds: selection.selectedStationIds,
        primaryStationId: selection.primaryStationId,
        aqiSourceStationId: selection.aqiSourceStationId,
        empty: selection.empty,
        abortController,
        signal: abortController.signal,
        invalidated: false,
        completed: false,
        isCurrent: function () { return isCurrent(load); },
        commitVisible: function (callback) {
          if (!isCurrent(load)) return false;
          if (typeof callback === "function") callback();
          return true;
        },
        complete: function (callback) {
          if (!isCurrent(load)) return false;
          if (typeof callback === "function") callback();
          load.completed = true;
          return true;
        },
      };
      return load;
    }

    function nextGeneration(config, reason) {
      abortActive(reason);
      const generation = generations.next();
      targetPollutant = config.pollutant;
      return generation;
    }

    async function setPollutantContext(rawConfig = {}) {
      if (destroyed) return { status: "destroyed", committed: false };
      const pollutant = domain.normalizePollutant(rawConfig.pollutant);
      const status = normalizeStatus(rawConfig.status);
      if (!pollutant || !status) throw new Error("pollutant_context_identity_invalid");
      const config = { ...rawConfig, pollutant, status };
      const targetChanged = pollutant !== targetPollutant;
      let generation;
      if (targetChanged || targetPollutant === null) {
        generation = nextGeneration(config, "target-changed");
      } else if (status === DATA_STATUSES.ready && targetStatus !== DATA_STATUSES.loading) {
        generation = nextGeneration(config, "context-replaced");
      } else {
        generation = generations.current;
      }
      targetStatus = status;

      const emptySelection = reconcileSelection({
        ...config,
        entries: [],
      });
      if (status === DATA_STATUSES.loading) {
        const load = createLoad(config, generation, renderedPollutant ? RENDER_MODES.pollutantReplacement : RENDER_MODES.initial, emptySelection);
        active = load;
        load.commitVisible(function () { onLoading(load); });
        return { status, generation, committed: false };
      }
      if (status === DATA_STATUSES.failed) {
        const load = createLoad(config, generation, renderedPollutant ? RENDER_MODES.pollutantReplacement : RENDER_MODES.initial, emptySelection);
        active = load;
        load.commitVisible(function () { onFailed(load); });
        return { status, generation, committed: false };
      }

      const suppliedEntries = Array.isArray(config.entries) ? config.entries : [];
      const entriesBelongToTarget = suppliedEntries.every(function (entry) {
        return domain.normalizePollutant(entry?.pollutant ?? entry?.pollutant_code) === pollutant;
      });
      if (!entriesBelongToTarget) {
        targetStatus = DATA_STATUSES.loading;
        return { status: "not-ready", generation, committed: false };
      }

      const renderMode = renderedPollutant === null
        ? RENDER_MODES.initial
        : renderedPollutant === pollutant
          ? RENDER_MODES.incrementalSelection
          : RENDER_MODES.pollutantReplacement;
      const selection = reconcileSelection(config);
      const load = createLoad(config, generation, renderMode, selection);
      active = load;
      try {
        await onRender(load);
      } catch (error) {
        if (isCurrent(load) && error?.name !== "AbortError") {
          load.commitVisible(function () { onFailed({ ...load, error }); });
        }
        return { status: "failed", generation, committed: false, error };
      }
      if (!isCurrent(load) || !load.completed) {
        return { status: isCurrent(load) ? "incomplete" : "obsolete", generation, committed: false };
      }
      renderedPollutant = load.pollutant;
      onCommit(load);
      return { status: "committed", generation, committed: true, renderMode };
    }

    function invalidate(reason) {
      abortActive(reason || "invalidated");
      generations.invalidate();
    }

    function reset(reason) {
      invalidate(reason || "reset");
      targetPollutant = null;
      renderedPollutant = null;
      targetStatus = null;
    }

    function destroy() {
      destroyed = true;
      reset("destroyed");
    }

    return Object.freeze({
      setPollutantContext,
      invalidate,
      reset,
      destroy,
      isCurrent,
      get targetPollutant() { return targetPollutant; },
      get renderedPollutant() { return renderedPollutant; },
      get targetStatus() { return targetStatus; },
      get generation() { return generations.current; },
      get active() { return active; },
    });
  }

  return {
    DATA_STATUSES,
    RENDER_MODES,
    normalizeStatus,
    reconcileSelection,
    createPollutantContextController,
  };
});
