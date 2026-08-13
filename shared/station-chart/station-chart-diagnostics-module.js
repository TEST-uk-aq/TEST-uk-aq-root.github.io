import "./station-chart-diagnostics.js";

const diagnostics = globalThis.UkAqStationChartDiagnostics;
if (!diagnostics?.createDiagnostics) throw new Error("Station-chart diagnostics failed to initialise.");

export default diagnostics;
