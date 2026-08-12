// Bounded, non-blocking diagnostic shaping for station charts.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqStationChartDiagnostics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_LIMITS = Object.freeze({
    maxArrayItems: 16,
    maxObjectKeys: 48,
    maxStringLength: 512,
    maxDepth: 5,
  });
  const ROW_ARRAY_KEYS = /(^|_)(rows?|points?|observation_points|aqi_points)$/i;

  function shapeValue(value, limits, depth, seen) {
    if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value.slice(0, limits.maxStringLength);
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    if (value instanceof Error) {
      return {
        name: String(value.name || "Error").slice(0, 64),
        message: String(value.message || value).slice(0, limits.maxStringLength),
      };
    }
    if (depth >= limits.maxDepth) return "[bounded]";
    if (typeof value !== "object") return String(value).slice(0, limits.maxStringLength);
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) {
      const shaped = value.slice(0, limits.maxArrayItems).map(function (entry) {
        return shapeValue(entry, limits, depth + 1, seen);
      });
      seen.delete(value);
      return shaped;
    }
    const output = {};
    Object.keys(value).slice(0, limits.maxObjectKeys).forEach(function (key) {
      if (ROW_ARRAY_KEYS.test(key) && Array.isArray(value[key])) {
        output[`${key}_count`] = value[key].length;
        return;
      }
      output[key] = shapeValue(value[key], limits, depth + 1, seen);
    });
    seen.delete(value);
    return output;
  }

  function shapeEvent(type, details = {}, options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...options };
    return {
      type: String(type || "station_chart_event").slice(0, 96),
      details: shapeValue(details, limits, 0, new Set()),
    };
  }

  function shapeTiming(name, valueMs) {
    const numeric = Number(valueMs);
    return {
      name: String(name || "station_chart_timing").slice(0, 96),
      value_ms: Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null,
    };
  }

  function createDiagnostics(options = {}) {
    const recordEvent = typeof options.recordEvent === "function" ? options.recordEvent : function () {};
    const recordTiming = typeof options.recordTiming === "function" ? options.recordTiming : function () {};
    return Object.freeze({
      event(type, details) {
        const shaped = shapeEvent(type, details, options.limits);
        queueMicrotask(function () { recordEvent(shaped.type, shaped.details); });
        return shaped;
      },
      timing(name, valueMs) {
        const shaped = shapeTiming(name, valueMs);
        queueMicrotask(function () { recordTiming(shaped.name, shaped.value_ms); });
        return shaped;
      },
    });
  }

  return {
    DEFAULT_LIMITS,
    shapeEvent,
    shapeTiming,
    createDiagnostics,
  };
});
