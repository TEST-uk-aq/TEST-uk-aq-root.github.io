import domain from "./station-chart-domain-module.js";
import cache from "./station-chart-cache-module.js";
import sourceController from "./aqi-source-controller-module.js";
import diagnostics from "./station-chart-diagnostics-module.js";
import historyLoader from "./station-history-loader-module.js";
import "./station-chart-controller.js";

const chartController = globalThis.UkAqStationChartController;
if (!domain || !cache || !sourceController || !diagnostics || !historyLoader
    || !chartController?.createStationChartController) {
  throw new Error("Shared station-chart controller failed to initialise.");
}

export default chartController;
