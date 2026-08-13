import networks from "../domain/networks-module.js";
import "./network-catalog.js";

const networkCatalog = globalThis.UkAqNetworkCatalog;
if (!networks?.resolveCode || !networkCatalog?.load) {
  throw new Error("Shared network catalogue failed to initialise.");
}

export default networkCatalog;
