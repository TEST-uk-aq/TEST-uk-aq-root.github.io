// Calculated station-history data client.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("./station-chart-domain.js") : null);
  const cache = root.UkAqStationChartCache
    || (typeof module === "object" && module.exports ? require("./station-chart-cache.js") : null);
  const api = factory(domain, cache);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqCalculatedStationHistoryClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain, cache) {
  "use strict";

  if (!domain || !cache) throw new Error("Shared station-chart domain and cache modules are required");

  function normalizeParts(request, parts) {
    const source = parts && typeof parts === "object" ? parts : {};
    return Object.freeze({
      observations: source.observations === true || source.include_observations === true
        || (source.observations === undefined && request?.include_observations === true),
      aqi: source.aqi === true || source.include_aqi === true
        || (source.aqi === undefined && request?.include_aqi === true),
    });
  }

  function normalizeRequest(request) {
    const range = domain.snapshotChartRange({
      start_utc: request?.start_utc,
      end_utc: request?.end_utc,
    });
    const timeseriesId = domain.positiveInteger(request?.timeseries_id);
    const connectorId = domain.positiveInteger(request?.connector_id);
    const pollutant = domain.normalizePollutant(request?.pollutant);
    if (!range || !timeseriesId || !connectorId || !pollutant) {
      throw new Error("station_history_request_identity_missing");
    }
    return Object.freeze({
      ...request,
      timeseries_id: timeseriesId,
      connector_id: connectorId,
      pollutant,
      start_utc: range.startIso,
      end_utc: range.endIso,
    });
  }

  function appendCommonQuery(url, request, parts) {
    url.searchParams.set("timeseries_id", String(request.timeseries_id));
    url.searchParams.set("connector_id", String(request.connector_id));
    url.searchParams.set("pollutant", request.pollutant);
    url.searchParams.set("start_utc", request.start_utc);
    url.searchParams.set("end_utc", request.end_utc);
    url.searchParams.set("format", "objects");
    url.searchParams.set("include_observations", parts.observations ? "true" : "false");
    url.searchParams.set("include_aqi", parts.aqi ? "true" : "false");
    return url;
  }

  function buildCurrentUrl(baseUrl, request, parts) {
    const url = appendCommonQuery(new URL(baseUrl), request, parts);
    if (request.window) url.searchParams.set("window", String(request.window));
    return url;
  }

  function buildOlderUrl(baseUrl, request, parts) {
    const stableHeadStartUtc = domain.toDate(request.stable_head_start_utc)?.toISOString();
    if (!stableHeadStartUtc) throw new Error("station_history_stable_head_boundary_missing");
    const url = appendCommonQuery(new URL(baseUrl), request, parts);
    url.searchParams.set("stable_head_start_utc", stableHeadStartUtc);
    url.searchParams.set("limit", String(domain.positiveInteger(request.limit) || 5000));
    return url;
  }

  function rowsFromSection(section) {
    if (Array.isArray(section?.rows)) return section.rows;
    if (Array.isArray(section?.points)) return section.points;
    if (Array.isArray(section?.data)) return section.data;
    return [];
  }

  function parseAqiRows(rows) {
    return rows.map(function (row) {
      const point = domain.normalizeAqiPoint(row, {
        daqiField: "daqi_index_level",
        eaqiField: "eaqi_index_level",
      });
      return point ? {
        ...point,
        daqi_calculation_status: String(row?.daqi_calculation_status || "").trim() || null,
        eaqi_calculation_status: String(row?.eaqi_calculation_status || "").trim() || null,
        daqi_missing_reason: String(row?.daqi_missing_reason || "").trim() || null,
        eaqi_missing_reason: String(row?.eaqi_missing_reason || "").trim() || null,
      } : null;
    }).filter(Boolean).sort(function (left, right) {
      return left.date.getTime() - right.date.getTime();
    });
  }

  function parseObservationRows(rows) {
    return rows.map(cache.normalizeObservationPoint).filter(Boolean).sort(function (left, right) {
      return left.date.getTime() - right.date.getTime();
    });
  }

  function normalizeSection(section, kind, enabled) {
    if (!enabled) return Object.freeze({ enabled: false, rows: [], points: [] });
    const value = section && typeof section === "object" ? section : {};
    const rows = rowsFromSection(value);
    const points = kind === "aqi"
      ? parseAqiRows(rows)
      : parseObservationRows(rows);
    return Object.freeze({ ...value, enabled: value.enabled !== false, rows, points });
  }

  function normalizeResult(payload, request, parts, mode) {
    const hasNestedObservations = payload?.observations && typeof payload.observations === "object";
    const hasNestedAqi = payload?.aqi && typeof payload.aqi === "object";
    const observationSection = hasNestedObservations
      ? payload.observations
      : parts.observations && !parts.aqi ? payload : null;
    const aqiSection = hasNestedAqi
      ? payload.aqi
      : parts.aqi && !parts.observations ? payload : null;
    const identity = domain.resolveAuthoritativeIdentity(payload, {
      timeseries_id: request.timeseries_id,
      pollutant: request.pollutant,
    });
    return Object.freeze({
      result_version: "station-history-browser-v1",
      source: "calculated",
      mode,
      request,
      identity,
      identity_valid: Boolean(identity
        && identity.connector_id === request.connector_id
        && identity.timeseries_id === request.timeseries_id),
      observations: normalizeSection(observationSection, "observations", parts.observations),
      aqi: normalizeSection(aqiSection, "aqi", parts.aqi),
      chunk: payload?.chunk || null,
      schema_version: payload?.schema_version ?? null,
      raw: payload,
    });
  }

  function createCalculatedStationHistoryClient(options = {}) {
    const currentBaseUrl = String(options.stationSeriesUrl || "").trim();
    const olderBaseUrl = String(options.historyUrl || "").trim();
    const fetchApi = typeof options.fetchApi === "function"
      ? options.fetchApi
      : typeof fetch === "function" ? fetch.bind(globalThis) : null;
    const scheduler = options.scheduler || null;
    if (!currentBaseUrl || !olderBaseUrl || !fetchApi) {
      throw new Error("calculated_station_history_client_configuration_missing");
    }

    async function fetchJson(url, request, signal, priority) {
      const init = { credentials: "include", headers: { Accept: "application/json" }, signal };
      const execute = function () { return fetchApi(url.toString(), init); };
      const response = scheduler?.schedule
        ? await scheduler.schedule(priority, execute, signal)
        : await execute();
      if (!response?.ok) {
        const body = await response?.text?.().catch(function () { return ""; }) || "";
        const error = new Error(`Station-history request failed: ${response?.status || "unknown"}`);
        error.ukAqHttpStatus = response?.status || null;
        try { error.ukAqContractCode = JSON.parse(body)?.error?.code || null; } catch (_error) { error.ukAqContractCode = null; }
        options.onRequestFailure?.({ url: url.toString(), request, response, body, error });
        throw error;
      }
      const payload = await response.json();
      options.onResponse?.({ url: url.toString(), request, response, payload });
      return payload;
    }

    async function loadCurrent(rawRequest, rawParts, signal) {
      const request = normalizeRequest(rawRequest);
      const parts = normalizeParts(request, rawParts);
      const payload = await fetchJson(
        buildCurrentUrl(currentBaseUrl, request, parts),
        request,
        signal,
        Number(rawParts?.priority ?? options.priorities?.current ?? 0),
      );
      return normalizeResult(payload, request, parts, "current");
    }

    async function loadOlder(rawRequest, rawParts, signal) {
      const request = normalizeRequest(rawRequest);
      const parts = normalizeParts(request, rawParts);
      const payload = await fetchJson(
        buildOlderUrl(olderBaseUrl, request, parts),
        request,
        signal,
        Number(rawParts?.priority ?? options.priorities?.older ?? 1),
      );
      return normalizeResult(payload, request, parts, "older");
    }

    function prefetchAqi(request, signal) {
      return loadCurrent({ ...request, include_observations: false, include_aqi: true }, {
        observations: false,
        aqi: true,
        priority: Number(options.priorities?.prefetch ?? 2),
      }, signal);
    }

    return Object.freeze({
      kind: "calculated",
      loadCurrent,
      loadOlder,
      prefetchAqi,
      buildCurrentUrl: function (request, parts) {
        const normalized = normalizeRequest(request);
        return buildCurrentUrl(currentBaseUrl, normalized, normalizeParts(normalized, parts));
      },
      buildOlderUrl: function (request, parts) {
        const normalized = normalizeRequest(request);
        return buildOlderUrl(olderBaseUrl, normalized, normalizeParts(normalized, parts));
      },
    });
  }

  return {
    createCalculatedStationHistoryClient,
    normalizeRequest,
    normalizeParts,
    normalizeResult,
    parseAqiRows,
    parseObservationRows,
  };
});
