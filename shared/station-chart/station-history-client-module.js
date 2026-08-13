import domain from "./station-chart-domain-module.js";
import cache from "./station-chart-cache-module.js";
import "./station-history-client.js";

const historyClient = globalThis.UkAqCalculatedStationHistoryClient;
if (!domain || !cache || !historyClient?.createCalculatedStationHistoryClient) {
  throw new Error("Calculated station-history client failed to initialise.");
}

export default historyClient;
