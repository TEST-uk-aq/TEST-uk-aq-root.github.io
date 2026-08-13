import domain from "./station-chart-domain-module.js";
import timeseriesClient from "./timeseries-client-module.js";
import "./station-history-compatibility-client.js";

const compatibilityClient = globalThis.UkAqCompatibilityStationHistoryClient;
if (!domain || !timeseriesClient || !compatibilityClient?.createCompatibilityStationHistoryClient) {
  throw new Error("Compatibility station-history client failed to initialise.");
}

export default compatibilityClient;
