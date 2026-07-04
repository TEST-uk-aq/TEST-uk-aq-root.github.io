// timeseries-client.js
// Shared request/response adapter for line-chart timeseries calls.
// Chart rendering remains in chart-core.js and page-specific chart code.
(function () {
  var CACHE_BUSTER_KEYS = new Set(["_t", "timestamp", "cache_bust", "random"]);

  function normalizeIsoTimestamp(value) {
    if (!value) return null;
    var parsed = new Date(String(value));
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  function normalizeWindowLabel(value) {
    var text = String(value || "").trim().toLowerCase();
    return text || null;
  }

  function normalizePollutantKey(value) {
    var text = String(value || "").trim().toLowerCase().replace(/[\s._-]+/g, "");
    if (text === "pm25" || text === "pm10" || text === "no2") {
      return text;
    }
    return null;
  }

  function parseObservationNumericValue(rawValue) {
    if (rawValue === null || rawValue === undefined) return Number.NaN;
    if (typeof rawValue === "string") {
      var trimmed = rawValue.trim();
      if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "nan") {
        return Number.NaN;
      }
      return Number(trimmed);
    }
    return Number(rawValue);
  }

  function parseTimeseriesPayloadPoints(payload) {
    var raw = Array.isArray(payload && payload.data)
      ? payload.data
      : Array.isArray(payload && payload.points)
      ? payload.points
      : [];
    var dataFormat = String((payload && payload.data_format) || "").toLowerCase();
    var columns = Array.isArray(payload && payload.columns) ? payload.columns : [];
    var observedIndex = columns.indexOf("observed_at");
    var valueIndex = columns.indexOf("value");
    return raw.map(function (row) {
      if (dataFormat === "compact" && Array.isArray(row)) {
        return {
          date: new Date(observedIndex >= 0 ? row[observedIndex] : row[0]),
          value: parseObservationNumericValue(valueIndex >= 0 ? row[valueIndex] : row[1]),
        };
      }
      return {
        date: new Date(row && row.observed_at),
        value: parseObservationNumericValue(row && row.value),
      };
    }).filter(function (row) {
      return Number.isFinite(row.date && row.date.getTime()) &&
        Number.isFinite(row.value) &&
        row.value >= 0;
    });
  }

  function normalizeTimeseriesMeta(payload) {
    var meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    var sourceMode = meta.source_mode || payload.source_mode || payload.source || null;
    var r2CoverageEnd = meta.r2_coverage_end || null;
    var ingestTailStart = meta.ingest_tail_start || null;
    var sourceSplitBoundaryUtc = meta.source_split_boundary_utc || payload.source_split_boundary_utc || null;
    var ingestRetentionDays = meta.ingest_retention_days || null;
    var responseComplete = Object.prototype.hasOwnProperty.call(meta, "response_complete") ? meta.response_complete : null;
    var hasGap = Object.prototype.hasOwnProperty.call(meta, "has_gap") ? meta.has_gap : null;
    var cacheStatus = meta.cache_status || null;
    var rowCount = Number(meta.row_count);
    var r2RowCount = Number(meta.r2_row_count);
    var ingestRowCount = Number(meta.ingest_row_count);
    var dedupedRowCount = Number(meta.deduped_row_count);
    var r2Errors = Array.isArray(meta.r2_errors) ? meta.r2_errors : null;
    var ingestErrors = Array.isArray(meta.ingest_errors) ? meta.ingest_errors : null;
    return {
      source_mode: sourceMode,
      r2_coverage_end: r2CoverageEnd,
      ingest_tail_start: ingestTailStart,
      source_split_boundary_utc: sourceSplitBoundaryUtc,
      ingest_retention_days: ingestRetentionDays,
      response_complete: responseComplete,
      has_gap: hasGap,
      cache_status: cacheStatus,
      row_count: Number.isFinite(rowCount) ? rowCount : null,
      r2_row_count: Number.isFinite(r2RowCount) ? r2RowCount : null,
      ingest_row_count: Number.isFinite(ingestRowCount) ? ingestRowCount : null,
      deduped_row_count: Number.isFinite(dedupedRowCount) ? dedupedRowCount : null,
      coverage: meta.coverage || null,
      r2_errors: r2Errors,
      ingest_errors: ingestErrors,
    };
  }

  function buildCanonicalTimeseriesUrl(options) {
    var baseUrl = String((options && options.baseUrl) || "").trim();
    if (!baseUrl) {
      throw new Error("Missing timeseries base URL.");
    }
    var url = new URL(baseUrl);
    CACHE_BUSTER_KEYS.forEach(function (key) {
      url.searchParams.delete(key);
    });

    var timeseriesId = String((options && options.timeseriesId) || "").trim();
    if (!timeseriesId) {
      throw new Error("Missing timeseries_id.");
    }
    url.searchParams.set("timeseries_id", timeseriesId);
    var pollutantKey = normalizePollutantKey(options && options.pollutant);
    if (pollutantKey) {
      url.searchParams.set("pollutant", pollutantKey);
    } else {
      url.searchParams.delete("pollutant");
    }

    var windowLabel = normalizeWindowLabel(options && options.windowLabel);
    var startIso = normalizeIsoTimestamp(options && options.startIso);
    var endIso = normalizeIsoTimestamp(options && options.endIso);
    var since = normalizeIsoTimestamp(options && options.since);

    var hasExplicitRange = Boolean(startIso && endIso);
    var useProxyV2 = Boolean(options && options.proxyV2Enabled);

    // Legacy endpoint mode rejects window+start/end together.
    // Keep window for v2 mode (or when no explicit range is provided).
    if (windowLabel && (!hasExplicitRange || useProxyV2)) {
      url.searchParams.set("window", windowLabel);
    } else {
      url.searchParams.delete("window");
    }

    if (hasExplicitRange) {
      url.searchParams.set("start", startIso);
      url.searchParams.set("end", endIso);
    } else {
      url.searchParams.delete("start");
      url.searchParams.delete("end");
    }

    if (since) {
      url.searchParams.set("since", since);
    } else {
      url.searchParams.delete("since");
    }

    if (useProxyV2) {
      url.searchParams.set("v", "2");
      url.searchParams.set("format", "json");
    } else {
      url.searchParams.delete("v");
      url.searchParams.set("format", String((options && options.format) || "compact"));
    }

    return url;
  }

  window.UkAqTimeseriesClient = {
    buildCanonicalTimeseriesUrl: buildCanonicalTimeseriesUrl,
    parseObservationNumericValue: parseObservationNumericValue,
    parseTimeseriesPayloadPoints: parseTimeseriesPayloadPoints,
    normalizeTimeseriesMeta: normalizeTimeseriesMeta,
  };
})();
