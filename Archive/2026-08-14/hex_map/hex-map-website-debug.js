// Hex Map site-wide diagnostic upload support; intentionally separate from station-chart diagnostics.
(function (root) {
  "use strict";
  if (root.__ukAqWebsiteDebugInitialised) return;
  root.__ukAqWebsiteDebugInitialised = true;

  const params = new URLSearchParams(root.location.search);
  const WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER = "true";
  const configuredWebsiteDebugLogEnabled = WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER.includes("__UK_AQ_WEBSITE_DEBUG_LOG_ENABLED__")
    ? ""
    : WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER;
  const WEBSITE_DEBUG_LOG_ENDPOINT = "/api/aq/debug-log";
  const WEBSITE_DEBUG_RESPONSE_BODY_LIMIT = 50 * 1024;
  const WEBSITE_DEBUG_SAFE_RESPONSE_BODY_LIMIT = 4096;
  const WEBSITE_DEBUG_LOG_SAFE_MAX_BYTES = 220 * 1024;
  const WEBSITE_DEBUG_EVENT_LIMIT = 250;
  const WEBSITE_DEBUG_GENERAL_EVENT_UPLOAD_LIMIT = 250;
  const WEBSITE_DEBUG_NETWORK_EVENT_UPLOAD_LIMIT = 150;
  const WEBSITE_DEBUG_CONSOLE_EVENT_UPLOAD_LIMIT = 200;
  const WEBSITE_DEBUG_ERROR_EVENT_UPLOAD_LIMIT = 80;
  const WEBSITE_DEBUG_CHART_EVENT_UPLOAD_LIMIT = 50;
  const WEBSITE_DEBUG_MAX_STRING_LENGTH = 2000;
  const WEBSITE_DEBUG_LARGE_ARRAY_SAMPLE_SIZE = 3;
  const WEBSITE_DEBUG_COMPACTION_VERSION = 1;
  const WEBSITE_DEBUG_LARGE_FIELD_KEYS = new Set([
    "data", "rows", "points", "features", "geojson", "responsebody", "response_body",
    "payload", "rawpayload", "raw_payload", "localcache", "local_cache", "series",
    "observations", "aqirows", "aqi_rows", "chartdata", "chart_data", "body_json", "body_text",
  ]);
  let websiteDebugSession = null;
  let websiteDebugFlushInFlight = false;
  let websiteDebugPayloadTooLargeWarned = false;

  function parseBooleanFlag(rawValue, fallbackValue) {
    if (rawValue === null || rawValue === undefined || rawValue === "") return Boolean(fallbackValue);
    const normalized = String(rawValue).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return Boolean(fallbackValue);
  }

  function isWebsiteDebugLogEnabled() {
    return parseBooleanFlag(configuredWebsiteDebugLogEnabled, false)
      || parseBooleanFlag(params.get("debug_log"), false);
  }

  function serializeDebugError(error) {
    if (!error) return null;
    return {
      name: error?.name || null,
      message: error instanceof Error ? error.message : String(error),
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : (
        Number.isFinite(Number(error?.ukAqHttpStatus)) ? Number(error.ukAqHttpStatus) : null
      ),
    };
  }

  function getUtf8ByteLength(value) {
    const text = String(value ?? "");
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).byteLength;
    }
    try {
      return new Blob([text]).size;
    } catch (_err) {
      return unescape(encodeURIComponent(text)).length;
    }
  }

  function capDebugText(value, limit = WEBSITE_DEBUG_RESPONSE_BODY_LIMIT) {
    const text = String(value ?? "");
    const cap = Math.max(0, Number(limit) || 0);
    return {
      text: text.slice(0, cap),
      bytes: getUtf8ByteLength(text),
      truncated: text.length > cap,
    };
  }

  function redactDebugQueryValue(key, value) {
    const normalized = String(key || "").toLowerCase();
    if (/(token|secret|key|auth|password|session|jwt|credential)/.test(normalized)) {
      return "[redacted]";
    }
    return value;
  }

  function sanitizeDebugUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      Array.from(url.searchParams.keys()).forEach((key) => {
        url.searchParams.set(key, redactDebugQueryValue(key, url.searchParams.get(key)));
      });
      return url.toString();
    } catch (_err) {
      return String(value || "");
    }
  }

  function extractDebugQueryParams(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      const output = {};
      url.searchParams.forEach((paramValue, key) => {
        output[key] = redactDebugQueryValue(key, paramValue);
      });
      return output;
    } catch (_err) {
      return {};
    }
  }

  function redactDebugHeaders(headers) {
    const output = {};
    if (!headers?.forEach) return output;
    headers.forEach((value, key) => {
      const normalized = String(key || "").toLowerCase();
      output[key] = /(authorization|cookie|set-cookie|token|secret|key|auth|session|jwt|credential)/.test(normalized)
        ? "[redacted]"
        : value;
    });
    return output;
  }

  function summarizeDebugBodyJson(text) {
    const raw = String(text || "").trim();
    if (!raw || (!raw.startsWith("{") && !raw.startsWith("["))) return null;
    try {
      return summarizeLargeDebugValue(JSON.parse(raw), "body_json", 0);
    } catch (_err) {
      return { malformed: true, preview: raw.slice(0, 500) };
    }
  }

  function parseDebugBodyJson(text) {
    return summarizeDebugBodyJson(text);
  }

  function pickDebugValue(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
  }

  function pickDebugNumber(...values) {
    const value = pickDebugValue(...values);
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function pickDebugArray(...values) {
    for (const value of values) {
      if (Array.isArray(value)) return value;
    }
    return null;
  }

  function summarizeLargeDebugValue(value, key = "", depth = 0) {
    const normalizedKey = String(key || "").toLowerCase();
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      if (value.length <= WEBSITE_DEBUG_MAX_STRING_LENGTH && !WEBSITE_DEBUG_LARGE_FIELD_KEYS.has(normalizedKey)) return value;
      return {
        truncated: true,
        original_type: "string",
        original_length: value.length,
        preview: value.slice(0, WEBSITE_DEBUG_MAX_STRING_LENGTH),
      };
    }
    if (typeof value !== "object") return value;
    if (depth > 4) return { truncated: true, original_type: Array.isArray(value) ? "array" : "object", reason: "max_depth" };
    if (Array.isArray(value)) {
      const shouldSummarize = WEBSITE_DEBUG_LARGE_FIELD_KEYS.has(normalizedKey) || value.length > 20;
      if (!shouldSummarize) return value.map((item) => summarizeLargeDebugValue(item, key, depth + 1));
      return {
        truncated: true,
        original_type: "array",
        original_length: value.length,
        sample_first: value.slice(0, WEBSITE_DEBUG_LARGE_ARRAY_SAMPLE_SIZE).map((item) => summarizeLargeDebugValue(item, key, depth + 1)),
        sample_last: value.slice(-WEBSITE_DEBUG_LARGE_ARRAY_SAMPLE_SIZE).map((item) => summarizeLargeDebugValue(item, key, depth + 1)),
      };
    }
    const output = {};
    Object.entries(value).forEach(([childKey, childValue]) => {
      output[childKey] = summarizeLargeDebugValue(childValue, childKey, depth + 1);
    });
    return output;
  }

  function capWebsiteDebugEvents(events = []) {
    const list = Array.isArray(events) ? events : [];
    const networkEvents = [];
    const consoleEvents = [];
    const errorEvents = [];
    const chartEvents = [];
    const generalEvents = [];
    list.forEach((event, index) => {
      const type = String(event?.type || "").toLowerCase();
      const item = { index, event };
      if (type.includes("fetch") || type.includes("network") || type.includes("api") || type.includes("response") || String(event?.route || "").includes("aq")) networkEvents.push(item);
      if (type.includes("console") || type.includes("debug")) consoleEvents.push(item);
      if (type.includes("error") || type.includes("failed") || type.includes("warning") || Number(event?.status || event?.http_status) >= 400) errorEvents.push(item);
      if (type.includes("chart") || type.includes("timeseries") || type.includes("aqi")) chartEvents.push(item);
      generalEvents.push(item);
    });
    const keep = new Set();
    [
      [generalEvents, WEBSITE_DEBUG_GENERAL_EVENT_UPLOAD_LIMIT],
      [networkEvents, WEBSITE_DEBUG_NETWORK_EVENT_UPLOAD_LIMIT],
      [consoleEvents, WEBSITE_DEBUG_CONSOLE_EVENT_UPLOAD_LIMIT],
      [errorEvents, WEBSITE_DEBUG_ERROR_EVENT_UPLOAD_LIMIT],
      [chartEvents, WEBSITE_DEBUG_CHART_EVENT_UPLOAD_LIMIT],
    ].forEach(([items, limit]) => items.slice(-limit).forEach((item) => keep.add(item.index)));
    return list.filter((_event, index) => keep.has(index)).map((event) => summarizeLargeDebugValue(event, "event", 0));
  }

  function compactWebsiteDebugPayload(payload) {
    const compacted = summarizeLargeDebugValue(payload, "payload", 0);
    compacted.events = capWebsiteDebugEvents(payload?.events || []);
    compacted.debug_payload_truncated = true;
    compacted.debug_payload_truncation_reason = "payload_size_limit";
    compacted.debug_payload_compaction_version = WEBSITE_DEBUG_COMPACTION_VERSION;
    return compacted;
  }

  function buildMinimalWebsiteDebugPayload(payload, reason, originalBytes = null) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const important = events.filter((event) => {
      const type = String(event?.type || "").toLowerCase();
      return type.includes("error") || type.includes("failed") || type.includes("warning") || Number(event?.status || event?.http_status) >= 400;
    }).slice(-25).map((event) => summarizeLargeDebugValue(event, "event", 0));
    const networkFailures = events.filter((event) => {
      const type = String(event?.type || "").toLowerCase();
      return type.includes("fetch") || type.includes("network") || type.includes("api") || String(event?.route || "");
    }).filter((event) => typeIsFailure(event)).slice(-25).map((event) => summarizeLargeDebugValue(event, "event", 0));
    return {
      source: payload?.source || "hex_map.html",
      schema_version: payload?.schema_version || 1,
      created_at_utc: payload?.created_at_utc || new Date().toISOString(),
      flushed_at_utc: new Date().toISOString(),
      page_url: payload?.page?.url || sanitizeDebugUrl(window.location.href),
      page: summarizeLargeDebugValue(payload?.page || {}, "page", 0),
      context: summarizeLargeDebugValue(payload?.context || {}, "context", 0),
      session_id: payload?.session_id || null,
      page_view_id: payload?.page_view_id || payload?.context?.page_view_id || null,
      app_version: payload?.app_version || payload?.context?.app_version || null,
      user_agent: payload?.page?.user_agent || window.navigator?.userAgent || null,
      last_important_events: important,
      last_errors: important,
      last_network_failures: networkFailures,
      counters: payload?.counters || {},
      timings_ms: payload?.timings_ms || {},
      debug_payload_truncated: true,
      debug_payload_truncation_reason: reason,
      debug_payload_original_bytes: originalBytes,
      debug_payload_compaction_version: WEBSITE_DEBUG_COMPACTION_VERSION,
    };
  }

  function typeIsFailure(event) {
    const type = String(event?.type || "").toLowerCase();
    return type.includes("failed") || type.includes("error") || Number(event?.status || event?.http_status) >= 400;
  }

  function buildUltraMinimalWebsiteDebugPayload(payload, originalBytes = null, finalBytes = null) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const lastErrors = events.filter((event) => typeIsFailure(event)).slice(-5).map((event) => ({
      at_utc: event?.at_utc || null,
      type: event?.type || null,
      route: event?.route || null,
      status: event?.status ?? event?.http_status ?? null,
      error: summarizeLargeDebugValue(event?.error || event?.message || null, "error", 0),
    }));
    return {
      source: payload?.source || "hex_map.html",
      schema_version: payload?.schema_version || 1,
      created_at_utc: payload?.created_at_utc || new Date().toISOString(),
      flushed_at_utc: new Date().toISOString(),
      page_url: payload?.page?.url || sanitizeDebugUrl(window.location.href),
      session_id: payload?.session_id || null,
      counters: payload?.counters || {},
      last_errors: lastErrors,
      debug_payload_truncated: true,
      debug_payload_truncation_reason: "payload_size_limit_hard_final",
      debug_payload_original_bytes: originalBytes,
      debug_payload_final_bytes: finalBytes,
      debug_payload_compaction_version: WEBSITE_DEBUG_COMPACTION_VERSION,
    };
  }

  function prepareWebsiteDebugPayloadForUpload(payload) {
    const rawBody = JSON.stringify(payload);
    const originalBytes = getUtf8ByteLength(rawBody);
    if (originalBytes <= WEBSITE_DEBUG_LOG_SAFE_MAX_BYTES) {
      return { payload, body: rawBody, originalBytes, finalBytes: originalBytes, truncated: false };
    }
    const compacted = compactWebsiteDebugPayload(payload);
    compacted.debug_payload_original_bytes = originalBytes;
    let compactedBody = JSON.stringify(compacted);
    let compactedBytes = getUtf8ByteLength(compactedBody);
    if (compactedBytes <= WEBSITE_DEBUG_LOG_SAFE_MAX_BYTES) {
      compacted.debug_payload_final_bytes = compactedBytes;
      compactedBody = JSON.stringify(compacted);
      compactedBytes = getUtf8ByteLength(compactedBody);
      return { payload: compacted, body: compactedBody, originalBytes, finalBytes: compactedBytes, truncated: true };
    }
    const minimal = buildMinimalWebsiteDebugPayload(payload, "payload_size_limit_hard", originalBytes);
    let minimalBody = JSON.stringify(minimal);
    let minimalBytes = getUtf8ByteLength(minimalBody);
    minimal.debug_payload_final_bytes = minimalBytes;
    minimalBody = JSON.stringify(minimal);
    minimalBytes = getUtf8ByteLength(minimalBody);
    if (minimalBytes <= WEBSITE_DEBUG_LOG_SAFE_MAX_BYTES) {
      return { payload: minimal, body: minimalBody, originalBytes, finalBytes: minimalBytes, truncated: true, minimal: true };
    }
    const ultraMinimal = buildUltraMinimalWebsiteDebugPayload(payload, originalBytes, minimalBytes);
    let ultraMinimalBody = JSON.stringify(ultraMinimal);
    let ultraMinimalBytes = getUtf8ByteLength(ultraMinimalBody);
    ultraMinimal.debug_payload_final_bytes = ultraMinimalBytes;
    ultraMinimalBody = JSON.stringify(ultraMinimal);
    ultraMinimalBytes = getUtf8ByteLength(ultraMinimalBody);
    return { payload: ultraMinimal, body: ultraMinimalBody, originalBytes, finalBytes: ultraMinimalBytes, truncated: true, minimal: true, ultraMinimal: true };
  }

  function extractHistoryCoverageDebug(source = {}) {
    const meta = source?.meta && typeof source.meta === "object" ? source.meta : {};
    const coverage = source?.coverage && typeof source.coverage === "object"
      ? source.coverage
      : meta?.coverage && typeof meta.coverage === "object"
        ? meta.coverage
        : {};
    return {
      read_version: pickDebugValue(source?.read_version, meta?.read_version, coverage?.read_version),
      index_version: pickDebugValue(source?.index_version, meta?.index_version, coverage?.index_version),
      data_profile: pickDebugValue(source?.data_profile, meta?.data_profile, coverage?.data_profile, coverage?.profile),
      source: pickDebugValue(source?.source, meta?.source, coverage?.source),
      source_path: pickDebugValue(
        source?.source_path,
        meta?.source_path,
        coverage?.source_path,
        coverage?.object_key,
        coverage?.manifest_key,
        coverage?.key,
      ),
      source_prefix: pickDebugValue(
        source?.history_prefix,
        source?.data_prefix,
        source?.aqilevels_prefix,
        source?.observations_prefix,
        meta?.history_prefix,
        meta?.data_prefix,
        meta?.aqilevels_prefix,
        meta?.observations_prefix,
        coverage?.history_prefix,
        coverage?.data_prefix,
        coverage?.aqilevels_prefix,
        coverage?.observations_prefix,
      ),
      history_prefix: pickDebugValue(source?.history_prefix, meta?.history_prefix, coverage?.history_prefix),
      data_prefix: pickDebugValue(source?.data_prefix, meta?.data_prefix, coverage?.data_prefix),
      history_index_prefix: pickDebugValue(source?.history_index_prefix, meta?.history_index_prefix, coverage?.history_index_prefix),
      timeseries_index_prefix: pickDebugValue(source?.timeseries_index_prefix, meta?.timeseries_index_prefix, coverage?.timeseries_index_prefix),
      pollutant_partition: pickDebugValue(source?.pollutant_partition, meta?.pollutant_partition, coverage?.pollutant_partition),
      r2_object_reads: pickDebugNumber(source?.r2_object_reads, meta?.r2_object_reads, coverage?.r2_object_reads),
      parquet_bytes_read: pickDebugNumber(source?.parquet_bytes_read, meta?.parquet_bytes_read, coverage?.parquet_bytes_read),
      matched_rows: pickDebugNumber(
        source?.matched_rows,
        source?.parquet_matched_rows,
        meta?.matched_rows,
        meta?.parquet_matched_rows,
        coverage?.matched_rows,
        coverage?.parquet_matched_rows,
      ),
      response_complete: pickDebugValue(source?.response_complete, meta?.response_complete, coverage?.response_complete),
      partial_reasons: pickDebugArray(source?.partial_reasons, meta?.partial_reasons, coverage?.partial_reasons),
      r2_errors: pickDebugArray(source?.r2_errors, meta?.r2_errors, coverage?.r2_errors),
      ingest_errors: pickDebugArray(source?.ingest_errors, meta?.ingest_errors, coverage?.ingest_errors),
    };
  }

  function createWebsiteDebugSession(context = {}) {
    return {
      schema_version: 1,
      source: "hex_map.html",
      debug_enabled: true,
      session_id: `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`,
      created_at_utc: new Date().toISOString(),
      page: {
        path: window.location.pathname,
        url: sanitizeDebugUrl(window.location.href),
        user_agent: window.navigator?.userAgent || null,
      },
      context,
      events: [],
      timings_ms: {},
      counters: {
        failed_fetch_count: 0,
        aqi_history_503_count: 0,
        postcode_prefix_hints_401_count: 0,
        warning_count: 0,
        error_count: 0,
      },
      flushed: false,
      uploading: false,
    };
  }

  function startWebsiteDebugSession(context = {}) {
    if (!isWebsiteDebugLogEnabled()) return null;
    if (websiteDebugSession) return websiteDebugSession;
    websiteDebugSession = createWebsiteDebugSession(context);
    console.debug("[uk-aq website-debug]", "session-started", websiteDebugSession.context);
    return websiteDebugSession;
  }

  function getWebsiteDebugSession() {
    if (!isWebsiteDebugLogEnabled()) return null;
    if (!websiteDebugSession) {
      websiteDebugSession = createWebsiteDebugSession({ reason: "ad-hoc" });
    }
    return websiteDebugSession;
  }

  function recordWebsiteDebugEvent(type, details = {}) {
    const session = getWebsiteDebugSession();
    if (!session) return;
    const event = {
      at_utc: new Date().toISOString(),
      type,
      ...details,
    };
    const sanitizedEvent = summarizeLargeDebugValue(event, "event", 0);
    if (session.events.length >= WEBSITE_DEBUG_EVENT_LIMIT) {
      session.events.splice(0, session.events.length - WEBSITE_DEBUG_EVENT_LIMIT + 1);
      session.events_truncated = true;
    }
    session.events.push(sanitizedEvent);
    const status = Number(details?.status ?? details?.http_status ?? details?.response?.status);
    if (type.includes("failed") || (Number.isFinite(status) && status >= 400)) {
      session.counters.failed_fetch_count += 1;
    }
    if (type.includes("error") || (Number.isFinite(status) && status >= 500)) {
      session.counters.error_count += 1;
    }
    if (type.includes("warning") || type.includes("malformed")) {
      session.counters.warning_count += 1;
    }
    if (String(details?.route || "").includes("aqi-history") && status === 503) {
      session.counters.aqi_history_503_count += 1;
    }
    if (String(details?.route || "").includes("postcode_prefix_hints") && status === 401) {
      session.counters.postcode_prefix_hints_401_count += 1;
    }
  }

  function recordWebsiteDebugTiming(name, valueMs) {
    const session = getWebsiteDebugSession();
    if (!session || !name || !Number.isFinite(Number(valueMs))) return;
    session.timings_ms[name] = Math.round(Number(valueMs));
  }

  async function flushWebsiteDebugLog(reason = "manual") {
    const session = websiteDebugSession;
    if (!isWebsiteDebugLogEnabled() || !session || session.flushed || session.uploading || websiteDebugFlushInFlight) return;
    if (!session.events.length && !Object.keys(session.timings_ms || {}).length) return;
    session.uploading = true;
    websiteDebugFlushInFlight = true;
    const snapshotEvents = session.events.slice();
    const uploadedEventRefs = new Set(snapshotEvents);
    const snapshotEventCount = snapshotEvents.length;
    const snapshotTimings = { ...(session.timings_ms || {}) };
    const payload = {
      ...session,
      events: snapshotEvents,
      timings_ms: snapshotTimings,
      flushed_reason: reason,
      flushed_at_utc: new Date().toISOString(),
    };
    try {
      const prepared = prepareWebsiteDebugPayloadForUpload(payload);
      const body = prepared.body;
      const response = await window.ukAqFetchCacheApi(WEBSITE_DEBUG_LOG_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: body.length < 60000,
      });
      const responseText = await response.text().catch(() => "");
      let responsePayload = null;
      try {
        responsePayload = responseText ? JSON.parse(responseText) : null;
      } catch (_err) {
        responsePayload = null;
      }
      if (!response.ok) {
        if (response.status === 413) {
          session.size_upload_failed = true;
          session.events = [{
            at_utc: new Date().toISOString(),
            type: "debug_upload_payload_too_large",
            original_bytes: prepared.originalBytes,
            final_bytes: prepared.finalBytes,
          }];
          session.timings_ms = {};
          if (!websiteDebugPayloadTooLargeWarned) {
            websiteDebugPayloadTooLargeWarned = true;
            console.warn("[uk-aq website-debug]", "upload failed 413 after compaction; dropped oversized payload", { original_bytes: prepared.originalBytes, final_bytes: prepared.finalBytes });
          }
        } else {
          console.warn("[uk-aq website-debug]", "upload failed", response.status, responsePayload || responseText);
          session.events = capWebsiteDebugEvents(session.events).slice(-50);
        }
        session.uploading = false;
        websiteDebugFlushInFlight = false;
        return;
      }
      if (responsePayload?.uploaded !== true) {
        console.warn("[uk-aq website-debug]", "upload not confirmed", responsePayload || responseText);
        session.uploading = false;
        websiteDebugFlushInFlight = false;
        session.events = capWebsiteDebugEvents(session.events).slice(-50);
        return;
      }
      session.events = session.events.filter((event) => !uploadedEventRefs.has(event));
      session.timings_ms = {};
      session.flushed = false;
      session.upload_count = (session.upload_count || 0) + 1;
      session.uploading = false;
      websiteDebugFlushInFlight = false;
      console.debug("[uk-aq website-debug]", "uploaded", {
        reason,
        events: snapshotEventCount,
        timings: Object.keys(snapshotTimings || {}).length,
        bytes: prepared.finalBytes,
        truncated: prepared.truncated,
        dropbox_path: responsePayload?.dropbox_path || null,
      });
    } catch (error) {
      session.uploading = false;
      websiteDebugFlushInFlight = false;
      session.events = capWebsiteDebugEvents(session.events).slice(-50);
      console.warn("[uk-aq website-debug]", "upload error", error);
    }
  }

  function recordWebsiteFetchFailure(route, url, response, bodyText, context = {}) {
    if (!isWebsiteDebugLogEnabled()) return;
    const session = getWebsiteDebugSession();
    const status = response?.status || null;
    const hasPriorMatchingBody = Boolean(session?.events?.some((event) => (
      event?.type === "fetch_failed"
      && event?.route === route
      && event?.status === status
      && (event?.body_text || event?.body_text_summary)
    )));
    const capped = capDebugText(bodyText, hasPriorMatchingBody ? 2048 : WEBSITE_DEBUG_SAFE_RESPONSE_BODY_LIMIT);
    recordWebsiteDebugEvent("fetch_failed", {
      route,
      url: sanitizeDebugUrl(url),
      query: extractDebugQueryParams(url),
      status,
      status_text: response?.statusText || "",
      headers: redactDebugHeaders(response?.headers),
      body_text_summary: summarizeLargeDebugValue(capped.text, "body_text", 0),
      body_json_summary: summarizeDebugBodyJson(capped.text),
      body_bytes: capped.bytes,
      body_truncated: capped.truncated,
      context,
    });
  }

  window.ukAqWebsiteDebugLog = {
    enabled: isWebsiteDebugLogEnabled,
    recordEvent: recordWebsiteDebugEvent,
    recordTiming: recordWebsiteDebugTiming,
    flush: flushWebsiteDebugLog,
    capText: capDebugText,
    sanitizeUrl: sanitizeDebugUrl,
    redactHeaders: redactDebugHeaders,
    parseBodyJson: summarizeDebugBodyJson,
    preparePayloadForUpload: prepareWebsiteDebugPayloadForUpload,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
