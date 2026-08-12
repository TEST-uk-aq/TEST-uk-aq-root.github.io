// Shared progressive station-history planning facade.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("./station-chart-domain.js") : null);
  const cache = root.UkAqStationChartCache
    || (typeof module === "object" && module.exports ? require("./station-chart-cache.js") : null);
  const api = factory(domain, cache);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqStationHistoryLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain, cache) {
  "use strict";

  if (!domain || !cache) throw new Error("Shared station-chart domain and cache modules are required");

  function isOlderChunk(startUtc, endUtc, stableHeadStartUtc) {
    const startMs = Date.parse(String(startUtc || ""));
    const endMs = Date.parse(String(endUtc || ""));
    const headStartMs = Date.parse(String(stableHeadStartUtc || ""));
    return Number.isFinite(startMs)
      && Number.isFinite(endMs)
      && Number.isFinite(headStartMs)
      && startMs < endMs
      && endMs <= headStartMs;
  }

  function createOrderedSettlementBuffer(firstSequence) {
    let nextSequence = Number.isInteger(firstSequence) ? firstSequence : 0;
    const pending = new Map();
    let commitChain = Promise.resolve();
    return {
      settle(sequence, value, commit) {
        pending.set(sequence, value);
        commitChain = commitChain.then(async function () {
          while (pending.has(nextSequence)) {
            const settled = pending.get(nextSequence);
            pending.delete(nextSequence);
            nextSequence += 1;
            await commit(settled);
          }
        });
        return commitChain;
      },
      flush() { return commitChain; },
      get next_sequence() { return nextSequence; },
      get pending_count() { return pending.size; },
    };
  }

  function createPriorityFetchScheduler(maxConcurrency) {
    const limit = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
    const queue = [];
    let active = 0;
    let sequence = 0;
    const abortError = function () {
      const error = new Error("Station-history request aborted");
      error.name = "AbortError";
      return error;
    };
    const pump = function () {
      while (active < limit && queue.length) {
        queue.sort(function (left, right) { return left.priority - right.priority || left.sequence - right.sequence; });
        const item = queue.shift();
        if (item.signal?.aborted) {
          item.reject(abortError());
          continue;
        }
        active += 1;
        Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(function () {
          active -= 1;
          pump();
        });
      }
    };
    return {
      schedule(priority, task, signal) {
        return new Promise(function (resolve, reject) {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          queue.push({
            priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
            sequence: sequence++,
            task,
            signal,
            resolve,
            reject,
          });
          pump();
        });
      },
      get active_count() { return active; },
      get queued_count() { return queue.length; },
      get max_concurrency() { return limit; },
    };
  }

  function isCalculatedCombinedResponse(payload) {
    return Number(payload?.schema_version) >= 2
      && payload?.aqi?.enabled === true
      && payload?.observations?.enabled === true
      && payload?.aqi?.calculation_source === "calculated_from_observations"
      && Array.isArray(payload?.observations?.rows)
      && Array.isArray(payload?.aqi?.rows);
  }

  function resolveStationSeriesHeadBounds(payload, kind, fallbackRange) {
    const section = kind === "aqi" ? payload?.aqi : payload?.observations;
    const range = domain.snapshotChartRange({
      startIso: section?.stable_head_start_utc || fallbackRange?.startIso,
      endIso: section?.stable_head_end_utc || fallbackRange?.endIso,
    });
    return range ? { startUtc: range.startIso, endUtc: range.endIso } : null;
  }

  return {
    HOUR_MS: domain.HOUR_MS,
    normalizeAqiPoint: domain.normalizeAqiPoint,
    normalizeObservationPoint: cache.normalizeObservationPoint,
    mergeAqiWithoutReplacement: cache.mergeAqiWithoutReplacement,
    replaceAuthoritativeAqiHead: cache.replaceAuthoritativeAqiHead,
    mergeObservationPoints: cache.mergeObservationPoints,
    replaceAuthoritativeObservationHead: cache.replaceAuthoritativeObservationHead,
    isOlderChunk,
    nextChunkRange: cache.nextChunkRange,
    chunkKey: cache.chunkKey,
    normalizeIntervals: cache.normalizeIntervals,
    subtractCoveredIntervals: cache.subtractCoveredIntervals,
    recordCoverageInterval: cache.recordCoverageInterval,
    getUncoveredRanges: cache.getUncoveredRanges,
    getIncompleteRanges: cache.getIncompleteRanges,
    buildMissingChunkWorkList: cache.buildMissingChunkWorkList,
    createOrderedSettlementBuffer,
    createPriorityFetchScheduler,
    normalizeStationIdentity: domain.normalizeStationIdentity,
    hasPositiveTimeseriesIdentity: domain.hasPositiveTimeseriesIdentity,
    resolveAuthoritativeIdentity: domain.resolveAuthoritativeIdentity,
    resolveSelectedStationEntries: domain.resolveSelectedStationEntries,
    createCacheRecord: cache.createCacheRecord,
    inspectAqiSettlement: cache.inspectAqiSettlement,
    inspectAqiChunk: cache.inspectAqiChunk,
    classifyAqiTransitionOutcome: domain.classifyTerminalRequestOutcome,
    inspectObservationChunk: cache.inspectObservationChunk,
    isCalculatedCombinedResponse,
    resolveStationSeriesHeadBounds,
  };
});
