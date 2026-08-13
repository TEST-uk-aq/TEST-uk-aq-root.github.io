import timeseriesClient from "./timeseries-client-module.js";
import domain from "./station-chart-domain-module.js";
import cache from "./station-chart-cache-module.js";
import diagnostics from "./station-chart-diagnostics-module.js";
import sourceController from "./aqi-source-controller-module.js";
import pollutantContext from "./pollutant-context-controller-module.js";
import historyLoader from "./station-history-loader-module.js";
import calculatedClient from "./station-history-client-module.js";
import compatibilityClient from "./station-history-compatibility-client-module.js";
import renderer from "./station-chart-renderer-module.js";
import controller from "./station-chart-controller-module.js";

const stationChartRuntime = Object.freeze({
  timeseriesClient,
  domain,
  cache,
  diagnostics,
  sourceController,
  pollutantContext,
  historyLoader,
  calculatedClient,
  compatibilityClient,
  renderer,
  controller,
});

export {
  timeseriesClient,
  domain,
  cache,
  diagnostics,
  sourceController,
  pollutantContext,
  historyLoader,
  calculatedClient,
  compatibilityClient,
  renderer,
  controller,
};
export default stationChartRuntime;
