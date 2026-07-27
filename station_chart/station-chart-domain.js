// Shared pure domain helpers for UK AQ station charts.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqStationChartDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HOUR_MS = 60 * 60 * 1000;
  const LOAD_REASONS = new Set([
    "initial",
    "sensor-change",
    "aqi-source-change",
    "window-change",
    "refresh",
    "resize",
  ]);

  function toDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function hourKey(value) {
    const date = toDate(value);
    return date ? Math.floor(date.getTime() / HOUR_MS) * HOUR_MS : null;
  }

  function canonicalAqiHourEndpoint(row) {
    return toDate(
      row?.period_end_utc
      || row?.timestamp_hour_utc
      || row?.period_start_utc
      || row?.observed_at,
    );
  }

  function normalizeAqiPoint(row, fields = {}) {
    const periodEnd = canonicalAqiHourEndpoint(row);
    if (!periodEnd) return null;
    const daqi = row?.[fields.daqiField];
    const eaqi = row?.[fields.eaqiField];
    if ((daqi === null || daqi === undefined) && (eaqi === null || eaqi === undefined)) return null;
    return {
      date: periodEnd,
      periodStart: new Date(periodEnd.getTime() - HOUR_MS),
      periodEnd,
      daqi,
      eaqi,
    };
  }

  function normalizeStationIdentity(value) {
    return value === null || value === undefined ? "" : String(value).trim();
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

  function rangeBounds(value) {
    const startMs = Number.isFinite(Number(value?.startMs))
      ? Number(value.startMs)
      : Date.parse(String(value?.startIso || value?.start_utc || value?.startUtc || ""));
    const endMs = Number.isFinite(Number(value?.endMs))
      ? Number(value.endMs)
      : Date.parse(String(value?.endIso || value?.end_utc || value?.endUtc || ""));
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? { startMs, endMs }
      : null;
  }

  function snapshotChartRange(value) {
    const bounds = rangeBounds(value);
    if (!bounds) return null;
    return Object.freeze({
      startMs: bounds.startMs,
      endMs: bounds.endMs,
      startDate: new Date(bounds.startMs),
      endDate: new Date(bounds.endMs),
      startIso: new Date(bounds.startMs).toISOString(),
      endIso: new Date(bounds.endMs).toISOString(),
      start_utc: new Date(bounds.startMs).toISOString(),
      end_utc: new Date(bounds.endMs).toISOString(),
    });
  }

  function normalizeCacheKeyPart(value) {
    const text = String(value ?? "").trim();
    return (text || "null").replace(/\|/g, "_");
  }

  function buildSensorCacheKey(identity, options = {}) {
    const timeseriesId = positiveInteger(identity?.timeseriesId ?? identity?.timeseries_id);
    const connectorId = positiveInteger(identity?.connectorId ?? identity?.connector_id);
    const pollutant = normalizePollutant(identity?.pollutant ?? identity?.pollutant_code);
    if (!timeseriesId || !pollutant) return "";
    const prefix = normalizeCacheKeyPart(options.prefix || "station-chart");
    const contract = normalizeCacheKeyPart(options.contract || "v1");
    return `${prefix}|${contract}|timeseries:${timeseriesId}|connector:${connectorId || "unknown"}|pollutant:${pollutant}`;
  }

  function buildObservationCacheKey(identity) {
    const timeseriesId = identity?.timeseriesId ?? identity?.timeseries_id;
    if (!timeseriesId) return "";
    return `${normalizeCacheKeyPart(timeseriesId)}|connector:${normalizeCacheKeyPart(identity?.connectorId ?? identity?.connector_id)}|pollutant:${normalizeCacheKeyPart(identity?.pollutant || "unknown")}`;
  }

  function buildAqiCacheKey(identity) {
    const timeseriesId = identity?.timeseriesId ?? identity?.timeseries_id;
    if (!timeseriesId || !identity?.pollutant) return "";
    return `${normalizeCacheKeyPart(timeseriesId)}|station:${normalizeCacheKeyPart(identity?.stationId ?? identity?.station_id)}|connector:${normalizeCacheKeyPart(identity?.connectorId ?? identity?.connector_id)}|pollutant:${normalizeCacheKeyPart(identity.pollutant)}`;
  }

  function buildStationHistoryCacheKey(identity, contract) {
    const timeseriesId = identity?.timeseriesId ?? identity?.timeseries_id;
    if (!timeseriesId) return "";
    return `${String(contract || "station-history")}|timeseries:${normalizeCacheKeyPart(timeseriesId)}|connector:${normalizeCacheKeyPart(identity?.connectorId ?? identity?.connector_id ?? "unknown")}|pollutant:${normalizeCacheKeyPart(identity?.pollutant || "unknown")}`;
  }

  function normalizeLoadReason(value, fallback = "initial") {
    const reason = String(value || "").trim().toLowerCase();
    return LOAD_REASONS.has(reason) ? reason : fallback;
  }

  function createGenerationTracker(initialValue = 0) {
    let current = Number.isFinite(Number(initialValue)) ? Number(initialValue) : 0;
    return {
      next() { current += 1; return current; },
      invalidate() { current += 1; return current; },
      isCurrent(value) { return Number(value) === current; },
      get current() { return current; },
    };
  }

  function classifyTerminalRequestOutcome(options = {}) {
    const settlement = options.settlement && typeof options.settlement === "object"
      ? options.settlement
      : null;
    const ignored = options.obsolete === true || options.aborted === true;
    let hardFailure = false;
    let failureReason = null;
    if (!ignored) {
      if (options.error) {
        hardFailure = true;
        failureReason = options.error instanceof Error
          ? options.error.message || "aqi_source_request_failed"
          : String(options.error || "aqi_source_request_failed");
      } else if (options.identity_valid === false) {
        hardFailure = true;
        failureReason = "station_series_authoritative_identity_invalid";
      } else if (Number(options.conflict_count) > 0) {
        hardFailure = true;
        failureReason = "aqi_replacement_contract_error";
      } else if (settlement?.actual_failure === true) {
        hardFailure = true;
        failureReason = settlement.failure_reason || "aqi_response_contract_error";
      }
    }
    const settled = !ignored && !hardFailure && settlement?.settled === true;
    return {
      settled,
      retryable: !ignored && !settled,
      retryable_incomplete: !ignored && !hardFailure && !settled,
      actual_failure: hardFailure,
      hard_failure: hardFailure,
      failure_reason: failureReason,
      ignored,
      settlement: hardFailure
        ? "hard_failure"
        : ignored
          ? "ignored"
          : settlement?.complete === true
            ? "complete"
            : settlement?.settled === true
              ? "settled_partial"
              : "retryable",
      partial_reasons: Array.isArray(settlement?.partial_reasons) ? settlement.partial_reasons : [],
      calculation_statuses: Array.isArray(settlement?.calculation_statuses) ? settlement.calculation_statuses : [],
      missing_reasons: Array.isArray(settlement?.missing_reasons) ? settlement.missing_reasons : [],
    };
  }

  return {
    HOUR_MS,
    toDate,
    hourKey,
    canonicalAqiHourEndpoint,
    normalizeAqiPoint,
    normalizeStationIdentity,
    positiveInteger,
    normalizePollutant,
    hasPositiveTimeseriesIdentity,
    resolveAuthoritativeIdentity,
    resolveSelectedStationEntries,
    rangeBounds,
    snapshotChartRange,
    normalizeCacheKeyPart,
    buildSensorCacheKey,
    buildObservationCacheKey,
    buildAqiCacheKey,
    buildStationHistoryCacheKey,
    normalizeLoadReason,
    createGenerationTracker,
    classifyTerminalRequestOutcome,
  };
});
