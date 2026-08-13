import pollutants from "../domain/pollutants-module.js";
import "./timeseries-client.js";

const timeseriesClient = globalThis.UkAqTimeseriesClient;
if (!pollutants?.normalize || !timeseriesClient) throw new Error("Shared timeseries client failed to initialise.");

export default timeseriesClient;
