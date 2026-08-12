// Sole owner of the atomic visible AQI-source transition.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("./station-chart-domain.js") : null);
  const diagnosticsModule = root.UkAqStationChartDiagnostics
    || (typeof module === "object" && module.exports ? require("./station-chart-diagnostics.js") : null);
  const api = factory(domain, diagnosticsModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqSourceController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain, diagnosticsModule) {
  "use strict";

  if (!domain) throw new Error("UkAqStationChartDomain is required");

  const DEFAULT_TRANSITION_MS = 50;

  function waitForTransition(delayMs) {
    const duration = Math.max(0, Number(delayMs) || 0);
    return new Promise(function (resolve) { setTimeout(resolve, duration); });
  }

  function createAqiSourceController(options = {}) {
    const transitionMs = Math.max(0, Number(options.transitionMs ?? DEFAULT_TRANSITION_MS));
    const now = typeof options.now === "function"
      ? options.now
      : function () {
        return typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      };
    const wait = typeof options.wait === "function" ? options.wait : waitForTransition;
    const diagnostics = options.diagnostics
      || diagnosticsModule?.createDiagnostics?.()
      || { event() {}, timing() {} };
    const generations = domain.createGenerationTracker();
    let active = null;

    function isCurrent(transition) {
      return Boolean(transition)
        && active === transition
        && generations.isCurrent(transition.generation)
        && transition.invalidated !== true;
    }

    function begin(config = {}) {
      if (active) active.invalidated = true;
      const range = domain.snapshotChartRange(config.range);
      const sourceId = domain.normalizeStationIdentity(config.sourceId ?? config.source_id);
      if (!range || !sourceId) throw new Error("aqi_source_transition_identity_invalid");
      const generation = generations.next();
      const startedAt = now();
      if (typeof config.clearAqi === "function") config.clearAqi();
      const transitionPromise = Promise.resolve(wait(transitionMs)).then(function () {
        return Math.max(0, now() - startedAt);
      });
      const transition = {
        generation,
        load_generation: Number.isFinite(Number(config.loadGeneration)) ? Number(config.loadGeneration) : null,
        source_id: sourceId,
        range,
        started_at: startedAt,
        transition_promise: transitionPromise,
        staged_revision: 0,
        committed: false,
        invalidated: false,
      };
      active = transition;
      return transition;
    }

    function invalidate() {
      if (active) active.invalidated = true;
      generations.invalidate();
      active = null;
    }

    function stage(transition) {
      if (!isCurrent(transition) || transition.committed) return false;
      transition.staged_revision += 1;
      return true;
    }

    function shouldRequest(transition, inspectSettlement) {
      if (!isCurrent(transition)) return false;
      return !(typeof inspectSettlement === "function" && inspectSettlement() === true);
    }

    async function complete(config = {}) {
      const transition = config.transition;
      let workOutcome = null;
      let workError = null;
      const workPromise = Promise.resolve(config.aqiWorkPromise)
        .then(function (value) { workOutcome = value || null; })
        .catch(function (error) { workError = error; });
      const values = await Promise.all([
        workPromise,
        transition?.transition_promise || Promise.resolve(transitionMs),
      ]);
      const transitionElapsedMs = Number(values[1]);
      const externallyCurrent = typeof config.isCurrent === "function" ? config.isCurrent() === true : true;
      if (!isCurrent(transition) || !externallyCurrent) {
        const terminal = domain.classifyTerminalRequestOutcome({ obsolete: true });
        const transitionStartedAt = Number.isFinite(Number(transition?.started_at))
          ? Number(transition.started_at)
          : now();
        diagnostics.event("aqi_source_switch_timing", {
          ...config.diagnosticDetails,
          aqi_source_switch_total_ms: Math.round(now() - transitionStartedAt),
          aqi_source_switch_transition_ms: Math.round(Number.isFinite(transitionElapsedMs) ? transitionElapsedMs : transitionMs),
          aqi_source_switch_commit_count: 0,
          aqi_source_switch_settlement: terminal.settlement,
          aqi_source_switch_actual_failure: false,
        });
        return { ...terminal, committed: false, commit_count: 0 };
      }
      const terminal = workError
        ? domain.classifyTerminalRequestOutcome({ error: workError })
        : workOutcome && typeof workOutcome === "object"
          ? workOutcome
          : domain.classifyTerminalRequestOutcome({ settlement: { settled: true, complete: true } });
      let commitCount = 0;
      if (terminal.actual_failure === true) {
        if (typeof config.renderUnavailable === "function") config.renderUnavailable(terminal);
      } else if (!transition.committed && typeof config.commit === "function") {
        transition.committed = true;
        config.commit({ staged_revision: transition.staged_revision, terminal });
        commitCount = 1;
      }
      diagnostics.event("aqi_source_switch_timing", {
        ...config.diagnosticDetails,
        aqi_source_switch_total_ms: Math.round(now() - transition.started_at),
        aqi_source_switch_transition_ms: Math.round(Number.isFinite(transitionElapsedMs) ? transitionElapsedMs : transitionMs),
        aqi_source_switch_commit_count: commitCount,
        aqi_source_switch_settlement: terminal.settlement || null,
        aqi_source_switch_retryable_incomplete: terminal.retryable_incomplete === true,
        aqi_source_switch_actual_failure: terminal.actual_failure === true,
        aqi_source_switch_failure_reason: terminal.failure_reason || null,
        aqi_source_switch_partial_reasons: terminal.partial_reasons || [],
        aqi_source_switch_calculation_statuses: terminal.calculation_statuses || [],
        aqi_source_switch_missing_reasons: terminal.missing_reasons || [],
      });
      return { ...terminal, committed: commitCount === 1, commit_count: commitCount };
    }

    async function switchSource(config = {}) {
      const transition = begin(config);
      const requestRequired = shouldRequest(transition, config.isSettled);
      const aqiWorkPromise = requestRequired && typeof config.requestAqi === "function"
        ? Promise.resolve().then(function () { return config.requestAqi({ transition, range: transition.range }); })
        : Promise.resolve(domain.classifyTerminalRequestOutcome({
          settlement: { settled: true, complete: true },
        }));
      return complete({
        transition,
        aqiWorkPromise,
        isCurrent: config.isCurrent,
        commit: config.commit,
        renderUnavailable: config.renderUnavailable,
        diagnosticDetails: {
          ...config.diagnosticDetails,
          aqi_source_switch_cache_hit: !requestRequired,
          aqi_source_switch_network_required: requestRequired,
          aqi_source_switch_waited_for_observation_work: false,
          aqi_source_switch_observation_wait_ms: 0,
        },
      });
    }

    return Object.freeze({
      begin,
      invalidate,
      isCurrent,
      shouldRequest,
      stage,
      complete,
      switchSource,
      get active() { return active; },
      get transition_ms() { return transitionMs; },
    });
  }

  return { DEFAULT_TRANSITION_MS, createAqiSourceController };
});
