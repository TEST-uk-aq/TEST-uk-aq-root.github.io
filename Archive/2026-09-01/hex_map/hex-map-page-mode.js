// Authoritative Hex Map page presentation mode: normal map or station chart.
function initHexMapPageMode(root) {
  "use strict";

  if (!root?.document || !root.document.body.classList.contains("hex-map-page")) return;
  if (root.UkAqHexMapPageMode) return;

  const MAP_KEYS = new Set(["uk", "cr"]);
  let state = Object.freeze({ mode: "map", chartMapKey: null });

  function snapshot() {
    return Object.freeze({ ...state });
  }

  function normalizeMapKey(value) {
    const mapKey = String(value || "").trim().toLowerCase();
    return MAP_KEYS.has(mapKey) ? mapKey : null;
  }

  function render() {
    const chartMode = state.mode === "chart";
    MAP_KEYS.forEach((mapKey) => {
      const panel = root.document.getElementById(`${mapKey}-hex-chart-mode`);
      const active = chartMode && state.chartMapKey === mapKey;
      if (panel) panel.hidden = !active;
      panel?.closest(".map-canvas-wrap")?.classList.toggle("chart-mode", active);
    });
    root.document.body.classList.toggle("hex-chart-mode", chartMode);
    const backButton = root.document.getElementById("chart-back-to-map");
    if (backButton) backButton.hidden = !chartMode;
    return snapshot();
  }

  function enterChart(mapKey) {
    const normalized = normalizeMapKey(mapKey);
    if (!normalized) return false;
    state = Object.freeze({ mode: "chart", chartMapKey: normalized });
    render();
    return true;
  }

  function exitChart() {
    const changed = state.mode !== "map" || state.chartMapKey !== null;
    state = Object.freeze({ mode: "map", chartMapKey: null });
    render();
    return changed;
  }

  function isChartMode(mapKey = null) {
    if (state.mode !== "chart") return false;
    if (mapKey === null || mapKey === undefined || mapKey === "") return true;
    const normalized = normalizeMapKey(mapKey);
    return Boolean(normalized && state.chartMapKey === normalized);
  }

  const api = Object.freeze({
    getState: snapshot,
    getMode: () => state.mode,
    isChartMode,
    enterChart,
    exitChart,
    render,
  });

  root.UkAqHexMapPageMode = api;
  render();
}

initHexMapPageMode(globalThis);
export default globalThis.UkAqHexMapPageMode;
