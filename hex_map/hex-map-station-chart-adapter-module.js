import stationChartRuntime from "../shared/station-chart/station-chart-runtime.js";
import pageMode from "./hex-map-page-mode.js";
import "./hex-map-station-chart-adapter.js";

const stationChartAdapter = globalThis.UkAqHexMapStationChartAdapter;
if (!stationChartRuntime?.controller || !pageMode?.enterChart || !stationChartAdapter?.installHexMapStationChart) {
  throw new Error("Hex Map station-chart adapter failed to initialise.");
}

export default stationChartAdapter;
