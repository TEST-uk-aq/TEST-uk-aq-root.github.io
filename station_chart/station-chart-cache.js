// Shared observation/AQI cache semantics for UK AQ station charts.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("./station-chart-domain.js") : null);
  const api = factory(domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqStationChartCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain) {
  "use strict";

  if (!domain) throw new Error("UkAqStationChartDomain is required");

  const CACHE_CONTRACT_VERSION = "station-history-v5-shared-cache";
  const CACHE_RANGE_STATES = new Set([
    "covered_empty",
    "covered_with_data",
    "failed",
    "partial",
    "malformed",
    "unknown",
  ]);

  function normalizeObservationPoint(row) {
    const date = domain.toDate(row?.observed_at || row?.observed_at_utc);
    const value = Number(row?.value ?? row?.value_ugm3 ?? row?.observed_value);
    return date && Number.isFinite(value) && value >= 0 ? { date, value } : null;
  }

  function aqiEquivalent(left, right) {
    return left?.daqi === right?.daqi && left?.eaqi === right?.eaqi;
  }

  function mergeAqiWithoutReplacement(existingPoints, incomingPoints) {
    const byHour = new Map();
    const conflicts = [];
    (Array.isArray(existingPoints) ? existingPoints : []).forEach(function (point) {
      const key = domain.hourKey(point?.date);
      if (key !== null && !byHour.has(key)) byHour.set(key, point);
    });
    (Array.isArray(incomingPoints) ? incomingPoints : []).forEach(function (point) {
      const key = domain.hourKey(point?.date);
      if (key === null) return;
      const existing = byHour.get(key);
      if (!existing) {
        byHour.set(key, point);
      } else if (!aqiEquivalent(existing, point)) {
        conflicts.push({
          hour_utc: new Date(key).toISOString(),
          retained: existing,
          rejected: point,
        });
      }
    });
    return {
      points: Array.from(byHour.values()).sort(function (left, right) {
        return left.date.getTime() - right.date.getTime();
      }),
      conflicts,
    };
  }

  function replaceAuthoritativeAqiHead(existingPoints, headPoints, headStartUtc, headEndUtc) {
    const startMs = Date.parse(String(headStartUtc || ""));
    const endMs = Date.parse(String(headEndUtc || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return mergeAqiWithoutReplacement(existingPoints, headPoints);
    }
    const retained = (Array.isArray(existingPoints) ? existingPoints : []).filter(function (point) {
      const key = domain.hourKey(point?.date);
      return key === null || key <= startMs || key > endMs;
    });
    return mergeAqiWithoutReplacement(retained, headPoints);
  }

  function mergeObservationPoints(existingPoints, incomingPoints) {
    const byTimestamp = new Map();
    (Array.isArray(existingPoints) ? existingPoints : []).forEach(function (point) {
      const date = domain.toDate(point?.date);
      if (date) byTimestamp.set(date.getTime(), point);
    });
    (Array.isArray(incomingPoints) ? incomingPoints : []).forEach(function (point) {
      const date = domain.toDate(point?.date);
      if (date) byTimestamp.set(date.getTime(), point);
    });
    return Array.from(byTimestamp.values()).sort(function (left, right) {
      return left.date.getTime() - right.date.getTime();
    });
  }

  function replaceAuthoritativeObservationHead(existingPoints, headPoints, headStartUtc, headEndUtc) {
    const startMs = Date.parse(String(headStartUtc || ""));
    const endMs = Date.parse(String(headEndUtc || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return mergeObservationPoints(existingPoints, headPoints);
    }
    const retained = (Array.isArray(existingPoints) ? existingPoints : []).filter(function (point) {
      const timestampMs = domain.toDate(point?.date)?.getTime();
      return !Number.isFinite(timestampMs) || timestampMs < startMs || timestampMs >= endMs;
    });
    return mergeObservationPoints(retained, headPoints);
  }

  function intervalBounds(range) {
    return domain.rangeBounds(range);
  }

  function normalizeIntervals(intervals) {
    const sorted = (Array.isArray(intervals) ? intervals : [])
      .map(intervalBounds)
      .filter(Boolean)
      .sort(function (left, right) { return left.startMs - right.startMs || left.endMs - right.endMs; });
    const merged = [];
    sorted.forEach(function (interval) {
      const tail = merged[merged.length - 1];
      if (tail && interval.startMs <= tail.endMs) tail.endMs = Math.max(tail.endMs, interval.endMs);
      else merged.push({ ...interval });
    });
    return merged;
  }

  function subtractCoveredIntervals(range, coveredIntervals) {
    const requested = intervalBounds(range);
    if (!requested) return [];
    let missing = [requested];
    normalizeIntervals(coveredIntervals).forEach(function (covered) {
      missing = missing.flatMap(function (candidate) {
        if (covered.endMs <= candidate.startMs || covered.startMs >= candidate.endMs) return [candidate];
        const remaining = [];
        if (covered.startMs > candidate.startMs) {
          remaining.push({ startMs: candidate.startMs, endMs: Math.min(covered.startMs, candidate.endMs) });
        }
        if (covered.endMs < candidate.endMs) {
          remaining.push({ startMs: Math.max(covered.endMs, candidate.startMs), endMs: candidate.endMs });
        }
        return remaining;
      });
    });
    return missing
      .filter(function (interval) { return interval.endMs > interval.startMs; })
      .sort(function (left, right) { return right.endMs - left.endMs; })
      .map(function (interval) {
        return {
          startMs: interval.startMs,
          endMs: interval.endMs,
          start_utc: new Date(interval.startMs).toISOString(),
          end_utc: new Date(interval.endMs).toISOString(),
        };
      });
  }

  function normalizeCoverageSection(section) {
    const value = section && typeof section === "object" ? section : {};
    return {
      covered_intervals: normalizeIntervals(value.covered_intervals),
      settled_intervals: normalizeIntervals(value.settled_intervals),
      interval_states: (Array.isArray(value.interval_states) ? value.interval_states : [])
        .map(function (entry) {
          const bounds = intervalBounds(entry);
          return bounds ? {
            ...bounds,
            state: ["complete", "partial", "failed", "stale"].includes(entry?.state) ? entry.state : "failed",
            settled: entry?.settled === true,
            response_complete: entry?.response_complete === true,
            has_gap: entry?.has_gap === true,
            gap_ranges: normalizeIntervals(entry?.gap_ranges),
            partial_reasons: boundedStrings(entry?.partial_reasons),
            calculation_statuses: boundedStrings(entry?.calculation_statuses),
            missing_reasons: boundedStrings(entry?.missing_reasons),
            recorded_at_utc: typeof entry?.recorded_at_utc === "string" ? entry.recorded_at_utc : null,
          } : null;
        })
        .filter(Boolean),
    };
  }

  function coverageSection(record, kind) {
    if (!record.coverage || typeof record.coverage !== "object") record.coverage = {};
    record.coverage[kind] = normalizeCoverageSection(record.coverage[kind]);
    return record.coverage[kind];
  }

  function recordCoverageInterval(record, kind, range, state, details = {}) {
    const bounds = intervalBounds(range);
    if (!record || !["aqi", "observations"].includes(kind) || !bounds) return record;
    const section = coverageSection(record, kind);
    const normalizedState = ["complete", "partial", "failed", "stale"].includes(state) ? state : "failed";
    const settled = normalizedState === "complete" || (kind === "aqi" && details.settled === true);
    section.interval_states = section.interval_states.flatMap(function (entry) {
      if (entry.endMs <= bounds.startMs || entry.startMs >= bounds.endMs) return [entry];
      const retained = [];
      if (entry.startMs < bounds.startMs) retained.push({ ...entry, endMs: bounds.startMs });
      if (entry.endMs > bounds.endMs) retained.push({ ...entry, startMs: bounds.endMs });
      return retained;
    });
    section.interval_states.push({
      ...bounds,
      state: normalizedState,
      settled,
      response_complete: normalizedState === "complete" || details.response_complete === true,
      has_gap: details.has_gap === true,
      gap_ranges: normalizeIntervals(details.gap_ranges),
      partial_reasons: boundedStrings(details.partial_reasons),
      calculation_statuses: boundedStrings(details.calculation_statuses),
      missing_reasons: boundedStrings(details.missing_reasons),
      recorded_at_utc: new Date().toISOString(),
    });
    section.interval_states.sort(function (left, right) {
      return left.startMs - right.startMs || left.endMs - right.endMs;
    });
    if (normalizedState === "complete") {
      section.covered_intervals = normalizeIntervals([...section.covered_intervals, bounds]);
    } else {
      section.covered_intervals = subtractIntervals(section.covered_intervals, bounds);
    }
    if (kind === "aqi") {
      section.settled_intervals = settled
        ? normalizeIntervals([...section.settled_intervals, bounds])
        : subtractIntervals(section.settled_intervals, bounds);
    }
    return record;
  }

  function subtractIntervals(intervals, bounds) {
    return normalizeIntervals(intervals).flatMap(function (interval) {
      if (interval.endMs <= bounds.startMs || interval.startMs >= bounds.endMs) return [interval];
      const retained = [];
      if (interval.startMs < bounds.startMs) retained.push({ startMs: interval.startMs, endMs: bounds.startMs });
      if (interval.endMs > bounds.endMs) retained.push({ startMs: bounds.endMs, endMs: interval.endMs });
      return retained;
    });
  }

  function getUncoveredRanges(record, kind, range) {
    const section = coverageSection(record, kind);
    return subtractCoveredIntervals(range, kind === "aqi" ? section.settled_intervals : section.covered_intervals);
  }

  function getIncompleteRanges(record, kind, range) {
    return subtractCoveredIntervals(range, coverageSection(record, kind).covered_intervals);
  }

  function nextChunkRange(rangeStartUtc, cursorEndUtc, spanMs) {
    const rangeStartMs = Date.parse(String(rangeStartUtc || ""));
    const cursorEndMs = Date.parse(String(cursorEndUtc || ""));
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(cursorEndMs) || cursorEndMs <= rangeStartMs) return null;
    const safeSpanMs = Number.isFinite(spanMs) && spanMs > 0 ? spanMs : domain.HOUR_MS;
    const startMs = Math.max(rangeStartMs, cursorEndMs - safeSpanMs);
    return { start_utc: new Date(startMs).toISOString(), end_utc: new Date(cursorEndMs).toISOString() };
  }

  function chunkKey(kind, range) {
    return `${kind}:${range?.start_utc || ""}:${range?.end_utc || ""}`;
  }

  function buildMissingChunkWorkList(record, kind, rangeStartUtc, initialCursorEndUtc, spanMs) {
    const work = [];
    let cursorEndUtc = initialCursorEndUtc;
    while (cursorEndUtc) {
      const chunk = nextChunkRange(rangeStartUtc, cursorEndUtc, spanMs);
      if (!chunk) break;
      getUncoveredRanges(record, kind, chunk).forEach(function (requestRange) {
        work.push({ kind, range: requestRange, key: chunkKey(kind, requestRange), sequence: work.length });
      });
      cursorEndUtc = chunk.start_utc;
    }
    return work;
  }

  function createCacheRecord(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    return {
      contract_version: CACHE_CONTRACT_VERSION,
      aqi_points: Array.isArray(value.aqi_points) ? value.aqi_points : [],
      observation_points: Array.isArray(value.observation_points) ? value.observation_points : [],
      completed_chunks: objectValue(value.completed_chunks),
      failed_chunks: objectValue(value.failed_chunks),
      retryable_chunks: objectValue(value.retryable_chunks),
      coverage: {
        aqi: normalizeCoverageSection(value.coverage?.aqi),
        observations: normalizeCoverageSection(value.coverage?.observations),
      },
      aqi_complete: value.aqi_complete === true,
      observations_complete: value.observations_complete === true,
      calculated_combined: value.calculated_combined === true,
      identity: domain.resolveAuthoritativeIdentity({ identity: value.identity }) || null,
      guideline: value.guideline && typeof value.guideline === "object" ? value.guideline : null,
      updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
    };
  }

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function boundedStrings(values, limit = 16) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
      .map(function (value) { return String(value ?? "").trim().toLowerCase(); })
      .filter(Boolean)))
      .slice(0, Math.max(1, Number(limit) || 16));
  }

  function inspectAqiSettlement(payload) {
    const payloadIsObject = Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
    const rows = Array.isArray(payload?.points)
      ? payload.points
      : Array.isArray(payload?.rows)
        ? payload.rows
        : [];
    const rowsShapeValid = Array.isArray(payload?.points) || Array.isArray(payload?.rows);
    const partialReasons = boundedStrings(payload?.partial_reasons);
    const calculationStatuses = boundedStrings(rows.flatMap(function (row) {
      return [row?.daqi_calculation_status, row?.eaqi_calculation_status];
    }));
    const missingReasons = boundedStrings(rows.flatMap(function (row) {
      return [row?.daqi_missing_reason, row?.eaqi_missing_reason];
    }));
    const malformed = !payloadIsObject || !rowsShapeValid || payload?.malformed === true;
    const calculatedResponse = payload?.enabled !== false
      && payload?.calculation_source === "calculated_from_observations";
    const complete = !malformed && payload?.response_complete === true && payload?.has_gap !== true;
    const settledPartial = !malformed && !complete && calculatedResponse;
    const settled = complete || settledPartial;
    return {
      complete,
      settled,
      retryable: !settled,
      authoritative_partial: settledPartial,
      settled_partial: settledPartial,
      actual_failure: malformed,
      failure_reason: malformed ? "aqi_response_malformed" : null,
      response_complete: payload?.response_complete === true,
      has_gap: payload?.has_gap === true,
      gap_ranges: Array.isArray(payload?.gap_ranges) ? payload.gap_ranges : [],
      partial_reasons: partialReasons,
      calculation_statuses: calculationStatuses,
      missing_reasons: missingReasons,
    };
  }

  function inspectAqiChunk(payload) {
    const rows = Array.isArray(payload?.points)
      ? payload.points
      : Array.isArray(payload?.rows)
        ? payload.rows
        : [];
    return { rows, ...inspectAqiSettlement(payload) };
  }

  function inspectObservationChunk(payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const complete = payload?.response_complete === true && payload?.has_gap !== true;
    return {
      rows,
      complete,
      retryable: !complete,
      partial_reasons: boundedStrings(payload?.partial_reasons),
    };
  }

  function normalizeCacheRangeState(value) {
    const state = String(value || "").trim().toLowerCase();
    return CACHE_RANGE_STATES.has(state) ? state : "unknown";
  }

  function isCoveredCacheState(value) {
    const state = normalizeCacheRangeState(value);
    return state === "covered_empty" || state === "covered_with_data";
  }

  function getNonCoveredRangeProperty(state) {
    const normalized = normalizeCacheRangeState(state);
    return normalized === "failed" ? "failedRanges"
      : normalized === "partial" ? "partialRanges"
        : normalized === "malformed" ? "malformedRanges"
          : normalized === "unknown" ? "unknownRanges"
            : null;
  }

  function normalizeCoveredRanges(ranges = []) {
    const cleaned = (Array.isArray(ranges) ? ranges : [])
      .map(intervalBounds)
      .filter(Boolean)
      .sort(function (left, right) { return left.startMs - right.startMs; });
    if (!cleaned.length) return [];
    const merged = [{ ...cleaned[0] }];
    for (let index = 1; index < cleaned.length; index += 1) {
      const current = cleaned[index];
      const tail = merged[merged.length - 1];
      if (current.startMs <= tail.endMs + 1) tail.endMs = Math.max(tail.endMs, current.endMs);
      else merged.push({ ...current });
    }
    return merged;
  }

  function addCoveredRange(ranges, startMs, endMs) {
    return normalizeCoveredRanges([...(Array.isArray(ranges) ? ranges : []), { startMs, endMs }]);
  }

  function rangesOverlap(leftStartMs, leftEndMs, rightStartMs, rightEndMs) {
    return Number.isFinite(leftStartMs) && Number.isFinite(leftEndMs)
      && Number.isFinite(rightStartMs) && Number.isFinite(rightEndMs)
      && leftStartMs < rightEndMs && rightStartMs < leftEndMs;
  }

  function removeOverlappingRanges(ranges, startMs, endMs) {
    return normalizeCoveredRanges((Array.isArray(ranges) ? ranges : []).filter(function (segment) {
      return !rangesOverlap(Number(segment?.startMs), Number(segment?.endMs), startMs, endMs);
    }));
  }

  function normalizeCacheRangeStates(ranges = []) {
    return (Array.isArray(ranges) ? ranges : [])
      .filter(function (segment) {
        return Number.isFinite(segment?.startMs) && Number.isFinite(segment?.endMs) && segment.endMs > segment.startMs;
      })
      .map(function (segment) {
        return {
          startMs: Number(segment.startMs),
          endMs: Number(segment.endMs),
          state: normalizeCacheRangeState(segment.state),
          sourceMetadata: segment.sourceMetadata && typeof segment.sourceMetadata === "object" ? segment.sourceMetadata : null,
          error: segment.error ? String(segment.error) : null,
          httpStatus: Number.isFinite(Number(segment.httpStatus)) ? Number(segment.httpStatus) : null,
          recordedAtUtc: segment.recordedAtUtc || null,
        };
      })
      .sort(function (left, right) { return left.startMs - right.startMs; });
  }

  function normalizeCacheRecord(record = {}, defaults = {}) {
    const normalized = {
      ...record,
      ...defaults,
      points: Array.isArray(record.points) ? record.points : [],
      coveredRanges: normalizeCoveredRanges(record.coveredRanges),
      failedRanges: normalizeCoveredRanges(record.failedRanges),
      partialRanges: normalizeCoveredRanges(record.partialRanges),
      malformedRanges: normalizeCoveredRanges(record.malformedRanges),
      unknownRanges: normalizeCoveredRanges(record.unknownRanges),
      rangeStates: normalizeCacheRangeStates(record.rangeStates),
    };
    if (Object.prototype.hasOwnProperty.call(defaults, "guideline")) normalized.guideline = record.guideline || defaults.guideline || null;
    if (Object.prototype.hasOwnProperty.call(defaults, "lastResponseMeta")) normalized.lastResponseMeta = record.lastResponseMeta || defaults.lastResponseMeta || null;
    return normalized;
  }

  function normalizeSeriesCacheRecord(record = {}) {
    return normalizeCacheRecord(record, { guideline: null });
  }

  function normalizeAqiCacheRecord(record = {}) {
    return {
      ...normalizeCacheRecord(record, { lastResponseMeta: null }),
      settledRanges: normalizeCoveredRanges(record.settledRanges),
    };
  }

  function recordCacheRangeState(record, startMs, endMs, state, details = {}) {
    if (!record || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return record;
    const normalizedState = normalizeCacheRangeState(state);
    const nonCoveredProps = ["failedRanges", "partialRanges", "malformedRanges", "unknownRanges"];
    record.rangeStates = normalizeCacheRangeStates(record.rangeStates)
      .filter(function (segment) { return !rangesOverlap(segment.startMs, segment.endMs, startMs, endMs); });
    record.rangeStates.push({
      startMs,
      endMs,
      state: normalizedState,
      sourceMetadata: details.sourceMetadata || null,
      error: details.error ? String(details.error) : null,
      httpStatus: Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : null,
      recordedAtUtc: new Date().toISOString(),
    });
    record.rangeStates = normalizeCacheRangeStates(record.rangeStates);
    if (Array.isArray(record.settledRanges)) {
      record.settledRanges = details.settled === true
        ? addCoveredRange(record.settledRanges, startMs, endMs)
        : removeOverlappingRanges(record.settledRanges, startMs, endMs);
    }
    if (isCoveredCacheState(normalizedState)) {
      record.coveredRanges = addCoveredRange(record.coveredRanges, startMs, endMs);
      nonCoveredProps.forEach(function (prop) {
        record[prop] = removeOverlappingRanges(record[prop], startMs, endMs);
      });
      return record;
    }
    const prop = getNonCoveredRangeProperty(normalizedState);
    if (prop) {
      record.coveredRanges = removeOverlappingRanges(record.coveredRanges, startMs, endMs);
      nonCoveredProps.forEach(function (rangeProp) {
        record[rangeProp] = rangeProp === prop
          ? addCoveredRange(record[rangeProp], startMs, endMs)
          : removeOverlappingRanges(record[rangeProp], startMs, endMs);
      });
    }
    return record;
  }

  function getMissingRangesForRequest(range, coveredRanges) {
    return subtractCoveredIntervals(range, coveredRanges).map(function (segment) {
      return { startMs: segment.startMs, endMs: segment.endMs };
    });
  }

  function getCacheStateDebug(record = {}) {
    const normalized = normalizeCacheRecord(record);
    const ranges = function (values) {
      return normalizeCoveredRanges(values).map(function (segment) {
        return {
          startMs: segment.startMs,
          endMs: segment.endMs,
          startIso: new Date(segment.startMs).toISOString(),
          endIso: new Date(segment.endMs).toISOString(),
        };
      });
    };
    return {
      covered_ranges: ranges(normalized.coveredRanges),
      settled_ranges: ranges(record.settledRanges || []),
      failed_ranges: ranges(normalized.failedRanges),
      partial_ranges: ranges(normalized.partialRanges),
      malformed_ranges: ranges(normalized.malformedRanges),
      unknown_ranges: ranges(normalized.unknownRanges),
      range_states: normalizeCacheRangeStates(normalized.rangeStates).map(function (segment) {
        return {
          ...segment,
          startIso: new Date(segment.startMs).toISOString(),
          endIso: new Date(segment.endMs).toISOString(),
        };
      }),
    };
  }

  function isCacheRecordFresh(record, maxAgeMs, nowMs = Date.now()) {
    const updatedMs = Date.parse(String(record?.updated_at || record?.updatedAt || ""));
    const ageLimitMs = Number(maxAgeMs);
    return Number.isFinite(updatedMs)
      && Number.isFinite(ageLimitMs)
      && ageLimitMs >= 0
      && Number(nowMs) - updatedMs <= ageLimitMs;
  }

  function invalidateMatchingEntries(cache, predicate) {
    if (!cache || typeof cache.forEach !== "function" || typeof cache.delete !== "function") return 0;
    const matches = typeof predicate === "function" ? predicate : function () { return true; };
    const keys = [];
    cache.forEach(function (value, key) {
      if (matches(value, key)) keys.push(key);
    });
    keys.forEach(function (key) { cache.delete(key); });
    return keys.length;
  }

  return {
    CACHE_CONTRACT_VERSION,
    normalizeObservationPoint,
    mergeAqiWithoutReplacement,
    replaceAuthoritativeAqiHead,
    mergeObservationPoints,
    replaceAuthoritativeObservationHead,
    intervalBounds,
    normalizeIntervals,
    subtractCoveredIntervals,
    normalizeCoverageSection,
    recordCoverageInterval,
    getUncoveredRanges,
    getIncompleteRanges,
    nextChunkRange,
    chunkKey,
    buildMissingChunkWorkList,
    createCacheRecord,
    boundedStrings,
    inspectAqiSettlement,
    inspectAqiChunk,
    inspectObservationChunk,
    normalizeCacheRangeState,
    isCoveredCacheState,
    normalizeCoveredRanges,
    addCoveredRange,
    normalizeCacheRangeStates,
    normalizeCacheRecord,
    normalizeSeriesCacheRecord,
    normalizeAqiCacheRecord,
    recordCacheRangeState,
    getMissingRangesForRequest,
    getCacheStateDebug,
    isCacheRecordFresh,
    invalidateMatchingEntries,
  };
});
