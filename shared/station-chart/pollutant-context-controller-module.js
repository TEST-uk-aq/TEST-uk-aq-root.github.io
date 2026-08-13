import domain from "./station-chart-domain-module.js";
import "./pollutant-context-controller.js";

const pollutantContext = globalThis.UkAqPollutantContextController;
if (!domain || !pollutantContext?.createPollutantContextController) {
  throw new Error("Pollutant-context controller failed to initialise.");
}

export default pollutantContext;
