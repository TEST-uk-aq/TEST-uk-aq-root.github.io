import pollutantDomain from "../shared/domain/pollutants-module.js";
import coordinator from "./hex-map-coordinator.js";
import networkController from "./hex-map-network-controller.js";
import pageMode from "./hex-map-page-mode.js";

function initHexMapPollutantAvailability(root) {
  "use strict";

  if (!root?.document || !root.document.body.classList.contains("hex-map-page")) return null;
  if (!pollutantDomain?.get || !coordinator?.getPollutant
      || !networkController?.getPollutantCapability || !pageMode?.isChartMode) {
    throw new Error("Hex Map pollutant availability dependencies failed to initialise.");
  }

  // Three catalogue names fit the 640px desktop overlay without turning the
  // status into a long network list; narrower layouts wrap the same short list.
  const MAX_LISTED_NETWORKS = 3;
  const overlays = new Map(
    Array.from(root.document.querySelectorAll("[data-pollutant-unavailable-overlay]"))
      .map((element) => [String(element.dataset.mapKind || "").trim(), element])
      .filter(([mapKey]) => mapKey === "uk" || mapKey === "cr"),
  );
  const mapStates = new Map([
    ["uk", { hasSuccessfulLoad: false, hasError: false }],
    ["cr", { hasSuccessfulLoad: false, hasError: false }],
  ]);
  const renderedKeys = new Map();
  let mounted = false;

  function formatNetworkNames(names) {
    if (names.length < 2) return names[0] || "";
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }

  function messageFor(pollutantLabel, networkNames) {
    if (networkNames.length === 1) {
      return {
        lead: `${pollutantLabel} is not monitored by ${networkNames[0]}.`,
        names: "",
        action: `Select another network to view ${pollutantLabel}.`,
      };
    }
    if (networkNames.length <= MAX_LISTED_NETWORKS) {
      return {
        lead: `${pollutantLabel} is not monitored by the selected networks:`,
        names: `${formatNetworkNames(networkNames)}.`,
        action: `Select another network to view ${pollutantLabel}.`,
      };
    }
    return {
      lead: `${pollutantLabel} is not monitored by any of the selected networks.`,
      names: "",
      action: `Select another network to view ${pollutantLabel}.`,
    };
  }

  function hideOverlay(mapKey) {
    const overlay = overlays.get(mapKey);
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    renderedKeys.delete(mapKey);
  }

  function renderOverlay(mapKey) {
    const overlay = overlays.get(mapKey);
    const mapState = mapStates.get(mapKey);
    if (!overlay || !mapState?.hasSuccessfulLoad || mapState.hasError || pageMode.isChartMode(mapKey)) {
      hideOverlay(mapKey);
      return;
    }

    const pollutant = coordinator.getPollutant();
    const capability = networkController.getPollutantCapability(pollutant);
    const selectedEntries = networkController.getSelectedEntries();
    const isUnsupportedSelection = selectedEntries.length > 0
      && capability.status === "ready"
      && selectedEntries.every((entry) => !capability.supportedCodes.has(entry.code));
    if (!isUnsupportedSelection) {
      hideOverlay(mapKey);
      return;
    }

    const pollutantLabel = pollutantDomain.get(pollutant)?.typographicLabel || pollutant;
    const networkNames = selectedEntries.map((entry) => entry.displayLabel).filter(Boolean);
    const message = messageFor(pollutantLabel, networkNames);
    const messageKey = [pollutant, ...networkNames].join("|");
    if (renderedKeys.get(mapKey) !== messageKey) {
      // Keep the polite live region present before changing its text so assistive
      // technology receives one useful update for this new unsupported state.
      overlay.hidden = false;
      overlay.querySelector("[data-pollutant-unavailable-lead]").textContent = message.lead;
      const names = overlay.querySelector("[data-pollutant-unavailable-names]");
      names.textContent = message.names;
      names.hidden = !message.names;
      overlay.querySelector("[data-pollutant-unavailable-action]").textContent = message.action;
      renderedKeys.set(mapKey, messageKey);
    }
    overlay.hidden = false;
  }

  function renderAll() {
    renderOverlay("uk");
    renderOverlay("cr");
  }

  function handleMapStatus(event) {
    const mapKey = String(event.detail?.mapKey || "").trim();
    const state = mapStates.get(mapKey);
    if (!state) return;
    const status = String(event.detail?.status || "").trim().toLowerCase();
    if (status === "live") {
      state.hasSuccessfulLoad = true;
      state.hasError = false;
    } else if (status === "error") {
      state.hasError = true;
    }
    renderOverlay(mapKey);
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    root.addEventListener("hexmapstatuschange", handleMapStatus);
    root.addEventListener("networkselectionchange", renderAll);
    root.addEventListener("pollutantchange", renderAll);
    root.addEventListener("pollutantcapabilitychange", renderAll);
    root.addEventListener("hexpagemodechange", renderAll);
    renderAll();
  }

  return Object.freeze({ mount, render: renderAll });
}

const pollutantAvailability = initHexMapPollutantAvailability(globalThis);
export default pollutantAvailability;
