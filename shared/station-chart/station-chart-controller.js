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
  const api = factory(domain, cache, sourceModule, diagnosticsModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqStationChartController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain, cache, sourceModule, diagnosticsModule) {
  "use strict";

  if (!domain || !cache || !sourceModule) {
    throw new Error("Shared station-chart domain, cache, and AQI-source modules are required");
  }

  const DEFAULT_OLDER_CHUNK_MS = 7 * 24 * domain.HOUR_MS;

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

    function commitResult(entry, result, requestedRange, mode) {
      const record = recordFor(entry);
      if (!record || result?.identity_valid !== true) {
        throw new Error("station_series_authoritative_identity_invalid");
      }
      record.identity = result.identity;
      if (result.observations?.enabled === true) {
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
      if (result.aqi?.enabled === true) {
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

    async function loadOlder(entry, initialResult, requestedRange, parts, signal, generation, onCommit) {
      const requestedKinds = [parts.observations && "observations", parts.aqi && "aqi"].filter(Boolean);
      const boundaries = requestedKinds.map(function (kind) {
        return resultBoundary(initialResult[kind], kind);
      }).filter(Boolean);
      if (!boundaries.length) return;
      let cursorEndUtc = boundaries.sort(function (left, right) { return Date.parse(right) - Date.parse(left); })[0];
      const stableHeadStartUtc = initialResult.aqi?.stable_head_start_utc
        || initialResult.observations?.stable_head_start_utc
        || cursorEndUtc;
      const spanMs = Math.max(domain.HOUR_MS, Number(options.olderChunkMs) || DEFAULT_OLDER_CHUNK_MS);
      while (cursorEndUtc && !signal.aborted && generations.isCurrent(generation)) {
        const chunk = cache.nextChunkRange(requestedRange.startIso, cursorEndUtc, spanMs);
        if (!chunk || !cache.intervalBounds(chunk)) break;
        const chunkRange = domain.snapshotChartRange(chunk);
        const record = recordFor(entry);
        const needsNetwork = requestedKinds.some(function (kind) {
          return cache.getUncoveredRanges(record, kind, chunkRange).length > 0;
        });
        if (!needsNetwork) {
          cursorEndUtc = chunk.start_utc;
          continue;
        }
        const result = await client().loadOlder(requestFor(entry, chunkRange, parts, {
          stable_head_start_utc: stableHeadStartUtc,
        }), parts, signal);
        if (signal.aborted || !generations.isCurrent(generation)) throw abortError();
        commitResult(entry, result, chunkRange, "older");
        diagnostics.event("station_history_chunk_committed", {
          generation,
          source: clientKind,
          timeseries_id: entry.timeseries_id,
          start_utc: chunkRange.startIso,
          end_utc: chunkRange.endIso,
        });
        onCommit?.();
        const nextBoundaries = requestedKinds.map(function (kind) {
          return resultBoundary(result[kind], kind);
        }).filter(Boolean);
        const next = nextBoundaries.length
          ? nextBoundaries.sort(function (left, right) { return Date.parse(right) - Date.parse(left); })[0]
          : chunk.start_utc;
        if (Date.parse(next) >= Date.parse(cursorEndUtc)) break;
        cursorEndUtc = Date.parse(next) > requestedRange.startMs ? next : null;
      }
    }

    async function loadEntry(entry, requestedRange, parts, signal, generation, onCommit) {
      const result = await client().loadCurrent(requestFor(entry, requestedRange, parts), parts, signal);
      if (signal.aborted || !generations.isCurrent(generation)) throw abortError();
      commitResult(entry, result, requestedRange, "current");
      onCommit?.("current");
      if (parts.observations === true && parts.aqi !== true && options.backgroundAqiPrefetch !== false) {
        void prefetchEntryAqi(entry, requestedRange, signal, generation)
          .catch(function (error) {
            if (!isAbort(error)) diagnostics.event("station_chart_aqi_prefetch_failed", {
              generation,
              timeseries_id: entry.timeseries_id,
              error: error?.message || String(error),
            });
          });
      }
      await loadOlder(entry, result, requestedRange, parts, signal, generation, function () { onCommit?.("older"); });
      return result;
    }

    async function prefetchEntryAqi(entry, requestedRange, signal, generation) {
      const inFlightKey = `${recordKey(entry)}|${requestedRange.startIso}|${requestedRange.endIso}|${clientKind}`;
      if (aqiPrefetchInFlight.has(inFlightKey)) return aqiPrefetchInFlight.get(inFlightKey);
      const work = (async function () {
        const parts = { observations: false, aqi: true };
        const result = await client().prefetchAqi(requestFor(entry, requestedRange, parts), signal);
        if (signal.aborted || !generations.isCurrent(generation)) throw abortError();
        commitResult(entry, result, requestedRange, "current");
        await loadOlder(entry, result, requestedRange, parts, signal, generation);
        return result;
      })().finally(function () {
        if (aqiPrefetchInFlight.get(inFlightKey) === work) aqiPrefetchInFlight.delete(inFlightKey);
      });
      aqiPrefetchInFlight.set(inFlightKey, work);
      return work;
    }

    async function load(reason) {
      if (destroyed || !mounted || !range) return null;
      activeAbortController?.abort();
      const abortController = new AbortController();
      activeAbortController = abortController;
      const generation = generations.next();
      const source = selectedSource();
      diagnostics.event("station_chart_load_started", {
        generation,
        reason,
        source: clientKind,
        selected_count: selection.length,
        aqi_source_id: source?.station_id || null,
      });
      renderer.setLoading?.(true, { reason, generation });
      options.onMessage?.("");
      if (!selection.length) {
        renderer.renderEmpty?.(options.emptyMessage || "Select a sensor to draw a chart.");
        renderer.setLoading?.(false, { reason, generation });
        if (activeAbortController === abortController) activeAbortController = null;
        return null;
      }
      try {
        const work = selection.map(function (entry) {
          return loadEntry(entry, range, {
            observations: true,
            aqi: entry.station_id === source?.station_id,
          }, abortController.signal, generation, renderAll);
        });
        const settled = await Promise.allSettled(work);
        if (!generations.isCurrent(generation) || abortController.signal.aborted) return null;
        const observationFailure = settled.find(function (item) { return item.status === "rejected" && !isAbort(item.reason); });
        if (observationFailure) throw observationFailure.reason;
        renderAll({ reason, generation, complete: true });
        diagnostics.event("station_chart_load_completed", { generation, reason, source: clientKind });
        return currentState({ reason, generation, complete: true });
      } catch (error) {
        if (!isAbort(error) && generations.isCurrent(generation)) {
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
  };
});
