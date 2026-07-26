// station-history-loader.js
// Contract-safe helpers for the progressive station-history chart loader.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.UkAqStationHistoryLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HOUR_MS = 60 * 60 * 1000;

  function toDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function hourKey(value) {
    const date = toDate(value);
    return date ? Math.floor(date.getTime() / HOUR_MS) * HOUR_MS : null;
  }

  function normalizeAqiPoint(row, fields) {
    // date remains the canonical endpoint for identity and cache compatibility.
    // period_start_utc is a temporary legacy endpoint alias until the final
    // API contract correction, so it is deliberately the last AQI fallback.
    const periodEnd = toDate(
      row?.period_end_utc
      || row?.timestamp_hour_utc
      || row?.period_start_utc
      || row?.observed_at,
    );
    if (!periodEnd) return null;
    const daqi = row?.[fields.daqiField];
    const eaqi = row?.[fields.eaqiField];
    if (daqi === null || daqi === undefined) {
      if (eaqi === null || eaqi === undefined) return null;
    }
    return {
      date: periodEnd,
      periodStart: new Date(periodEnd.getTime() - HOUR_MS),
      periodEnd,
      daqi,
      eaqi,
    };
  }

  function normalizeObservationPoint(row) {
    const date = toDate(row?.observed_at || row?.observed_at_utc);
    const value = Number(row?.value ?? row?.value_ugm3 ?? row?.observed_value);
    return date && Number.isFinite(value) && value >= 0 ? { date, value } : null;
  }

  function aqiEquivalent(left, right) {
    return left?.daqi === right?.daqi && left?.eaqi === right?.eaqi;
  }

  // Existing rows are authoritative. This is intentionally not a last-write-wins merge:
  // a history response is not allowed to replace a visible stable-head hour.
  function mergeAqiWithoutReplacement(existingPoints, incomingPoints) {
    const byHour = new Map();
    const conflicts = [];
    (Array.isArray(existingPoints) ? existingPoints : []).forEach(function (point) {
      const key = hourKey(point?.date);
      if (key !== null && !byHour.has(key)) byHour.set(key, point);
    });
    (Array.isArray(incomingPoints) ? incomingPoints : []).forEach(function (point) {
      const key = hourKey(point?.date);
      if (key === null) return;
      const existing = byHour.get(key);
      if (!existing) {
        byHour.set(key, point);
        return;
      }
      if (!aqiEquivalent(existing, point)) {
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

  // A newly fetched station-series head is authoritative for its own interval.
  // This is deliberately separate from history merging: it lets a later chart
  // refresh adopt an updated R2 value while still protecting that new head from
  // any older chunk received during the same load.
  function replaceAuthoritativeAqiHead(existingPoints, headPoints, headStartUtc, headEndUtc) {
    const startMs = Date.parse(String(headStartUtc || ""));
    const endMs = Date.parse(String(headEndUtc || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return mergeAqiWithoutReplacement(existingPoints, headPoints);
    }
    const retained = (Array.isArray(existingPoints) ? existingPoints : []).filter(function (point) {
      const key = hourKey(point?.date);
      // AQI request bounds are represented intervals: S < endpoint <= E.
      // An endpoint exactly at S belongs to the preceding older interval.
      return key === null || key <= startMs || key > endMs;
    });
    return mergeAqiWithoutReplacement(retained, headPoints);
  }

  function mergeObservationPoints(existingPoints, incomingPoints) {
    const byTimestamp = new Map();
    (Array.isArray(existingPoints) ? existingPoints : []).forEach(function (point) {
      const date = toDate(point?.date);
      if (date) byTimestamp.set(date.getTime(), point);
    });
    (Array.isArray(incomingPoints) ? incomingPoints : []).forEach(function (point) {
      const date = toDate(point?.date);
      if (date) byTimestamp.set(date.getTime(), point);
    });
    return Array.from(byTimestamp.values()).sort(function (left, right) {
      return left.date.getTime() - right.date.getTime();
    });
  }

  // A fresh station-series observation response is authoritative for its
  // output interval. Replacing that interval (rather than only deduping it)
  // ensures a newly reported gap is visible instead of being hidden by an
  // older cached point at the same timestamp.
  function replaceAuthoritativeObservationHead(existingPoints, headPoints, headStartUtc, headEndUtc) {
    const startMs = Date.parse(String(headStartUtc || ""));
    const endMs = Date.parse(String(headEndUtc || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return mergeObservationPoints(existingPoints, headPoints);
    }
    const retained = (Array.isArray(existingPoints) ? existingPoints : []).filter(function (point) {
      const date = toDate(point?.date);
      const timestampMs = date?.getTime();
      return !Number.isFinite(timestampMs) || timestampMs < startMs || timestampMs >= endMs;
    });
    return mergeObservationPoints(retained, headPoints);
  }

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

  function nextChunkRange(rangeStartUtc, cursorEndUtc, spanMs) {
    const rangeStartMs = Date.parse(String(rangeStartUtc || ""));
    const cursorEndMs = Date.parse(String(cursorEndUtc || ""));
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(cursorEndMs) || cursorEndMs <= rangeStartMs) {
      return null;
    }
    const safeSpanMs = Number.isFinite(spanMs) && spanMs > 0 ? spanMs : HOUR_MS;
    const startMs = Math.max(rangeStartMs, cursorEndMs - safeSpanMs);
    return {
      start_utc: new Date(startMs).toISOString(),
      end_utc: new Date(cursorEndMs).toISOString(),
    };
  }

  function chunkKey(kind, range) {
    return `${kind}:${range?.start_utc || ""}:${range?.end_utc || ""}`;
  }

  function intervalBounds(range) {
    const startMs = Number.isFinite(Number(range?.startMs))
      ? Number(range.startMs)
      : Date.parse(String(range?.start_utc || range?.startUtc || ""));
    const endMs = Number.isFinite(Number(range?.endMs))
      ? Number(range.endMs)
      : Date.parse(String(range?.end_utc || range?.endUtc || ""));
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? { startMs, endMs }
      : null;
  }

  function normalizeIntervals(intervals) {
    const sorted = (Array.isArray(intervals) ? intervals : [])
      .map(intervalBounds)
      .filter(Boolean)
      .sort(function (left, right) { return left.startMs - right.startMs || left.endMs - right.endMs; });
    const merged = [];
    sorted.forEach(function (interval) {
      const tail = merged[merged.length - 1];
      if (tail && interval.startMs <= tail.endMs) {
        tail.endMs = Math.max(tail.endMs, interval.endMs);
      } else {
        merged.push({ ...interval });
      }
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
      interval_states: (Array.isArray(value.interval_states) ? value.interval_states : [])
        .map(function (entry) {
          const bounds = intervalBounds(entry);
          return bounds ? {
            ...bounds,
            state: ["complete", "partial", "failed", "stale"].includes(entry?.state) ? entry.state : "failed",
            partial_reasons: Array.isArray(entry?.partial_reasons) ? entry.partial_reasons.map(String) : [],
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

  function recordCoverageInterval(record, kind, range, state, details) {
    const bounds = intervalBounds(range);
    if (!record || !["aqi", "observations"].includes(kind) || !bounds) return record;
    const section = coverageSection(record, kind);
    section.interval_states = section.interval_states.flatMap(function (entry) {
      if (entry.endMs <= bounds.startMs || entry.startMs >= bounds.endMs) return [entry];
      const retained = [];
      if (entry.startMs < bounds.startMs) retained.push({ ...entry, endMs: bounds.startMs });
      if (entry.endMs > bounds.endMs) retained.push({ ...entry, startMs: bounds.endMs });
      return retained;
    });
    section.interval_states.push({
      ...bounds,
      state: ["complete", "partial", "failed", "stale"].includes(state) ? state : "failed",
      partial_reasons: Array.isArray(details?.partial_reasons) ? details.partial_reasons.map(String) : [],
      recorded_at_utc: new Date().toISOString(),
    });
    section.interval_states.sort(function (left, right) {
      return left.startMs - right.startMs || left.endMs - right.endMs;
    });
    if (state === "complete") {
      section.covered_intervals = normalizeIntervals([...section.covered_intervals, bounds]);
    } else {
      section.covered_intervals = section.covered_intervals.flatMap(function (covered) {
        if (covered.endMs <= bounds.startMs || covered.startMs >= bounds.endMs) return [covered];
        const retained = [];
        if (covered.startMs < bounds.startMs) retained.push({ startMs: covered.startMs, endMs: bounds.startMs });
        if (covered.endMs > bounds.endMs) retained.push({ startMs: bounds.endMs, endMs: covered.endMs });
        return retained;
      });
    }
    return record;
  }

  function getUncoveredRanges(record, kind, range) {
    const section = coverageSection(record, kind);
    return subtractCoveredIntervals(range, section.covered_intervals);
  }

  function buildMissingChunkWorkList(record, kind, rangeStartUtc, initialCursorEndUtc, spanMs) {
    const work = [];
    let cursorEndUtc = initialCursorEndUtc;
    while (cursorEndUtc) {
      const chunk = nextChunkRange(rangeStartUtc, cursorEndUtc, spanMs);
      if (!chunk) break;
      getUncoveredRanges(record, kind, chunk).forEach(function (requestRange) {
        work.push({
          kind,
          range: requestRange,
          key: chunkKey(kind, requestRange),
          sequence: work.length,
        });
      });
      cursorEndUtc = chunk.start_utc;
    }
    return work;
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
      flush() {
        return commitChain;
      },
      get next_sequence() {
        return nextSequence;
      },
      get pending_count() {
        return pending.size;
      },
    };
  }

  function normalizeStationIdentity(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function positiveInteger(value) {
    const text = String(value ?? "").trim();
    return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
  }

  function normalizePollutant(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s._-]+/g, "");
    return ["pm25", "pm10", "no2"].includes(normalized) ? normalized : null;
  }

  function hasPositiveTimeseriesIdentity(entry) {
    return positiveInteger(entry?.timeseriesId ?? entry?.timeseries_id) !== null;
  }

  function resolveAuthoritativeIdentity(payload, expected = {}) {
    const source = payload?.identity && typeof payload.identity === "object"
      ? payload.identity
      : payload?.request;
    const timeseriesId = positiveInteger(source?.timeseries_id);
    const connectorId = positiveInteger(source?.connector_id);
    const stationId = positiveInteger(source?.station_id);
    const pollutant = normalizePollutant(source?.pollutant ?? source?.pollutant_code);
    const expectedTimeseriesId = positiveInteger(expected.timeseriesId ?? expected.timeseries_id);
    const expectedPollutant = normalizePollutant(expected.pollutant);
    if (!timeseriesId || !connectorId || !stationId || !pollutant) return null;
    if (expectedTimeseriesId && timeseriesId !== expectedTimeseriesId) return null;
    if (expectedPollutant && pollutant !== expectedPollutant) return null;
    return {
      source: String(source?.source || "authoritative_timeseries_lookup"),
      timeseries_id: timeseriesId,
      connector_id: connectorId,
      station_id: stationId,
      pollutant,
    };
  }

  function stationEntryMap(entries) {
    const byStationId = new Map();
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      const stationId = normalizeStationIdentity(entry?.stationId ?? entry?.station_id);
      if (stationId && !byStationId.has(stationId)) byStationId.set(stationId, entry);
    });
    return byStationId;
  }

  // The active table is only a view. A selected chart entry must continue to
  // resolve from its retained selected-series snapshot after a filter refresh
  // removes it from that view. Visible entries win when available so fresh
  // identity metadata is used without changing selected order.
  function resolveSelectedStationEntries(selectedIds, visibleEntries, retainedEntries) {
    const visibleByStationId = stationEntryMap(visibleEntries);
    const retainedByStationId = retainedEntries instanceof Map
      ? retainedEntries
      : stationEntryMap(retainedEntries);
    const entries = [];
    const unresolvedIds = [];
    const seen = new Set();
    (Array.isArray(selectedIds) ? selectedIds : []).forEach(function (selectedId) {
      const stationId = normalizeStationIdentity(selectedId);
      if (!stationId || seen.has(stationId)) return;
      seen.add(stationId);
      const entry = visibleByStationId.get(stationId) || retainedByStationId.get(stationId);
      if (entry) entries.push(entry);
      else unresolvedIds.push(stationId);
    });
    return { entries, unresolvedIds };
  }

  function createCacheRecord(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    return {
      contract_version: "station-history-v1",
      aqi_points: Array.isArray(value.aqi_points) ? value.aqi_points : [],
      observation_points: Array.isArray(value.observation_points) ? value.observation_points : [],
      completed_chunks: value.completed_chunks && typeof value.completed_chunks === "object"
        ? value.completed_chunks
        : {},
      failed_chunks: value.failed_chunks && typeof value.failed_chunks === "object"
        ? value.failed_chunks
        : {},
      coverage: {
        aqi: normalizeCoverageSection(value.coverage?.aqi),
        observations: normalizeCoverageSection(value.coverage?.observations),
      },
      aqi_complete: value.aqi_complete === true,
      observations_complete: value.observations_complete === true,
      identity: resolveAuthoritativeIdentity({ identity: value.identity }) || null,
      guideline: value.guideline && typeof value.guideline === "object" ? value.guideline : null,
      updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
    };
  }

  function inspectObservationChunk(payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const complete = payload?.response_complete === true && payload?.has_gap !== true;
    return {
      rows,
      complete,
      retryable: !complete,
      partial_reasons: Array.isArray(payload?.partial_reasons) ? payload.partial_reasons.map(String) : [],
    };
  }

  function inspectAqiChunk(payload) {
    const rows = Array.isArray(payload?.points) ? payload.points : [];
    const complete = payload?.response_complete === true && payload?.has_gap !== true;
    return {
      rows,
      complete,
      retryable: !complete,
      partial_reasons: Array.isArray(payload?.partial_reasons) ? payload.partial_reasons.map(String) : [],
    };
  }

  function resolveStationSeriesHeadBounds(payload, kind, fallbackRange) {
    const section = kind === "aqi" ? payload?.aqi : payload?.observations;
    const startUtc = String(section?.stable_head_start_utc || fallbackRange?.startIso || "").trim();
    const endUtc = String(section?.stable_head_end_utc || fallbackRange?.endIso || "").trim();
    const startMs = Date.parse(startUtc);
    const endMs = Date.parse(endUtc);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? { startUtc: new Date(startMs).toISOString(), endUtc: new Date(endMs).toISOString() }
      : null;
  }

  return {
    HOUR_MS,
    normalizeAqiPoint,
    normalizeObservationPoint,
    mergeAqiWithoutReplacement,
    replaceAuthoritativeAqiHead,
    mergeObservationPoints,
    replaceAuthoritativeObservationHead,
    isOlderChunk,
    nextChunkRange,
    chunkKey,
    normalizeIntervals,
    subtractCoveredIntervals,
    recordCoverageInterval,
    getUncoveredRanges,
    buildMissingChunkWorkList,
    createOrderedSettlementBuffer,
    normalizeStationIdentity,
    hasPositiveTimeseriesIdentity,
    resolveAuthoritativeIdentity,
    resolveSelectedStationEntries,
    createCacheRecord,
    inspectAqiChunk,
    inspectObservationChunk,
    resolveStationSeriesHeadBounds,
  };
});
