import domain from "./station-chart-domain-module.js";
import diagnostics from "./station-chart-diagnostics-module.js";
import "./aqi-source-controller.js";

const sourceController = globalThis.UkAqSourceController;
if (!domain || !diagnostics || !sourceController?.createAqiSourceController) {
  throw new Error("AQI-source controller failed to initialise.");
}

export default sourceController;
