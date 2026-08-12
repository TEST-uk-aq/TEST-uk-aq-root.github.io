// Shared loader for the public network catalogue. Callers retain refresh and
// memoisation ownership so moving this boundary does not change request cadence.
(function (root, factory) {
  const networkDomain = typeof module === "object" && module.exports
    ? require("../domain/networks.js")
    : root.UkAqNetworks;
  const api = factory(networkDomain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqNetworkCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (networkDomain) {
  "use strict";

  if (!networkDomain?.normalizeCatalogRows) {
    throw new Error("UK AQ network domain must load before the network catalogue client.");
  }

  async function load(options = {}) {
    const url = String(options.url || "").trim();
    if (!url) throw new Error("Network catalog URL is missing.");
    if (typeof options.fetchApi !== "function") {
      throw new Error("Network catalog fetch API is missing.");
    }
    const response = await options.fetchApi(url, options.init || {}, true);
    if (!response.ok) {
      throw new Error(`Network catalog request failed: ${response.status}`);
    }
    const payload = await response.json();
    return networkDomain.normalizeCatalogRows(payload, {
      requirePublicDisplayEnabled: options.requirePublicDisplayEnabled === true,
    });
  }

  return { load };
});
