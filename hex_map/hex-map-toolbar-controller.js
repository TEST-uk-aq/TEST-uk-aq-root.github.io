(function initHexMapToolbarController(root) {
  "use strict";

  if (!root?.document || !root.document.body.classList.contains("hex-map-page")) return;
  if (root.UkAqHexMapToolbarController) return;

  const coordinator = root.UkAqHexMapCoordinator;
  const urlState = root.UkAqHexMapUrlState;
  const networkController = root.UkAqHexMapNetworkController;
  if (!coordinator?.getActiveMap
      || !coordinator?.getMapSettings
      || !coordinator?.registerActiveMapPresenter
      || !urlState?.switchToUk
      || !urlState?.switchToCr
      || !urlState?.setCrRegion) {
    throw new Error("Hex Map toolbar dependencies must load before the toolbar controller.");
  }

  const tabUk = root.document.getElementById("tab-uk");
  const tabCr = root.document.getElementById("tab-cr");
  const panelUk = root.document.getElementById("tab-panel-uk");
  const panelCr = root.document.getElementById("tab-panel-cr");
  const tabBar = root.document.querySelector(".tab-bar");
  const tabSlots = {
    uk: panelUk?.querySelector("[data-tab-slot]"),
    cr: panelCr?.querySelector("[data-tab-slot]"),
  };
  const toolbar = root.document.getElementById("main-toolbar");
  const toolbarSlots = {
    uk: root.document.getElementById("uk-toolbar-slot"),
    cr: root.document.getElementById("cr-toolbar-slot"),
  };
  const toolbarTabUk = root.document.getElementById("toolbar-tab-uk");
  const toolbarTabCr = root.document.getElementById("toolbar-tab-cr");
  const regionSection = root.document.getElementById("toolbar-region-section");
  const regionTrigger = root.document.getElementById("toolbar-region-trigger");
  const regionLabel = root.document.getElementById("toolbar-region-label");
  const regionMenu = root.document.getElementById("toolbar-region-menu");
  const popoverWrap = root.document.getElementById("toolbar-popover-wrap");
  const windowStepper = root.document.getElementById("window-stepper");
  const windowStepperPrev = windowStepper?.querySelector("[data-window-step='prev']");
  const windowStepperNext = windowStepper?.querySelector("[data-window-step='next']");
  const windowStepperValueBox = windowStepper?.querySelector(".window-stepper-value-box");

  const WINDOW_ORDER = ["3h", "6h", "1d", "7d", "all"];
  const WINDOW_LABELS_FALLBACK = {
    "3h": "3 Hours",
    "6h": "6 Hours",
    "1d": "1 Day",
    "7d": "7 Days",
    all: "No Limit",
  };
  const reduceMotionQuery = typeof root.matchMedia === "function"
    ? root.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  let mounted = false;
  let regionPopoverOpen = false;
  let prefersReducedMotion = Boolean(reduceMotionQuery?.matches);
  let windowStepperKey = null;
  let windowStepperTimer = null;

  function normalizeWindowKey(value) {
    return WINDOW_ORDER.includes(value) ? value : "6h";
  }

  function getWindowLabel(key) {
    if (typeof root.WINDOW_LABELS === "object" && root.WINDOW_LABELS?.[key]) {
      return root.WINDOW_LABELS[key];
    }
    return WINDOW_LABELS_FALLBACK[key] || WINDOW_LABELS_FALLBACK["6h"];
  }

  function readSharedWindowKey() {
    return normalizeWindowKey(coordinator.getMapSettings().window);
  }

  function setStepperButtons(windowKey) {
    if (!windowStepperPrev || !windowStepperNext || !windowStepper) return;
    const index = WINDOW_ORDER.indexOf(windowKey);
    windowStepperPrev.disabled = index <= 0;
    windowStepperNext.disabled = index >= WINDOW_ORDER.length - 1;
    windowStepper.dataset.window = windowKey;
  }

  function resetWindowStepperValue(label) {
    if (!windowStepperValueBox) return;
    if (windowStepperTimer) {
      root.clearTimeout(windowStepperTimer);
      windowStepperTimer = null;
    }
    windowStepperValueBox.classList.remove("is-animating", "is-moving-prev", "is-moving-next");
    windowStepperValueBox.innerHTML = `<span class="window-stepper-value" data-window-value>${label}</span>`;
  }

  function animateWindowStepper(label, direction) {
    if (!windowStepperValueBox || prefersReducedMotion) {
      resetWindowStepperValue(label);
      return;
    }
    if (windowStepperTimer) {
      root.clearTimeout(windowStepperTimer);
      windowStepperTimer = null;
    }
    const valueNodes = Array.from(windowStepperValueBox.querySelectorAll("[data-window-value]"));
    const currentNode = valueNodes[valueNodes.length - 1];
    if (!currentNode) {
      resetWindowStepperValue(label);
      return;
    }
    if (valueNodes.length > 1) {
      valueNodes.slice(0, -1).forEach((node) => node.remove());
    }
    const incomingNode = root.document.createElement("span");
    incomingNode.className = `window-stepper-value window-stepper-value--incoming ${
      direction === "next" ? "from-right" : "from-left"
    }`;
    incomingNode.setAttribute("data-window-value", "");
    incomingNode.textContent = label;
    currentNode.classList.add("window-stepper-value--outgoing");
    windowStepperValueBox.appendChild(incomingNode);
    windowStepperValueBox.classList.remove("is-moving-prev", "is-moving-next");
    windowStepperValueBox.classList.add(direction === "next" ? "is-moving-next" : "is-moving-prev");
    root.requestAnimationFrame(() => {
      windowStepperValueBox.classList.add("is-animating");
    });
    windowStepperTimer = root.setTimeout(() => {
      resetWindowStepperValue(label);
    }, 210);
  }

  function renderWindowStepper(options = {}) {
    if (!windowStepperValueBox) return;
    const nextKey = readSharedWindowKey();
    const nextLabel = getWindowLabel(nextKey);
    const previousKey = windowStepperKey;
    windowStepperKey = nextKey;
    setStepperButtons(nextKey);
    if (!previousKey || options.force || previousKey === nextKey) {
      resetWindowStepperValue(nextLabel);
      return;
    }
    const previousIndex = WINDOW_ORDER.indexOf(previousKey);
    const nextIndex = WINDOW_ORDER.indexOf(nextKey);
    animateWindowStepper(nextLabel, nextIndex > previousIndex ? "next" : "prev");
  }

  function renderRegionPopover() {
    if (regionMenu) regionMenu.hidden = !regionPopoverOpen;
    regionTrigger?.classList.toggle("open", regionPopoverOpen);
    regionTrigger?.setAttribute("aria-expanded", String(regionPopoverOpen));
  }

  function setRegionPopoverOpen(open) {
    regionPopoverOpen = Boolean(open);
    renderRegionPopover();
    if (regionPopoverOpen) renderRegion();
  }

  function closeRegionPopover() {
    setRegionPopoverOpen(false);
  }

  function getCurrentRegion() {
    const crController = root.UkAqHexMapCrController || root.crMap;
    return crController?.getRegion?.() || null;
  }

  function renderRegion() {
    const current = getCurrentRegion();
    if (!current) return;
    if (regionLabel) regionLabel.textContent = current;
    regionMenu?.querySelectorAll("[data-region]").forEach((item) => {
      item.classList.toggle("active", item.dataset.region === current);
    });
  }

  function relocateStatusRefreshForMap(mapKey) {
    const isUk = mapKey === "uk";
    const statusSlot = root.document.getElementById("toolbar-status-slot");
    const refreshSlot = root.document.getElementById("toolbar-refresh-slot");
    const activeStatus = root.document.getElementById(isUk ? "status-pill-uk" : "status-pill-cr");
    const activeRefresh = root.document.getElementById(isUk ? "refresh" : "cr-refresh");
    const inactiveStatus = root.document.getElementById(isUk ? "status-pill-cr" : "status-pill-uk");
    const inactiveRefresh = root.document.getElementById(isUk ? "cr-refresh" : "refresh");
    const inactiveTopbar = root.document.querySelector(
      isUk ? "#tab-panel-cr .map-topbar" : "#tab-panel-uk .map-topbar",
    );

    if (inactiveTopbar) {
      if (inactiveStatus && inactiveStatus.parentElement !== inactiveTopbar) {
        inactiveTopbar.insertBefore(inactiveStatus, inactiveTopbar.firstChild);
      }
      if (inactiveRefresh && inactiveRefresh.parentElement !== inactiveTopbar) {
        inactiveTopbar.insertBefore(inactiveRefresh, inactiveTopbar.firstChild?.nextSibling || null);
      }
    }
    if (statusSlot && activeStatus && activeStatus.parentElement !== statusSlot) {
      statusSlot.appendChild(activeStatus);
    }
    if (refreshSlot && activeRefresh && activeRefresh.parentElement !== refreshSlot) {
      refreshSlot.appendChild(activeRefresh);
    }
  }

  function presentActiveMap(mapKey) {
    if (mapKey !== "uk" && mapKey !== "cr") return;
    const isUk = mapKey === "uk";
    root.UkAqHexMapSearch?.syncActiveTabInput?.(mapKey);
    tabUk?.setAttribute("aria-selected", isUk ? "true" : "false");
    tabCr?.setAttribute("aria-selected", isUk ? "false" : "true");

    const targetTabSlot = isUk ? tabSlots.uk : tabSlots.cr;
    if (tabBar && targetTabSlot && tabBar.parentElement !== targetTabSlot) {
      targetTabSlot.appendChild(tabBar);
    }
    const targetToolbarSlot = isUk ? toolbarSlots.uk : toolbarSlots.cr;
    if (toolbar && targetToolbarSlot && toolbar.parentElement !== targetToolbarSlot) {
      targetToolbarSlot.appendChild(toolbar);
    }
    if (panelUk) panelUk.hidden = !isUk;
    if (panelCr) panelCr.hidden = isUk;

    toolbarTabUk?.classList.toggle("active", isUk);
    toolbarTabCr?.classList.toggle("active", !isUk);
    regionSection?.classList.toggle("visible", !isUk);
    networkController?.syncPanelForActiveScope?.();
    relocateStatusRefreshForMap(mapKey);
    if (!isUk) renderRegion();
  }

  function renderActiveMap() {
    presentActiveMap(coordinator.getActiveMap());
  }

  function render() {
    renderActiveMap();
    renderRegion();
    renderRegionPopover();
    renderWindowStepper({ force: true });
  }

  function navigateToUk() {
    urlState.switchToUk({ updateUrl: true, push: true });
  }

  function navigateToCr() {
    urlState.switchToCr(null, { updateUrl: true, push: true });
  }

  function handleWindowStepperClick(event) {
    const button = event.target instanceof Element
      ? event.target.closest("button[data-window-step]")
      : null;
    if (!button || button.disabled) return;
    const currentKey = readSharedWindowKey();
    const currentIndex = WINDOW_ORDER.indexOf(currentKey);
    const offset = button.dataset.windowStep === "next" ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(WINDOW_ORDER.length - 1, currentIndex + offset));
    const nextKey = WINDOW_ORDER[nextIndex];
    if (nextKey === currentKey) return;
    coordinator.updateMapSettings({ window: nextKey }, { source: "window-stepper" });
  }

  function mount() {
    if (mounted) return false;
    mounted = true;

    coordinator.registerActiveMapPresenter(presentActiveMap);
    tabUk?.addEventListener("click", navigateToUk);
    tabCr?.addEventListener("click", navigateToCr);
    toolbarTabUk?.addEventListener("click", navigateToUk);
    toolbarTabCr?.addEventListener("click", navigateToCr);
    windowStepper?.addEventListener("click", handleWindowStepperClick);
    root.addEventListener("mapsettingschange", (event) => {
      if (event.detail?.window) renderWindowStepper();
    });
    root.addEventListener("crregionchange", renderRegion);

    if (reduceMotionQuery) {
      const handleMotionChange = (event) => {
        prefersReducedMotion = Boolean(event.matches);
        renderWindowStepper({ force: true });
      };
      if (typeof reduceMotionQuery.addEventListener === "function") {
        reduceMotionQuery.addEventListener("change", handleMotionChange);
      } else if (typeof reduceMotionQuery.addListener === "function") {
        reduceMotionQuery.addListener(handleMotionChange);
      }
    }

    regionTrigger?.addEventListener("click", () => {
      networkController?.closePanel?.();
      setRegionPopoverOpen(!regionPopoverOpen);
    });
    root.document.addEventListener("mousedown", (event) => {
      if (popoverWrap && !popoverWrap.contains(event.target)) closeRegionPopover();
    });
    root.document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeRegionPopover();
    });
    regionMenu?.querySelectorAll("[data-region]").forEach((item) => {
      item.addEventListener("click", () => {
        const region = item.dataset.region;
        closeRegionPopover();
        if (!region) return;
        urlState.setCrRegion(region, { updateUrl: true, push: true });
        renderRegion();
      });
    });

    renderRegionPopover();
    renderRegion();
    renderWindowStepper({ force: true });
    return true;
  }

  const api = Object.freeze({
    mount,
    render,
    renderActiveMap,
    renderRegion,
    renderWindowStepper,
    closeRegionPopover,
  });

  root.UkAqHexMapToolbarController = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
