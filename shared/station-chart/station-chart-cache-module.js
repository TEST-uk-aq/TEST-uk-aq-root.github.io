import domain from "./station-chart-domain-module.js";
import "./station-chart-cache.js";

const cache = globalThis.UkAqStationChartCache;
if (!domain?.snapshotChartRange || !cache?.createCacheRecord) throw new Error("Station-chart cache failed to initialise.");

export default cache;
