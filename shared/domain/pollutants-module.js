import "./pollutants.js";

const pollutants = globalThis.UkAqPollutants;
if (!pollutants?.normalize) throw new Error("Canonical pollutant domain failed to initialise.");

export default pollutants;
