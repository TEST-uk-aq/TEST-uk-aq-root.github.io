import domain from "./station-chart-domain-module.js";
import cache from "./station-chart-cache-module.js";
import "./station-history-loader.js";

const historyLoader = globalThis.UkAqStationHistoryLoader;
if (!domain || !cache || !historyLoader?.createPriorityFetchScheduler) {
  throw new Error("Station-history loader failed to initialise.");
}

export default historyLoader;
