// Retained stored-AQI/legacy-timeseries client behind the shared chart-client interface.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("./station-chart-domain.js") : null);
  const timeseries = root.UkAqTimeseriesClient
    || (typeof module === "object" && module.exports ? require("./timeseries-client.js") : null);
  const api = factory(domain, timeseries);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqCompatibilityStationHistoryClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain, timeseries) {
  "use strict";

  if (!domain || !timeseries) throw new Error("Shared station-chart domain and timeseries modules are required");

  const DEFAULT_MAX_ATTEMPTS = 3;
  const DEFAULT_RETRY_BASE_MS = 1000;
  const DEFAULT_RETRY_CAP_MS = 8000;
  const DEFAULT_AQI_ROW_LIMIT = 20000;

  function normalizeRequest(request) {
    const range = domain.snapshotChartRange({
      start_utc: request?.start_utc,
      end_utc: request?.end_utc,
    });
    const timeseriesId = domain.positiveInteger(request?.timeseries_id);
    const connectorId = domain.positiveInteger(request?.connector_id);
    const stationId = domain.positiveInteger(request?.station_id);
    const pollutant = domain.normalizePollutant(request?.pollutant);
    if (!range || !timeseriesId || !connectorId || !pollutant) {
      throw new Error("station_history_request_identity_missing");
    }
    return Object.freeze({
      ...request,
      timeseries_id: timeseriesId,
      connector_id: connectorId,
      station_id: stationId,
      pollutant,
      start_utc: range.startIso,
      end_utc: range.endIso,
    });
  }

  function normalizeParts(request, parts) {
    const source = parts && typeof parts === "object" ? parts : {};
    return Object.freeze({
      observations: source.observations === true || source.include_observations === true
        || (source.observations === undefined && request?.include_observations === true),
      aqi: source.aqi === true || source.include_aqi === true
        || (source.aqi === undefined && request?.include_aqi === true),
    });
  }

  function buildObservationUrl(baseUrl, request, options) {
    return timeseries.buildCanonicalTimeseriesUrl({
      baseUrl,
      timeseriesId: request.timeseries_id,
      pollutant: request.pollutant,
      windowLabel: request.window,
      startIso: request.start_utc,
      endIso: request.end_utc,
      proxyV2Enabled: options.proxyV2Enabled !== false,
      format: "compact",
    });
  }

  function buildAqiUrls(baseUrls, request, rowLimit) {
    const seen = new Set();
    return baseUrls.map(function (baseUrl) {
      try {
        const url = new URL(baseUrl);
        url.searchParams.set("scope", "timeseries");
        url.searchParams.set("grain", "hourly");
        url.searchParams.set("timeseries_id", String(request.timeseries_id));
        url.searchParams.set("entity", String(request.timeseries_id));
        url.searchParams.set("pollutant", request.pollutant);
        url.searchParams.set("row_limit", String(rowLimit));
        url.searchParams.set("from_utc", request.start_utc);
        url.searchParams.set("to_utc", request.end_utc);
        const value = url.toString();
        if (seen.has(value)) return null;
        seen.add(value);
        return url;
      } catch (_error) {
        return null;
      }
    }).filter(Boolean);
  }

  function parseDelimitedText(value) {
    const text = String(value || "").replace(/^\uFEFF/, "").trim();
    if (!text) return { points: [] };
    if (text.startsWith("{") || text.startsWith("[")) {
      try { return JSON.parse(text); } catch (_error) { /* Try delimited text. */ }
    }
    const lines = text.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return { points: [] };
    const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;
    if (!delimiter) return { points: [], malformed: true };
    const columns = lines[0].split(delimiter).map(function (column) { return column.trim(); });
    const rows = lines.slice(1).map(function (line) {
      const cells = line.split(delimiter);
      return columns.reduce(function (row, column, index) {
        row[column] = index < cells.length ? cells[index].trim() : "";
        return row;
      }, {});
    });
    return { rows, columns, data_format: "objects" };
  }

  function rowsFromPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.points)) return payload.points;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.result?.points)) return payload.result.points;
    return [];
  }

  function getCompactField(row, columns, field) {
    if (!Array.isArray(row)) return row?.[field];
    const index = columns.indexOf(field);
    return index >= 0 ? row[index] : undefined;
  }

  function storedAqiFields(pollutant) {
    if (pollutant === "pm25") return {
      daqi: "daqi_pm25_rolling24h_index_level",
      eaqi: "eaqi_pm25_index_level",
    };
    if (pollutant === "pm10") return {
      daqi: "daqi_pm10_rolling24h_index_level",
      eaqi: "eaqi_pm10_index_level",
    };
    if (pollutant === "no2") return {
      daqi: "daqi_no2_index_level",
      eaqi: "eaqi_no2_index_level",
    };
    return null;
  }

  function parseAqiPoints(payload, pollutant) {
    const columns = Array.isArray(payload?.columns) ? payload.columns : [];
    const stored = storedAqiFields(pollutant);
    return rowsFromPayload(payload).map(function (row) {
      const endpoint = getCompactField(row, columns, "period_end_utc")
        ?? getCompactField(row, columns, "timestamp_hour_utc")
        ?? getCompactField(row, columns, "period_start_utc")
        ?? getCompactField(row, columns, "observed_at")
        ?? (Array.isArray(row) ? row[0] : null);
      const periodEnd = domain.toDate(endpoint);
      if (!periodEnd) return null;
      const daqi = getCompactField(row, columns, "daqi_index_level")
        ?? (stored ? getCompactField(row, columns, stored.daqi) : null);
      const eaqi = getCompactField(row, columns, "eaqi_index_level")
        ?? (stored ? getCompactField(row, columns, stored.eaqi) : null);
      return {
        date: periodEnd,
        periodStart: new Date(periodEnd.getTime() - domain.HOUR_MS),
        periodEnd,
        daqi: daqi === "" || daqi === undefined ? null : daqi,
        eaqi: eaqi === "" || eaqi === undefined ? null : eaqi,
        daqi_calculation_status: String(getCompactField(row, columns, "daqi_calculation_status") || "").trim() || null,
        eaqi_calculation_status: String(getCompactField(row, columns, "eaqi_calculation_status") || "").trim() || null,
        daqi_missing_reason: String(getCompactField(row, columns, "daqi_missing_reason") || "").trim() || null,
        eaqi_missing_reason: String(getCompactField(row, columns, "eaqi_missing_reason") || "").trim() || null,
      };
    }).filter(Boolean).sort(function (left, right) {
      return left.date.getTime() - right.date.getTime();
    });
  }

  function responseMeta(payload) {
    const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
    return {
      ...meta,
      response_complete: payload?.response_complete ?? meta.response_complete ?? null,
      has_gap: payload?.has_gap ?? meta.has_gap ?? null,
      partial_reasons: payload?.partial_reasons ?? meta.partial_reasons ?? null,
      calculation_source: payload?.calculation_source ?? meta.calculation_source ?? "stored_aqi_compatibility",
      timeseries_id: payload?.timeseries_id ?? meta.timeseries_id ?? null,
      station_id: payload?.station_id ?? meta.station_id ?? null,
      connector_id: payload?.connector_id ?? meta.connector_id ?? null,
      pollutant: payload?.pollutant ?? meta.pollutant ?? null,
    };
  }

  function metadataMatches(request, meta) {
    const pairs = [
      [request.timeseries_id, meta?.timeseries_id],
      [request.connector_id, meta?.connector_id],
      [request.station_id, meta?.station_id],
      [request.pollutant, domain.normalizePollutant(meta?.pollutant)],
    ];
    return pairs.every(function (pair) {
      return pair[0] === null || pair[0] === undefined || pair[1] === null || pair[1] === undefined
        || String(pair[0]) === String(pair[1]);
    });
  }

  function createCompatibilityStationHistoryClient(options = {}) {
    const observationBaseUrl = String(options.observationUrl || "").trim();
    const aqiBaseUrls = (Array.isArray(options.aqiHistoryUrls) ? options.aqiHistoryUrls : [options.aqiHistoryUrl])
      .map(function (value) { return String(value || "").trim(); })
      .filter(Boolean);
    const fetchApi = typeof options.fetchApi === "function"
      ? options.fetchApi
      : typeof fetch === "function" ? fetch.bind(globalThis) : null;
    const scheduler = options.scheduler || null;
    const maxAttempts = Math.max(1, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
    const rowLimit = Math.max(1, Number(options.rowLimit) || DEFAULT_AQI_ROW_LIMIT);
    if (!observationBaseUrl || !aqiBaseUrls.length || !fetchApi) {
      throw new Error("compatibility_station_history_client_configuration_missing");
    }

    function schedule(priority, task, signal) {
      return scheduler?.schedule ? scheduler.schedule(priority, task, signal) : task();
    }

    async function fetchObservations(request, signal, priority) {
      const url = buildObservationUrl(observationBaseUrl, request, options);
      const response = await schedule(priority, function () {
        return fetchApi(url.toString(), { credentials: "include", headers: { Accept: "application/json" }, signal });
      }, signal);
      if (!response?.ok) {
        const body = await response?.text?.().catch(function () { return ""; }) || "";
        const error = new Error(`Chart request failed: ${response?.status || "unknown"}`);
        error.ukAqHttpStatus = response?.status || null;
        options.onRequestFailure?.({ kind: "observations", url: url.toString(), request, response, body, error });
        throw error;
      }
      const payload = await response.json();
      const points = timeseries.parseTimeseriesPayloadPoints(payload);
      return { ...payload, enabled: true, rows: rowsFromPayload(payload), points };
    }

    function retryDelay(attempt) {
      return Math.min(
        (Number(options.retryBaseMs) || DEFAULT_RETRY_BASE_MS) * (2 ** Math.max(0, attempt - 1)),
        Number(options.retryCapMs) || DEFAULT_RETRY_CAP_MS,
      );
    }

    function delay(ms, signal) {
      if (typeof options.delay === "function") return options.delay(ms, signal);
      return new Promise(function (resolve, reject) {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", function () {
          clearTimeout(timer);
          const error = new Error("Station-history request aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }

    async function fetchAqi(request, signal, priority) {
      const candidates = buildAqiUrls(aqiBaseUrls, request, rowLimit);
      let lastError = null;
      for (const url of candidates) {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const response = await schedule(priority, function () {
              return fetchApi(url.toString(), { credentials: "include", headers: { Accept: "application/json" }, signal });
            }, signal);
            const body = await response.text();
            if (!response.ok) {
              const error = new Error(`Chart request failed: ${response.status}`);
              error.ukAqHttpStatus = response.status;
              throw error;
            }
            const payload = parseDelimitedText(body);
            if (payload?.malformed === true) throw new Error("aqi_history_response_malformed");
            const points = parseAqiPoints(payload, request.pollutant);
            const meta = responseMeta(payload);
            return {
              ...payload,
              ...meta,
              enabled: true,
              rows: rowsFromPayload(payload),
              points,
              identity_valid: metadataMatches(request, meta),
            };
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            lastError = error;
            const status = Number(error?.ukAqHttpStatus);
            const retryable = (!Number.isFinite(status) || status === 408 || status === 429 || status >= 500)
              && attempt < maxAttempts;
            options.onRequestFailure?.({ kind: "aqi", url: url.toString(), request, attempt, retryable, error });
            if (!retryable) break;
            await delay(retryDelay(attempt), signal);
          }
        }
      }
      throw lastError || new Error("AQI history request failed.");
    }

    async function load(rawRequest, rawParts, signal, mode) {
      const request = normalizeRequest(rawRequest);
      const parts = normalizeParts(request, rawParts);
      const observationPromise = parts.observations
        ? fetchObservations(request, signal, Number(rawParts?.priority ?? options.priorities?.observations ?? 0))
        : Promise.resolve({ enabled: false, rows: [], points: [] });
      const aqiPromise = parts.aqi
        ? fetchAqi(request, signal, Number(rawParts?.priority ?? options.priorities?.aqi ?? 0))
        : Promise.resolve({ enabled: false, rows: [], points: [] });
      const settled = await Promise.allSettled([observationPromise, aqiPromise]);
      if (settled[0].status === "rejected") throw settled[0].reason;
      const aqi = settled[1].status === "fulfilled"
        ? settled[1].value
        : { enabled: true, rows: [], points: [], error: settled[1].reason, identity_valid: false };
      const identityValid = metadataMatches(request, responseMeta(settled[0].value))
        && (aqi.identity_valid !== false || Boolean(aqi.error));
      return Object.freeze({
        result_version: "station-history-browser-v1",
        source: "compatibility",
        mode,
        request,
        identity: {
          source: "compatibility_request_identity",
          timeseries_id: request.timeseries_id,
          connector_id: request.connector_id,
          station_id: request.station_id,
          pollutant: request.pollutant,
        },
        identity_valid: identityValid,
        observations: Object.freeze(settled[0].value),
        aqi: Object.freeze(aqi),
        chunk: null,
        schema_version: null,
        raw: Object.freeze({ observations: settled[0].value, aqi }),
      });
    }

    return Object.freeze({
      kind: "compatibility",
      loadCurrent: function (request, parts, signal) { return load(request, parts, signal, "current"); },
      loadOlder: function (request, parts, signal) { return load(request, parts, signal, "older"); },
      prefetchAqi: function (request, signal) {
        return load({ ...request, include_observations: false, include_aqi: true }, {
          observations: false,
          aqi: true,
          priority: Number(options.priorities?.prefetch ?? 2),
        }, signal);
      },
      buildObservationUrl: function (request) {
        return buildObservationUrl(observationBaseUrl, normalizeRequest(request), options);
      },
      buildAqiUrls: function (request) {
        return buildAqiUrls(aqiBaseUrls, normalizeRequest(request), rowLimit);
      },
    });
  }

  return {
    createCompatibilityStationHistoryClient,
    normalizeRequest,
    normalizeParts,
    parseDelimitedText,
    parseAqiPoints,
    storedAqiFields,
  };
});
