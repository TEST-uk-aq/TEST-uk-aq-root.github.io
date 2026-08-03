// Thin Hex Map adapter for the shared pollutant-context controller.
(function (root, factory) {
  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("../station_chart/station-chart-domain.js") : null);
  const api = factory(domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqHexMapStationChartAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain) {
  "use strict";

  if (!domain) throw new Error("UkAqStationChartDomain is required");

  function createHexMapStationChartAdapter(options = {}) {
    const eventTarget = options.eventTarget || (typeof window !== "undefined" ? window : null);
    const controller = options.controller;
    if (!controller?.setPollutantContext) throw new Error("pollutant_context_controller_required");
    let mounted = false;

    function selection() {
      const value = typeof options.getSelection === "function" ? options.getSelection() : {};
      return value && typeof value === "object" ? value : {};
    }

    function request(pollutant) {
      const normalized = domain.normalizePollutant(pollutant);
      if (!normalized || (typeof options.isActive === "function" && !options.isActive())) return false;
      void controller.setPollutantContext({
        pollutant: normalized,
        entries: [],
        status: "loading",
        preserveRange: true,
        preserveSelection: true,
        ...selection(),
      });
      return true;
    }

    function resolveStatus(context, explicitStatus) {
      const status = String(explicitStatus || context?.dataStatus || "").trim().toLowerCase();
      if (status === "failed") return "failed";
      const pollutant = domain.normalizePollutant(context?.pollutant);
      const loadedPollutant = domain.normalizePollutant(context?.loadedPollutant);
      return status === "ready" && pollutant && loadedPollutant === pollutant ? "ready" : "loading";
    }

    function sync(context, explicitStatus) {
      if (!context || (typeof options.isActive === "function" && !options.isActive(context.mapKey))) return false;
      const pollutant = domain.normalizePollutant(context.pollutant);
      if (!pollutant) return false;
      const status = resolveStatus(context, explicitStatus);
      void controller.setPollutantContext({
        pollutant,
        entries: status === "ready" ? (Array.isArray(context.entries) ? context.entries : []) : [],
        status,
        preserveRange: true,
        preserveSelection: true,
        ...selection(),
      });
      return true;
    }

    function handlePollutantChange(event) {
      request(event?.detail?.pollutant);
    }

    function mount() {
      if (mounted || !eventTarget?.addEventListener) return false;
      eventTarget.addEventListener("pollutantchange", handlePollutantChange);
      mounted = true;
      return true;
    }

    function destroy() {
      if (mounted && eventTarget?.removeEventListener) {
        eventTarget.removeEventListener("pollutantchange", handlePollutantChange);
      }
      mounted = false;
    }

    return Object.freeze({
      mount,
      destroy,
      request,
      sync,
      resolveStatus,
      get mounted() { return mounted; },
    });
  }

  return { createHexMapStationChartAdapter };
});
