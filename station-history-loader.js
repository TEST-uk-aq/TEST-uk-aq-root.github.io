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
    const date = toDate(row?.period_start_utc || row?.timestamp_hour_utc || row?.observed_at);
    if (!date) return null;
    const daqi = row?.[fields.daqiField];
    const eaqi = row?.[fields.eaqiField];
    if (daqi === null || daqi === undefined) {
      if (eaqi === null || eaqi === undefined) return null;
    }
    return { date, daqi, eaqi };
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
      return key === null || key < startMs || key >= endMs;
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
      aqi_complete: value.aqi_complete === true,
      observations_complete: value.observations_complete === true,
      identity: resolveAuthoritativeIdentity({ identity: value.identity }) || null,
      guideline: value.guideline && typeof value.guideline === "object" ? value.guideline : null,
      updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
    };
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
    normalizeStationIdentity,
    hasPositiveTimeseriesIdentity,
    resolveAuthoritativeIdentity,
    resolveSelectedStationEntries,
    createCacheRecord,
  };
});
