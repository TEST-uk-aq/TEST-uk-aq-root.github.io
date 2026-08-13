import stationChartRuntime from "../shared/station-chart/station-chart-runtime.js";
import "./sensor-station-chart-adapter.js";

const stationChartAdapter = globalThis.UkAqSensorStationChartAdapter;
if (!stationChartRuntime?.controller || !stationChartAdapter?.createSensorStationChartAdapter) {
  throw new Error("Sensors station-chart adapter failed to initialise.");
}

export default stationChartAdapter;
