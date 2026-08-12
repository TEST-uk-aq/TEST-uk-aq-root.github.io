// Canonical public pollutant identity and presentation metadata.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqPollutants = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "pm25",
      label: "PM2.5",
      typographicLabel: "PM2.5",
      htmlLabel: "PM2.5",
      unit: "µg/m³",
      readingScope: "pm2.5",
    }),
    Object.freeze({
      key: "pm10",
      label: "PM10",
      typographicLabel: "PM10",
      htmlLabel: "PM10",
      unit: "µg/m³",
      readingScope: "pm10",
    }),
    Object.freeze({
      key: "no2",
      label: "NO2",
      typographicLabel: "NO₂",
      htmlLabel: "NO<sub>2</sub>",
      unit: "µg/m³",
      readingScope: "no2",
    }),
  ]);
  const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));
  const BY_READING_SCOPE = new Map(
    DEFINITIONS.map((definition) => [definition.readingScope, definition]),
  );

  function normalize(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s._-]+/g, "");
    return BY_KEY.has(normalized) ? normalized : null;
  }

  function matchText(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text) return null;
    if (/pm\s*2\s*\.?\s*5/.test(text)
        || text.includes("pm25")
        || text.includes("pm_2.5")
        || (text.includes("particulate") && /2\s*\.?\s*5/.test(text))) {
      return "pm25";
    }
    if (/pm\s*10/.test(text)
        || text.includes("pm10")
        || text.includes("pm_10")
        || (text.includes("particulate") && /10/.test(text))) {
      return "pm10";
    }
    if (/no\s*2/.test(text)
        || text.includes("no2")
        || text.includes("no_2")
        || text.includes("nitrogen dioxide")) {
      return "no2";
    }
    return null;
  }

  function normalizeSupportedLabel(value) {
    const compact = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (compact === "pm25" || compact === "particulatematter25") return "pm25";
    if (compact === "pm10" || compact === "particulatematter10") return "pm10";
    if (compact === "no2" || compact === "nitrogendioxide") return "no2";
    return null;
  }

  function fromRow(row) {
    return matchText([
      row?.pollutant,
      row?.pollutant_label,
      row?.phenomenon_label,
      row?.observed_property_code,
      row?.phenomenon?.pollutant_label,
      row?.phenomenon?.notation,
      row?.phenomenon?.label,
    ].filter(Boolean).join(" "));
  }

  function get(value) {
    const key = normalize(value);
    return key ? BY_KEY.get(key) || null : null;
  }

  function getByReadingScope(value) {
    const scope = String(value ?? "").trim().toLowerCase();
    return BY_READING_SCOPE.get(scope) || null;
  }

  return {
    definitions: DEFINITIONS,
    normalize,
    matchText,
    normalizeSupportedLabel,
    fromRow,
    get,
    getByReadingScope,
  };
});
