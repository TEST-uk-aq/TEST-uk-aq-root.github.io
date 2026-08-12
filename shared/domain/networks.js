// Canonical public network identity and catalogue-row normalization.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqNetworks = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeCode(value) {
    return String(value ?? "").trim();
  }

  function normalizeLabel(value) {
    return String(value ?? "").trim();
  }

  function resolveId(row) {
    return row?.network_id || row?.station?.network_id || null;
  }

  function resolveCode(row) {
    return normalizeCode(row?.network_code || row?.station?.network_code || null) || null;
  }

  function resolveLabel(row, catalogByCode = null) {
    const label = normalizeLabel(row?.network_label || row?.station?.network_label || null);
    if (label) return label;
    const definition = catalogByCode instanceof Map
      ? catalogByCode.get(resolveCode(row))
      : null;
    return normalizeLabel(typeof definition === "string" ? definition : definition?.label) || null;
  }

  function normalizeCatalogRows(payload, options = {}) {
    const requirePublicDisplayEnabled = options.requirePublicDisplayEnabled === true;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows
      .filter((row) => !requirePublicDisplayEnabled || row?.public_display_enabled === true)
      .map((row) => ({
        id: row?.network_id || null,
        code: normalizeCode(row?.network_code),
        label: normalizeLabel(row?.network_label),
        network_type: row?.network_type || null,
      }))
      .filter((row) => row.code && row.label);
  }

  return {
    normalizeCode,
    normalizeLabel,
    resolveId,
    resolveCode,
    resolveLabel,
    normalizeCatalogRows,
  };
});
