import "./networks.js";

const networks = globalThis.UkAqNetworks;
if (!networks?.resolveCode) throw new Error("Canonical network domain failed to initialise.");

export default networks;
