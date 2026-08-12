// Sole orchestration owner for one shared station-chart instance.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("./station-chart-domain.js") : null);
  const cache = root.UkAqStationChartCache
    || (typeof module === "object" && module.exports ? require("./station-chart-cache.js") : null);
  const sourceModule = root.UkAqSourceController
    || (typeof module === "object" && module.exports ? require("./aqi-source-controller.js") : null);
  const diagnosticsModule = root.UkAqStationChartDiagnostics
    || (typeof module === "object" && module.exports ? require("./station-chart-diagnostics.js") : null);
  const historyLoader = root.UkAqStationHistoryLoader
    || (typeof module === "object" && module.exports ? require("./station-history-loader.js") : null);
  const api = factory(domain, cache, sourceModule, diagnosticsModule, historyLoader);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqStationChartController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain, cache, sourceModule, diagnosticsModule, historyLoader) {
  "use strict";

  if (!domain || !cache || !sourceModule || !historyLoader) {
    throw new Error("Shared station-chart domain, cache, AQI-source, and history-loader modules are required");
  }

  const DEFAULT_OLDER_CHUNK_MS = 7 * 24 * domain.HOUR_MS;
  const DEFAULT_PRIMARY_OBSERVATION_CONCURRENCY = 3;
  const DEFAULT_ADDITIONAL_OBSERVATION_CONCURRENCY = 2;
  const DEFAULT_PRIMARY_AQI_CONCURRENCY = 2;
  const DEFAULT_PRIORITIES = Object.freeze({ primary: 0, observations: 1, aqiPrefetch: 2 });

  function abortError() {
    const error = new Error("Station-chart load aborted");
    error.name = "AbortError";
    return error;
  }

  function isAbort(error) {
    return error?.name === "AbortError";
  }

  function normalizeEntry(entry) {
    const timeseriesId = domain.positiveInteger(entry?.timeseries_id ?? entry?.timeseriesId ?? entry?.id);
    const connectorId = domain.positiveInteger(entry?.connector_id ?? entry?.connectorId);
    const stationId = domain.normalizeStationIdentity(entry?.station_id ?? entry?.stationId);
    const pollutant = domain.normalizePollutant(entry?.pollutant ?? entry?.pollutant_code);
    if (!timeseriesId || !connectorId || !stationId || !pollutant) return null;
    return Object.freeze({
      ...entry,
      timeseries_id: timeseriesId,
      connector_id: connectorId,
      station_id: stationId,
      pollutant,
    });
  }

  function resultBoundary(section, kind) {
    const value = section?.next_chunk_end_utc
      || (kind === "aqi" ? section?.next_older_aqi_chunk_end_utc : section?.next_older_observation_chunk_end_utc)
      || section?.next_older_chunk_end_utc
      || null;
    const date = domain.toDate(value);
    return date ? date.toISOString() : null;
  }

  function sectionBounds(section, fallbackRange) {
    return domain.snapshotChartRange({
      start_utc: section?.stable_head_start_utc || fallbackRange.start_utc,
      end_utc: section?.stable_head_end_utc || fallbackRange.end_utc,
    }) || fallbackRange;
  }

  function pointsInRange(points, range) {
    return (Array.isArray(points) ? points : []).filter(function (point) {
      const timeMs = point?.date?.getTime?.();
      return Number.isFinite(timeMs) && timeMs >= range.startMs && timeMs <= range.endMs;
    });
  }

  function defaultOlderChunkMs(windowLabel) {
    if (windowLabel === "24h") return 6 * domain.HOUR_MS;
    if (windowLabel === "7d") return 24 * domain.HOUR_MS;
    if (windowLabel === "31d") return 3 * 24 * domain.HOUR_MS;
    if (windowLabel === "90d") return 7 * 24 * domain.HOUR_MS;
    return 24 * domain.HOUR_MS;
  }

  function resolvePositiveLimit(value, fallback) {
    return Math.max(1, Math.floor(Number(value) || fallback));
  }

  function buildOlderWorkPlan(record, initialResult, requestedRange, parts, spanMs, priority) {
    const byRequest = new Map();
    ["observations", "aqi"].forEach(function (kind) {
      if (parts?.[kind] !== true) return;
      const section = initialResult?.[kind];
      const cursorEndUtc = resultBoundary(section, kind);
      if (!cursorEndUtc) return;
      const stableHeadStartUtc = domain.toDate(section?.stable_head_start_utc)?.toISOString() || cursorEndUtc;
      cache.buildMissingChunkWorkList(
        record,
        kind,
        requestedRange.startIso,
        cursorEndUtc,
        spanMs,
      ).forEach(function (item) {
        const requestKey = `${item.range.start_utc}|${item.range.end_utc}|${stableHeadStartUtc}`;
        if (!byRequest.has(requestKey)) {
          byRequest.set(requestKey, {
            range: item.range,
            stable_head_start_utc: stableHeadStartUtc,
            observations: false,
            aqi: false,
          });
        }
        byRequest.get(requestKey)[kind] = true;
      });
    });
    let observationSequence = 0;
    let aqiSequence = 0;
    return Array.from(byRequest.values()).sort(function (left, right) {
      return Date.parse(right.range.end_utc) - Date.parse(left.range.end_utc)
        || Date.parse(right.range.start_utc) - Date.parse(left.range.start_utc)
        || Number(right.observations) - Number(left.observations);
    }).map(function (item, sequence) {
      return Object.freeze({
        ...item,
        sequence,
        observation_sequence: item.observations ? observationSequence++ : null,
        aqi_sequence: item.aqi ? aqiSequence++ : null,
        parts: Object.freeze({
          observations: item.observations,
          aqi: item.aqi,
          priority,
        }),
      });
    });
  }

  async function runQueueWithConcurrency(queue, concurrency, iterator) {
    const items = Array.isArray(queue) ? queue : [];
    if (!items.length) return;
    const limit = Math.min(resolvePositiveLimit(concurrency, 1), items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: limit }, async function () {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await iterator(items[index], index);
      }
    }));
  }

  function scheduleOrderedSettlement(buffer, sequence, value, commit) {
    const settlement = buffer.settle(sequence, value, commit);
    // Network workers must not await visible/cache settlement. Attach a handler
    // immediately so a later final flush remains authoritative without an
    // interim rejected chain becoming unhandled.
    void settlement.catch(function () {});
    return settlement;
  }

  function createRenderScheduler(render, isCurrent) {
    let frameId = null;
    let pending = Promise.resolve();
    let resolvePending = null;
    const run = function () {
      if (frameId === null) return;
      frameId = null;
      const resolve = resolvePending;
      resolvePending = null;
      if (isCurrent()) render();
      resolve?.();
    };
    return {
      schedule() {
        if (frameId !== null) return pending;
        pending = new Promise(function (resolve) { resolvePending = resolve; });
        if (typeof requestAnimationFrame === "function") frameId = requestAnimationFrame(run);
        else {
          frameId = -1;
          queueMicrotask(run);
        }
        return pending;
      },
      flush() {
        if (frameId !== null) {
          if (frameId >= 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frameId);
          run();
        }
        return pending;
      },
    };
  }

  function createStationChartController(options = {}) {
    const renderer = options.renderer;
    const clients = {
      calculated: options.calculatedClient,
      compatibility: options.compatibilityClient,
    };
    if (!renderer || !clients.calculated || !clients.compatibility) {
      throw new Error("station_chart_controller_configuration_missing");
    }
    [clients.calculated, clients.compatibility].forEach(function (client) {
      if (!client?.loadCurrent || !client?.loadOlder || !client?.prefetchAqi) {
        throw new Error("station_chart_client_interface_invalid");
      }
    });

    const diagnostics = options.diagnostics
      || diagnosticsModule?.createDiagnostics?.()
      || { event() {}, timing() {} };
    const records = options.records instanceof Map ? options.records : new Map();
    const aqiPrefetchInFlight = new Map();
    const backgroundAbortControllers = new Set();
    const generations = domain.createGenerationTracker();
    const aqiSourceController = options.aqiSourceController
      || sourceModule.createAqiSourceController({ diagnostics, transitionMs: options.aqiTransitionMs ?? 50 });
    let selection = [];
    let range = null;
    let aqiSourceId = null;
    let activeAbortController = null;
    let sourceAbortController = null;
    let destroyed = false;
    let mounted = false;
    let clientKind = options.useCompatibility === true ? "compatibility" : "calculated";
    let renderRevision = 0;
    let loading = false;

    function client() {
      return clients[clientKind];
    }

    function recordKey(entry) {
      return domain.buildStationHistoryCacheKey(entry, options.cacheContract || cache.CACHE_CONTRACT_VERSION);
    }

    function recordFor(entry) {
      const key = recordKey(entry);
      if (!key) return null;
      if (!records.has(key)) records.set(key, cache.createCacheRecord());
      return records.get(key);
    }

    function selectedSource() {
      return selection.find(function (entry) { return entry.station_id === aqiSourceId; }) || selection[0] || null;
    }

    function observationCoverageSummary(requestedRange) {
      const requested = cache.intervalBounds(requestedRange);
      const incompleteSeries = [];
      let failedIntervalCount = 0;
      let partialIntervalCount = 0;
      let uncoveredIntervalCount = 0;
      selection.forEach(function (entry) {
        const record = recordFor(entry);
        const uncovered = cache.getUncoveredRanges(record, "observations", requestedRange);
        if (!uncovered.length) return;
        const intervalStates = Array.isArray(record?.coverage?.observations?.interval_states)
          ? record.coverage.observations.interval_states
          : [];
        const relevantStates = intervalStates.filter(function (interval) {
          const bounds = cache.intervalBounds(interval);
          return requested && bounds && bounds.endMs > requested.startMs && bounds.startMs < requested.endMs;
        });
        const failed = relevantStates.filter(function (interval) { return interval.state === "failed"; }).length;
        const partial = relevantStates.filter(function (interval) { return interval.state === "partial"; }).length;
        failedIntervalCount += failed;
        partialIntervalCount += partial;
        uncoveredIntervalCount += uncovered.length;
        incompleteSeries.push({
          station_id: entry.station_id,
          timeseries_id: entry.timeseries_id,
          uncovered_interval_count: uncovered.length,
          failed_interval_count: failed,
          partial_interval_count: partial,
        });
      });
      return Object.freeze({
        complete: incompleteSeries.length === 0,
        failed_interval_count: failedIntervalCount,
        partial_interval_count: partialIntervalCount,
        uncovered_interval_count: uncoveredIntervalCount,
        incomplete_series: incompleteSeries.slice(0, 4),
      });
    }

    function requestFor(entry, requestedRange, parts, extra = {}) {
      return {
        connector_id: entry.connector_id,
        timeseries_id: entry.timeseries_id,
        station_id: domain.positiveInteger(entry.station_id),
        pollutant: entry.pollutant,
        start_utc: requestedRange.startIso,
        end_utc: requestedRange.endIso,
        include_observations: parts.observations === true,
        include_aqi: parts.aqi === true,
        window: options.getWindowLabel?.() || null,
        ...extra,
      };
    }

    function currentState(extra = {}) {
      const source = selectedSource();
      const observations = new Map();
      selection.forEach(function (entry) {
        observations.set(entry.station_id, pointsInRange(recordFor(entry)?.observation_points, range));
      });
      return Object.freeze({
        selection: selection.slice(),
        aqi_source_id: source?.station_id || null,
        range,
        observations,
        aqi: source ? pointsInRange(recordFor(source)?.aqi_points, range) : [],
        guideline: source ? recordFor(source)?.guideline || source.guideline || null : null,
        loading,
        revision: renderRevision,
        ...extra,
      });
    }

    function renderAll(extra = {}) {
      if (destroyed || !range) return;
      renderRevision += 1;
      const value = currentState(extra);
      renderer.renderAxes?.(value);
      renderer.renderObservations?.(value);
      renderer.renderAqi?.(value);
    }

    function renderAqiOnly(extra = {}) {
      if (destroyed || !range) return;
      renderRevision += 1;
      renderer.renderAqi?.(currentState({ ...extra, aqi_only: true }));
    }

    function commitResult(entry, result, requestedRange, mode, requestedKinds = null) {
      const record = recordFor(entry);
      if (!record || result?.identity_valid !== true) {
        throw new Error("station_series_authoritative_identity_invalid");
      }
      record.identity = result.identity;
      const allows = function (kind) { return !requestedKinds || requestedKinds.includes(kind); };
      if (allows("observations") && result.observations?.enabled === true) {
        const bounds = mode === "current" ? sectionBounds(result.observations, requestedRange) : requestedRange;
        record.observation_points = mode === "current"
          ? cache.replaceAuthoritativeObservationHead(
              record.observation_points,
              result.observations.points,
              bounds.startIso,
              bounds.endIso,
            )
          : cache.mergeObservationPoints(record.observation_points, result.observations.points);
        const observationSettlement = cache.inspectObservationChunk({
          ...result.observations,
          rows: result.observations.rows,
        });
        cache.recordCoverageInterval(
          record,
          "observations",
          { start_utc: bounds.startIso, end_utc: bounds.endIso },
          observationSettlement.complete ? "complete" : "partial",
          observationSettlement,
        );
      }
      if (allows("aqi") && result.aqi?.enabled === true) {
        const bounds = mode === "current" ? sectionBounds(result.aqi, requestedRange) : requestedRange;
        const merged = mode === "current"
          ? cache.replaceAuthoritativeAqiHead(record.aqi_points, result.aqi.points, bounds.startIso, bounds.endIso)
          : cache.mergeAqiWithoutReplacement(record.aqi_points, result.aqi.points);
        record.aqi_points = merged.points;
        const settlement = clientKind === "compatibility"
          ? {
              complete: result.aqi.response_complete === true && result.aqi.has_gap !== true,
              settled: !result.aqi.error && result.aqi.identity_valid !== false,
              has_gap: result.aqi.has_gap === true,
              partial_reasons: cache.boundedStrings(result.aqi.partial_reasons),
              calculation_statuses: [],
              missing_reasons: [],
            }
          : cache.inspectAqiSettlement({ ...result.aqi, points: result.aqi.rows });
        const safe = settlement.settled && !merged.conflicts.length;
        cache.recordCoverageInterval(
          record,
          "aqi",
          { start_utc: bounds.startIso, end_utc: bounds.endIso },
          settlement.complete && !merged.conflicts.length ? "complete" : "partial",
          { ...settlement, settled: safe },
        );
        if (merged.conflicts.length) throw new Error("aqi_replacement_contract_error");
      }
      record.guideline = result.raw?.guideline || record.guideline || entry.guideline || null;
      record.updated_at = new Date().toISOString();
      return record;
    }

    function olderChunkMs() {
      const configured = typeof options.olderChunkMs === "function"
        ? options.olderChunkMs(options.getWindowLabel?.())
        : options.olderChunkMs;
      return Math.max(
        domain.HOUR_MS,
        Number(configured) || defaultOlderChunkMs(options.getWindowLabel?.()) || DEFAULT_OLDER_CHUNK_MS,
      );
    }

    function recordFailedOlderWork(entry, workItem, kind, error, generation) {
      const record = recordFor(entry);
      cache.recordCoverageInterval(record, kind, workItem.range, "failed");
      diagnostics.event("station_history_chunk_failed", {
        generation,
        source: clientKind,
        timeseries_id: entry.timeseries_id,
        start_utc: workItem.range.start_utc,
        end_utc: workItem.range.end_utc,
        kind,
        error: error?.message || String(error),
      });
    }

    async function loadOlder(entry, initialResult, requestedRange, parts, signal, generation, callbacks = {}) {
      const record = recordFor(entry);
      const work = buildOlderWorkPlan(
        record,
        initialResult,
        requestedRange,
        parts,
        olderChunkMs(),
        parts.priority,
      );
      const observationWorkCount = work.filter(function (item) { return item.observations; }).length;
      callbacks.onPlanned?.(observationWorkCount, work);
      if (!work.length) return { work_count: 0, observation_work_count: 0 };
      const orderedByKind = {
        observations: historyLoader.createOrderedSettlementBuffer(0),
        aqi: historyLoader.createOrderedSettlementBuffer(0),
      };
      const containsObservations = work.some(function (item) { return item.observations; });
      const concurrency = containsObservations
        ? resolvePositiveLimit(
            parts.primary === true ? options.primaryObservationConcurrency : options.additionalObservationConcurrency,
            parts.primary === true ? DEFAULT_PRIMARY_OBSERVATION_CONCURRENCY : DEFAULT_ADDITIONAL_OBSERVATION_CONCURRENCY,
          )
        : resolvePositiveLimit(options.primaryAqiConcurrency, DEFAULT_PRIMARY_AQI_CONCURRENCY);

      await runQueueWithConcurrency(work, concurrency, async function (workItem) {
        if (signal.aborted || !generations.isCurrent(generation)) throw abortError();
        const chunkRange = domain.snapshotChartRange(workItem.range);
        let settled;
        try {
          const result = await client().loadOlder(requestFor(entry, chunkRange, workItem.parts, {
            stable_head_start_utc: workItem.stable_head_start_utc,
          }), workItem.parts, signal);
          settled = { workItem, chunkRange, result };
        } catch (error) {
          if (isAbort(error) || signal.aborted || !generations.isCurrent(generation)) throw abortError();
          settled = { workItem, chunkRange, error };
        }
        if (workItem.observations) callbacks.onObservationSettled?.();
        const kinds = [workItem.observations && "observations", workItem.aqi && "aqi"].filter(Boolean);
        kinds.forEach(function (kind) {
          const sequence = kind === "observations" ? workItem.observation_sequence : workItem.aqi_sequence;
          scheduleOrderedSettlement(orderedByKind[kind], sequence, { ...settled, kind }, async function (value) {
            if (signal.aborted || !generations.isCurrent(generation)) throw abortError();
            if (value.error) {
              recordFailedOlderWork(entry, value.workItem, kind, value.error, generation);
              return;
            }
            commitResult(entry, value.result, value.chunkRange, "older", [kind]);
            diagnostics.event("station_history_chunk_committed", {
              generation,
              source: clientKind,
              timeseries_id: entry.timeseries_id,
              start_utc: value.chunkRange.startIso,
              end_utc: value.chunkRange.endIso,
              kind,
            });
            callbacks.onCommit?.(kind);
          });
        });
      });
      await Promise.all([orderedByKind.observations.flush(), orderedByKind.aqi.flush()]);
      return { work_count: work.length, observation_work_count: observationWorkCount };
    }

    function startBackgroundAqiPrefetch(entry, requestedRange, parentSignal, generation) {
      if (options.backgroundAqiPrefetch === false) return;
      const abortController = new AbortController();
      const abort = function () { abortController.abort(); };
      parentSignal?.addEventListener?.("abort", abort, { once: true });
      backgroundAbortControllers.add(abortController);
      void prefetchEntryAqi(entry, requestedRange, abortController.signal, generation)
        .catch(function (error) {
          if (!isAbort(error)) diagnostics.event("station_chart_aqi_prefetch_failed", {
            generation,
            timeseries_id: entry.timeseries_id,
            error: error?.message || String(error),
          });
        })
        .finally(function () {
          parentSignal?.removeEventListener?.("abort", abort);
          backgroundAbortControllers.delete(abortController);
        });
    }

    async function loadEntry(entry, requestedRange, parts, signal, generation, callbacks = {}) {
      const result = await client().loadCurrent(requestFor(entry, requestedRange, parts), parts, signal);
      if (signal.aborted || !generations.isCurrent(generation)) throw abortError();
      commitResult(entry, result, requestedRange, "current");
      callbacks.onCommit?.("current");
      await loadOlder(entry, result, requestedRange, parts, signal, generation, {
        onPlanned: callbacks.onPlanned,
        onObservationSettled: callbacks.onObservationSettled,
        onCommit: function () { callbacks.onCommit?.("older"); },
      });
      if (parts.observations === true && parts.aqi !== true) {
        startBackgroundAqiPrefetch(entry, requestedRange, signal, generation);
      }
      return result;
    }

    async function prefetchEntryAqi(entry, requestedRange, signal, generation) {
      const inFlightKey = `${recordKey(entry)}|${requestedRange.startIso}|${requestedRange.endIso}|${clientKind}`;
      const existing = aqiPrefetchInFlight.get(inFlightKey);
      if (existing && !existing.signal?.aborted) return existing.promise;
      if (existing) aqiPrefetchInFlight.delete(inFlightKey);
      let holder = null;
      const work = (async function () {
        const parts = { observations: false, aqi: true };
        const result = await client().prefetchAqi(requestFor(entry, requestedRange, parts), signal);
        if (signal.aborted || !generations.isCurrent(generation)) throw abortError();
        commitResult(entry, result, requestedRange, "current");
        await loadOlder(entry, result, requestedRange, {
          ...parts,
          priority: Number(options.priorities?.aqiPrefetch ?? DEFAULT_PRIORITIES.aqiPrefetch),
          primary: true,
        }, signal, generation);
        return result;
      })().finally(function () {
        if (aqiPrefetchInFlight.get(inFlightKey) === holder) aqiPrefetchInFlight.delete(inFlightKey);
      });
      holder = { promise: work, signal };
      aqiPrefetchInFlight.set(inFlightKey, holder);
      return work;
    }

    async function load(reason) {
      if (destroyed || !mounted || !range) return null;
      activeAbortController?.abort();
      backgroundAbortControllers.forEach(function (controller) { controller.abort(); });
      backgroundAbortControllers.clear();
      const abortController = new AbortController();
      activeAbortController = abortController;
      const generation = generations.next();
      const source = selectedSource();
      const renderScheduler = createRenderScheduler(renderAll, function () {
        return !abortController.signal.aborted && generations.isCurrent(generation);
      });
      let observationProgressTotal = 0;
      let observationProgressSettled = 0;
      const updateObservationProgress = function () {
        if (observationProgressTotal > 0) {
          renderer.updateProgress?.(observationProgressSettled, observationProgressTotal);
        }
      };
      const addObservationProgress = function (count) {
        const value = Math.max(0, Math.floor(Number(count) || 0));
        if (!value) return;
        observationProgressTotal += value;
        updateObservationProgress();
      };
      const settleObservationProgress = function () {
        observationProgressSettled = Math.min(observationProgressTotal, observationProgressSettled + 1);
        updateObservationProgress();
      };
      diagnostics.event("station_chart_load_started", {
        generation,
        reason,
        source: clientKind,
        selected_count: selection.length,
        aqi_source_id: source?.station_id || null,
      });
      renderer.clearProgress?.();
      loading = true;
      renderer.setLoading?.(true, { reason, generation });
      options.onMessage?.("");
      if (!selection.length) {
        loading = false;
        renderer.renderEmpty?.(options.emptyMessage || "Select a sensor to draw a chart.");
        renderer.setLoading?.(false, { reason, generation });
        if (activeAbortController === abortController) activeAbortController = null;
        return null;
      }
      try {
        if (["window-change", "refresh"].includes(reason)) {
          renderer.animateDomains?.(currentState({ reason, generation, loading: true }));
        }
        const orderedSelection = source
          ? [source, ...selection.filter(function (entry) { return entry.station_id !== source.station_id; })]
          : selection.slice();
        const work = orderedSelection.map(function (entry) {
          const primary = entry.station_id === source?.station_id;
          const parts = {
            observations: true,
            aqi: primary,
            primary,
            priority: Number(primary
              ? options.priorities?.primary ?? DEFAULT_PRIORITIES.primary
              : options.priorities?.observations ?? DEFAULT_PRIORITIES.observations),
          };
          return loadEntry(entry, range, parts, abortController.signal, generation, {
            onCommit: function (mode) {
              if (mode === "current") renderAll();
              else void renderScheduler.schedule();
            },
            onPlanned: addObservationProgress,
            onObservationSettled: settleObservationProgress,
          });
        });
        const settled = await Promise.allSettled(work);
        if (!generations.isCurrent(generation) || abortController.signal.aborted) return null;
        await renderScheduler.flush();
        const observationFailure = settled.find(function (item) { return item.status === "rejected" && !isAbort(item.reason); });
        if (observationFailure) throw observationFailure.reason;
        const observationCoverage = observationCoverageSummary(range);
        loading = false;
        const completion = {
          reason,
          generation,
          complete: observationCoverage.complete,
          observation_complete: observationCoverage.complete,
          observation_coverage: observationCoverage,
        };
        renderAll(completion);
        if (observationCoverage.complete) {
          diagnostics.event("station_chart_load_completed", {
            generation,
            reason,
            source: clientKind,
            observation_complete: true,
          });
        } else {
          diagnostics.event("station_chart_load_incomplete", {
            generation,
            reason,
            source: clientKind,
            observation_complete: false,
            retryable_transport_failure: observationCoverage.failed_interval_count > 0,
            source_partial: observationCoverage.partial_interval_count > 0,
            failed_interval_count: observationCoverage.failed_interval_count,
            partial_interval_count: observationCoverage.partial_interval_count,
            uncovered_interval_count: observationCoverage.uncovered_interval_count,
            incomplete_series: observationCoverage.incomplete_series,
          });
        }
        return currentState(completion);
      } catch (error) {
        if (!isAbort(error) && generations.isCurrent(generation)) {
          loading = false;
          diagnostics.event("station_chart_load_failed", {
            generation,
            reason,
            source: clientKind,
            error: error?.message || String(error),
          });
          renderer.renderError?.(error);
          options.onMessage?.(options.loadErrorMessage || "Chart data could not be loaded.", { error: true });
        }
        return null;
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
          loading = false;
          renderer.clearProgress?.();
          renderer.setLoading?.(false, { reason, generation });
        }
      }
    }

    function setSelection(entries) {
      if (destroyed) return Promise.resolve(null);
      const seen = new Set();
      selection = (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(function (entry) {
        if (!entry || seen.has(entry.station_id)) return false;
        seen.add(entry.station_id);
        return true;
      }).slice(0, Math.max(1, Number(options.maxSelection) || 4));
      if (!selection.some(function (entry) { return entry.station_id === aqiSourceId; })) {
        aqiSourceId = selection[0]?.station_id || null;
      }
      return load("sensor-change");
    }

    async function setAqiSource(stationId) {
      const nextId = domain.normalizeStationIdentity(stationId);
      const entry = selection.find(function (candidate) { return candidate.station_id === nextId; });
      if (!entry || !range || nextId === aqiSourceId) return false;
      sourceAbortController?.abort();
      sourceAbortController = new AbortController();
      const signal = sourceAbortController.signal;
      aqiSourceId = nextId;
      const record = recordFor(entry);
      const requestedRange = range;
      await aqiSourceController.switchSource({
        sourceId: nextId,
        range: requestedRange,
        clearAqi: function () { renderer.clearAqi?.(); },
        isSettled: function () {
          return cache.getUncoveredRanges(record, "aqi", requestedRange).length === 0;
        },
        requestAqi: async function () {
          await prefetchEntryAqi(entry, requestedRange, signal, generations.current);
          if (signal.aborted || aqiSourceId !== nextId) throw abortError();
          const settlement = {
            settled: cache.getUncoveredRanges(record, "aqi", requestedRange).length === 0,
            complete: cache.getIncompleteRanges(record, "aqi", requestedRange).length === 0,
          };
          return domain.classifyTerminalRequestOutcome({
            settlement,
            identity_valid: Boolean(record.identity),
          });
        },
        isCurrent: function () { return !signal.aborted && aqiSourceId === nextId && !destroyed; },
        commit: function () { renderAqiOnly({ reason: "aqi-source-change" }); },
        renderUnavailable: function (terminal) { renderer.renderAqiUnavailable?.(terminal); },
        diagnosticDetails: {
          source: clientKind,
          source_station_id: nextId,
          observation_work_started: false,
        },
      });
      return true;
    }

    function setRange(value) {
      const nextRange = domain.snapshotChartRange(value);
      if (!nextRange || destroyed) return Promise.resolve(null);
      range = nextRange;
      return load("window-change");
    }

    function refresh() {
      return load("refresh");
    }

    function resize(dimensions) {
      if (destroyed || !mounted) return;
      renderer.resize?.(dimensions, currentState({ reason: "resize" }));
    }

    function setClientKind(value) {
      const next = value === "compatibility" ? "compatibility" : "calculated";
      if (next === clientKind) return Promise.resolve(null);
      clientKind = next;
      return load("refresh");
    }

    function mount(frame) {
      if (destroyed) throw new Error("station_chart_controller_destroyed");
      if (!mounted) {
        renderer.initialise?.(frame);
        mounted = true;
      }
      return true;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      mounted = false;
      activeAbortController?.abort();
      sourceAbortController?.abort();
      backgroundAbortControllers.forEach(function (controller) { controller.abort(); });
      backgroundAbortControllers.clear();
      activeAbortController = null;
      sourceAbortController = null;
      generations.invalidate();
      aqiSourceController.invalidate();
      aqiPrefetchInFlight.clear();
      renderer.destroy?.();
      selection = [];
      range = null;
      aqiSourceId = null;
    }

    return Object.freeze({
      mount,
      setSelection,
      setAqiSource,
      setRange,
      refresh,
      resize,
      setClientKind,
      destroy,
      get selection() { return selection.slice(); },
      get aqi_source_id() { return aqiSourceId; },
      get range() { return range; },
      get client_kind() { return clientKind; },
      get mounted() { return mounted; },
      get destroyed() { return destroyed; },
    });
  }

  return {
    createStationChartController,
    normalizeEntry,
    resultBoundary,
    pointsInRange,
    defaultOlderChunkMs,
    buildOlderWorkPlan,
    runQueueWithConcurrency,
    scheduleOrderedSettlement,
    createRenderScheduler,
  };
});
