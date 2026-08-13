import pollutants from "../domain/pollutants-module.js";
import "./station-chart-domain.js";

const domain = globalThis.UkAqStationChartDomain;
if (!pollutants?.normalize || !domain?.snapshotChartRange) throw new Error("Station-chart domain failed to initialise.");

export default domain;
