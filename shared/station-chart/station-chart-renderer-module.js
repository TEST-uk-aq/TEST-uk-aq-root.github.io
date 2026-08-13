import "./station-chart-renderer.js";

const renderer = globalThis.UkAqStationChartRenderer;
if (!globalThis.d3 || !globalThis.ChartCore || !renderer?.createStationChartRenderer) {
  throw new Error("D3, ChartCore, and the shared station-chart renderer are required.");
}

export default renderer;
