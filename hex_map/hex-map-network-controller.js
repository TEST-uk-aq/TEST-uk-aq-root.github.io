import networkCatalog from "../shared/data/network-catalog-module.js";

function initHexMapNetworkController(root) {
  "use strict";

  if (!root?.document || !document.body.classList.contains("hex-map-page")) return;

  const catalogClient = networkCatalog;
  if (!catalogClient?.load) {
    throw new Error("The shared UK AQ network catalogue loader must load before the Hex network controller.");
  }

  const list = document.getElementById("network-list");
  const selectAllButton = document.getElementById("network-select-all");
  const keepOneButton = document.getElementById("network-deselect-all");
  const dropdownMenu = document.getElementById("networks-panel-floating");
  const dropdownCount = document.getElementById("network-dropdown-count");
  const panelPin = document.getElementById("networks-panel-pin");
  const panelPinIcon = document.getElementById("networks-panel-pin-icon");
  const pills = Array.from(document.querySelectorAll("[data-networks-pill]"));
  const scopes = new Map();
  const consumers = new Map();
  const STORAGE_KEY = "uk-aq-hex-map-network-selection-v1";
  const initialSelection = readPersistedSelection();

  let catalog = null;
  let catalogByCode = new Map();
  let catalogLoad = null;
  let selectedCodes = initialSelection;
  let activeScope = "uk";
  let renderedKey = "";
  let panelPinned = false;
  let panelAnchorPill = null;
  let panelPinnedWidthPx = null;
  let panelPinnedTopPx = null;
  let panelPinnedLeftPx = null;
  let cachedPanelWidth = 0;

  const PANEL_MARGIN_PX = 8;
  const LONDON_MAP_GAP_PX = -72;
  const PIN_ICON_OFF_SRC = "/images/UK-AQ_pin100_off.svg";
  const PIN_ICON_ON_SRC = "/images/UK-AQ_pin100_on.svg";
  const LOGO_META = Object.freeze({
    gov_uk_aurn: {
      href: "https://www.ukairquality.net/",
      ariaLabel: "Open GOV.UK AURN website (external link)",
      boxClass: "network-card-logo-box--light network-card-logo-box--text",
      text: "GOV.UK AURN",
    },
    openaq: {
      href: "https://openaq.org/",
      ariaLabel: "Open OpenAQ website (external link)",
      boxClass: "network-card-logo-box--light",
      imgSrc: "/sidebar-images/openaq_logo.svg",
      imgAlt: "OpenAQ logo",
      imgClass: "network-card-logo",
    },
    breathelondon: {
      href: "https://www.breathelondon.org/",
      ariaLabel: "Open Breathe London website (external link)",
      boxClass: "network-card-logo-box--light",
      imgSrc: "/sidebar-images/breathelondon_logo_v2.svg",
      imgAlt: "Breathe London logo",
      imgClass: "network-card-logo network-card-logo--breathe",
    },
    laqn: {
      href: "https://www.londonair.org.uk/",
      ariaLabel: "Open London Air LAQN website (external link)",
      boxClass: "network-card-logo-box--light network-card-logo-box--text",
      text: "London Air LAQN",
    },
    sensorcommunity: {
      href: "https://sensor.community/en/",
      ariaLabel: "Open Sensor.Community website (external link)",
      boxClass: "network-card-logo-box--dark",
      imgSrc: "/sidebar-images/scomm_logo_text.svg",
      imgAlt: "Sensor.Community logo",
      imgClass: "network-card-logo",
    },
  });

  if (keepOneButton) {
    keepOneButton.setAttribute("aria-label", "Keep one network selected");
    keepOneButton.title = "Keep one network selected";
  }

  function normalizeCode(value) {
    return String(value || "").trim().toLowerCase();
  }

  function readPersistedSelection() {
    try {
      const stored = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || "null");
      if (stored?.allSelected === true) return null;
      if (Array.isArray(stored?.selected) && stored.selected.length) {
        return new Set(stored.selected.map(normalizeCode).filter(Boolean));
      }
    } catch (error) {
      console.warn("Unable to restore Hex network selection", error);
    }
    return null;
  }

  function getCatalog() {
    return catalog || [];
  }

  function getCatalogByCode(code) {
    return catalogByCode.get(normalizeCode(code)) || null;
  }

  function getCatalogByCodeMap() {
    return catalogByCode;
  }

  function loadCatalog(options = {}) {
    if (catalog) return Promise.resolve(catalog);
    if (catalogLoad) return catalogLoad;

    const request = catalogClient.load({
      url: options.url,
      fetchApi: options.fetchApi,
      init: options.init,
    }).then((rows) => {
      catalog = rows;
      catalogByCode = new Map(rows.map((definition) => [normalizeCode(definition.code), definition]));
      reconcileSelection();
      renderActiveScope({ force: true });
      return catalog;
    });
    catalogLoad = request;
    request.then(
      () => { if (catalogLoad === request) catalogLoad = null; },
      () => { if (catalogLoad === request) catalogLoad = null; },
    );
    return request;
  }

  function selectionSnapshot() {
    return selectedCodes === null ? null : new Set(selectedCodes);
  }

  function selectedEntries() {
    const definitions = getCatalog();
    const selected = selectionSnapshot();
    return definitions
      .filter((definition) => selected === null || selected.has(normalizeCode(definition.code)))
      .map((definition) => ({
        code: normalizeCode(definition.code),
        label: String(definition.label || "").toLowerCase(),
      }));
  }

  function persistSelection() {
    const persistedSelection = selectedCodes === null
      ? { selected: null, allSelected: true }
      : { selected: Array.from(selectedCodes), allSelected: false };
    try {
      root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(persistedSelection));
    } catch (error) {
      console.warn("Unable to persist Hex network selection", error);
    }
  }

  function reconcileSelection() {
    if (!catalog?.length || selectedCodes === null) {
      persistSelection();
      return;
    }
    const available = new Set(catalog.map((definition) => normalizeCode(definition.code)).filter(Boolean));
    const retained = new Set(Array.from(selectedCodes).filter((code) => available.has(code)));
    if (!retained.size) retained.add(normalizeCode(catalog[0].code));
    selectedCodes = retained.size === available.size ? null : retained;
    persistSelection();
  }

  function setSelection(nextSelection, options = {}) {
    const definitions = getCatalog();
    if (!definitions.length) return false;
    const available = new Set(definitions.map((definition) => normalizeCode(definition.code)).filter(Boolean));
    let next = nextSelection === null
      ? null
      : new Set(Array.from(nextSelection || []).map(normalizeCode).filter((code) => available.has(code)));
    if (next !== null && !next.size) return false;
    if (next !== null && next.size === available.size) next = null;

    const before = selectedCodes === null ? null : Array.from(selectedCodes).sort().join("|");
    const after = next === null ? null : Array.from(next).sort().join("|");
    if (before === after) {
      renderActiveScope({ force: true });
      return false;
    }
    selectedCodes = next;
    persistSelection();
    renderActiveScope({ force: true });
    if (options.notify !== false) notifySelectionChange(options.source || "controller");
    return true;
  }

  function notifySelectionChange(source) {
    const detail = { selectedCodes: selectionSnapshot(), allSelected: selectedCodes === null, source };
    const consumer = consumers.get(activeScope);
    if (typeof consumer === "function") consumer(detail);
    root.dispatchEvent(new CustomEvent("networkselectionchange", { detail }));
  }

  function registerScope(scope, consumer) {
    if ((scope === "uk" || scope === "cr") && typeof consumer === "function") {
      consumers.set(scope, consumer);
    }
  }

  function updateScope(scope, presentation = {}) {
    if (scope !== "uk" && scope !== "cr") return false;
    scopes.set(scope, {
      definitions: Array.isArray(presentation.definitions) ? presentation.definitions : [],
      coverageByCode: presentation.coverageByCode instanceof Map ? presentation.coverageByCode : new Map(),
      coverageTotal: Number(presentation.coverageTotal) || 0,
      coverageAreaLabel: String(presentation.coverageAreaLabel || "areas"),
    });
    if (scope === activeScope) renderActiveScope();
    return true;
  }

  function setActiveScope(scope) {
    if (scope !== "uk" && scope !== "cr") return;
    const changed = activeScope !== scope;
    activeScope = scope;
    renderActiveScope({ force: changed });
    syncPanelForActiveScope();
  }

  function presentationKey(presentation) {
    if (!presentation?.definitions?.length) return `${activeScope}:empty`;
    return `${activeScope}:` + presentation.definitions.map((definition) => {
      const code = normalizeCode(definition.code);
      const covered = presentation.coverageByCode.get(code)?.size || 0;
      return `${code}:${definition.label}:${definition.count}:${covered}:${presentation.coverageTotal}`;
    }).join("|");
  }

  function renderActiveScope(options = {}) {
    if (!list) return;
    const presentation = scopes.get(activeScope);
    const key = presentationKey(presentation);
    if (!options.force && key === renderedKey) return;
    renderedKey = key;
    list.replaceChildren();
    if (!presentation?.definitions?.length) {
      const empty = document.createElement("span");
      empty.className = "network-empty";
      empty.textContent = catalog ? "No networks available." : "Loading networks...";
      list.appendChild(empty);
      syncSelectionUi();
      return;
    }

    const totalSensors = presentation.definitions.reduce((sum, definition) => sum + (Number(definition.count) || 0), 0);
    const fragment = document.createDocumentFragment();
    presentation.definitions.forEach((definition) => {
      const code = normalizeCode(definition.code);
      const count = Number(definition.count) || 0;
      const sharePercent = totalSensors ? Math.max(0, Math.min(100, (count / totalSensors) * 100)) : 0;
      const coverageCount = presentation.coverageByCode.get(code)?.size || 0;
      const coveragePercent = presentation.coverageTotal > 0
        ? Math.round((coverageCount / presentation.coverageTotal) * 100)
        : 0;
      const label = document.createElement("label");
      label.className = "checkbox network-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.network = code;
      input.checked = selectedCodes === null || selectedCodes.has(code);
      const mainRow = document.createElement("span");
      mainRow.className = "network-option-main";
      const leftGroup = document.createElement("span");
      leftGroup.className = "network-option-left";
      const nameWrap = document.createElement("span");
      nameWrap.className = "network-name-wrap";
      const name = document.createElement("span");
      name.className = "network-name";
      name.textContent = definition.label;
      nameWrap.appendChild(name);
      if (definition.network_type === "aggregator") {
        const tag = document.createElement("span");
        tag.className = "network-option-tag";
        tag.textContent = "AGGREGATOR";
        nameWrap.appendChild(tag);
      }
      leftGroup.append(input, nameWrap);
      const countText = document.createElement("span");
      countText.className = "network-count";
      if (count > 0) countText.textContent = count.toLocaleString();
      mainRow.append(leftGroup, countText);
      label.title = `${definition.label}\n${count.toLocaleString()} active sensors\n${Math.round(sharePercent)}% of sensors across all available networks`;

      const shareBar = document.createElement("span");
      shareBar.className = "network-share-bar";
      shareBar.setAttribute("role", "progressbar");
      shareBar.setAttribute("aria-label", `${definition.label} share of active sensors`);
      shareBar.setAttribute("aria-valuemin", "0");
      shareBar.setAttribute("aria-valuemax", "100");
      shareBar.setAttribute("aria-valuenow", String(Math.round(sharePercent)));
      shareBar.setAttribute("aria-valuetext", `${Math.round(sharePercent)}% of active sensors`);
      const shareFill = document.createElement("span");
      shareFill.className = "network-share-fill";
      shareFill.style.width = `${sharePercent.toFixed(1)}%`;
      shareBar.appendChild(shareFill);

      const coverageText = document.createElement("span");
      coverageText.className = "network-option-coverage";
      coverageText.textContent = `${coveragePercent}% coverage`;
      coverageText.setAttribute(
        "aria-label",
        `${definition.label} coverage ${coveragePercent}% (${coverageCount} of ${presentation.coverageTotal} ${presentation.coverageAreaLabel})`,
      );
      label.append(mainRow, shareBar, coverageText);
      appendLogo(label, definition);
      fragment.appendChild(label);
    });
    list.appendChild(fragment);
    syncSelectionUi();
  }

  function resolveLogoMeta(definition) {
    const code = normalizeCode(definition?.code);
    if (LOGO_META[code]) return LOGO_META[code];
    const label = String(definition?.label || "").toLowerCase();
    if (label.includes("laqn")) return LOGO_META.laqn;
    if (label.includes("gov_uk_aurn")) return LOGO_META.gov_uk_aurn;
    if (label.includes("openaq")) return LOGO_META.openaq;
    if (label.includes("breathelondon")) return LOGO_META.breathelondon;
    if (label.includes("sensorcommunity")) return LOGO_META.sensorcommunity;
    return null;
  }

  function appendLogo(label, definition) {
    const logoMeta = resolveLogoMeta(definition);
    if (!logoMeta?.href) return;
    const link = document.createElement("a");
    link.className = `network-option-logo-link network-card-logo-link network-card-logo-box ${logoMeta.boxClass || ""}`.trim();
    link.href = logoMeta.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", logoMeta.ariaLabel || `Open ${definition.label} website (external link)`);
    link.addEventListener("mousedown", (event) => event.stopPropagation());
    link.addEventListener("click", (event) => event.stopPropagation());
    if (logoMeta.text) {
      link.appendChild(document.createTextNode(logoMeta.text));
    } else if (logoMeta.imgSrc) {
      const image = document.createElement("img");
      image.className = logoMeta.imgClass || "network-card-logo";
      image.src = logoMeta.imgSrc;
      image.alt = logoMeta.imgAlt || `${definition.label} logo`;
      link.appendChild(image);
    }
    const icon = document.createElement("img");
    icon.className = "network-card-link-icon";
    icon.src = "/images/Link Icon.svg";
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    link.appendChild(icon);
    label.appendChild(link);
  }

  function getInputs() {
    return list ? Array.from(list.querySelectorAll("input[data-network]")) : [];
  }

  function syncSelectionUi() {
    const inputs = getInputs();
    inputs.forEach((input) => {
      input.checked = selectedCodes === null || selectedCodes.has(normalizeCode(input.dataset.network));
      input.closest(".network-option")?.classList.toggle("is-unselected", !input.checked);
    });
    const selectedCount = inputs.filter((input) => input.checked).length;
    if (selectAllButton) selectAllButton.disabled = !inputs.length || selectedCount === inputs.length;
    if (keepOneButton) keepOneButton.disabled = !inputs.length || selectedCount <= 1;
    updateDropdownState(inputs.length, selectedCount);
  }

  function updateDropdownState(total = getInputs().length, selected = getInputs().filter((input) => input.checked).length) {
    if (dropdownCount) dropdownCount.textContent = `${selected} / ${total}`;
    const pillText = total === 0 ? "Networks: —" : selected === total ? "Networks: All" : `Networks: ${selected} / ${total}`;
    pills.forEach((pill) => {
      const text = pill.querySelector(".networks-pill-text");
      if (text) text.textContent = pillText;
    });
    ["top-total-sensors-subtext", "cr-top-total-sensors-subtext"].forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.textContent = total === 0
        ? "from selected networks"
        : selected === total
          ? `from all ${total} networks`
          : `from ${selected} of ${total} networks`;
    });
    if (dropdownMenu?.hidden) refreshPanelWidthCache();
  }

  list?.addEventListener("change", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target.closest("input[data-network]") : null;
    if (!input) return;
    const next = new Set(getInputs().filter((candidate) => candidate.checked).map((candidate) => normalizeCode(candidate.dataset.network)));
    if (!next.size) {
      input.checked = true;
      syncSelectionUi();
      return;
    }
    setSelection(next, { source: "checkbox" });
  });

  selectAllButton?.addEventListener("click", () => setSelection(null, { source: "select-all" }));
  keepOneButton?.addEventListener("click", () => {
    const definitions = scopes.get(activeScope)?.definitions || getCatalog();
    const selected = definitions.map((definition) => normalizeCode(definition.code))
      .filter((code) => selectedCodes === null || selectedCodes.has(code));
    if (selected.length > 1) setSelection(new Set([selected[0]]), { source: "keep-one" });
  });

  function isPillVisible(pill) {
    if (!pill || !document.body.contains(pill)) return false;
    const panel = pill.closest(".tab-panel");
    return panel ? !panel.hidden : true;
  }

  function getActivePill() {
    if (isPillVisible(panelAnchorPill)) return panelAnchorPill;
    return pills.find(isPillVisible) || pills[0] || null;
  }

  function getMapWrap(pill) {
    return pill?.closest(".map-wrap") || null;
  }

  function getFloatingHost(pill) {
    return getMapWrap(pill || getActivePill()) || document.body;
  }

  function clearDockedHosts() {
    document.querySelectorAll(".map-wrap.has-docked-networks").forEach((wrap) => wrap.classList.remove("has-docked-networks"));
    document.querySelectorAll("[data-networks-dock]").forEach((slot) => {
      slot.hidden = true;
      slot.setAttribute("aria-hidden", "true");
    });
  }

  function setFloatingHost(pill = null) {
    if (!dropdownMenu) return;
    clearDockedHosts();
    const host = getFloatingHost(pill);
    if (dropdownMenu.parentElement !== host) host.appendChild(dropdownMenu);
    dropdownMenu.classList.remove("is-docked");
    dropdownMenu.classList.add("is-floating");
    if (!panelPinned) {
      dropdownMenu.style.width = "";
      dropdownMenu.style.top = "";
      dropdownMenu.style.left = "";
      dropdownMenu.style.right = "";
    }
  }

  function getPanelWidth() {
    if (!dropdownMenu) return 0;
    if (Number.isFinite(panelPinnedWidthPx) && panelPinnedWidthPx > 0) return panelPinnedWidthPx;
    if (cachedPanelWidth > 0) return cachedPanelWidth;
    const previous = {
      hidden: dropdownMenu.hidden,
      display: dropdownMenu.style.display,
      visibility: dropdownMenu.style.visibility,
      left: dropdownMenu.style.left,
      top: dropdownMenu.style.top,
    };
    dropdownMenu.hidden = false;
    dropdownMenu.style.display = "flex";
    dropdownMenu.style.visibility = "hidden";
    dropdownMenu.style.left = "-99999px";
    dropdownMenu.style.top = "-99999px";
    cachedPanelWidth = dropdownMenu.getBoundingClientRect().width || 0;
    dropdownMenu.style.display = previous.display;
    dropdownMenu.style.visibility = previous.visibility;
    dropdownMenu.style.left = previous.left;
    dropdownMenu.style.top = previous.top;
    dropdownMenu.hidden = previous.hidden;
    return cachedPanelWidth;
  }

  function refreshPanelWidthCache() {
    cachedPanelWidth = 0;
    getPanelWidth();
  }

  function applyPinnedPlacement() {
    if (!dropdownMenu) return;
    const anchor = panelAnchorPill || getActivePill();
    setFloatingHost(anchor);
    if (Number.isFinite(panelPinnedWidthPx)) dropdownMenu.style.width = `${panelPinnedWidthPx}px`;
    if (Number.isFinite(panelPinnedTopPx)) dropdownMenu.style.top = `${panelPinnedTopPx}px`;
    if (Number.isFinite(panelPinnedLeftPx)) dropdownMenu.style.left = `${panelPinnedLeftPx}px`;
    dropdownMenu.style.right = "auto";
  }

  function updatePanelSafeArea() {
    if (!panelPinned || !dropdownMenu || dropdownMenu.hidden) clearDockedHosts();
    else applyPinnedPlacement();
    let targetWrap = null;
    let targetSafeRight = null;
    const londonActive = activeScope === "cr" && String(root.crMap?.getRegion?.() || "").toLowerCase() === "london";
    if (root.innerWidth > 900 && londonActive && dropdownMenu) {
      const anchor = panelAnchorPill || getActivePill();
      const wrap = getMapWrap(anchor)?.querySelector(".map-canvas-wrap");
      const pillRect = anchor?.getBoundingClientRect?.();
      const panelWidth = getPanelWidth();
      if (wrap && pillRect && panelWidth > 0) {
        const wrapRect = wrap.getBoundingClientRect();
        let left = pillRect.right - panelWidth;
        if (left < PANEL_MARGIN_PX) left = PANEL_MARGIN_PX;
        if (left + panelWidth > root.innerWidth - PANEL_MARGIN_PX) {
          left = Math.max(PANEL_MARGIN_PX, root.innerWidth - panelWidth - PANEL_MARGIN_PX);
        }
        targetWrap = wrap;
        targetSafeRight = `${Math.ceil(Math.max(0, wrapRect.right - left + LONDON_MAP_GAP_PX))}px`;
      }
    }
    document.querySelectorAll(".map-canvas-wrap").forEach((wrap) => {
      wrap.classList.toggle("has-networks-panel-safe-area", wrap === targetWrap && Boolean(targetSafeRight));
      if (wrap === targetWrap && targetSafeRight) wrap.style.setProperty("--networks-panel-safe-right", targetSafeRight);
      else wrap.style.removeProperty("--networks-panel-safe-right");
    });
  }

  function positionPanel(pill) {
    if (!dropdownMenu) return;
    if (!pill) return updatePanelSafeArea();
    if (panelPinned) return applyPinnedPlacement();
    setFloatingHost(pill);
    const host = getFloatingHost(pill);
    const rect = pill.getBoundingClientRect();
    const panelRect = dropdownMenu.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const hostWidth = host === document.body ? root.innerWidth : hostRect.width;
    const hostHeight = host === document.body ? root.innerHeight : hostRect.height;
    let top = rect.bottom - hostRect.top + PANEL_MARGIN_PX;
    let left = rect.right - hostRect.left - panelRect.width;
    if (left < PANEL_MARGIN_PX) left = PANEL_MARGIN_PX;
    if (left + panelRect.width > hostWidth - PANEL_MARGIN_PX) left = Math.max(PANEL_MARGIN_PX, hostWidth - panelRect.width - PANEL_MARGIN_PX);
    if (top + panelRect.height > hostHeight - PANEL_MARGIN_PX) {
      const flippedTop = rect.top - hostRect.top - panelRect.height - PANEL_MARGIN_PX;
      if (flippedTop >= PANEL_MARGIN_PX) top = flippedTop;
    }
    dropdownMenu.style.top = `${Math.max(PANEL_MARGIN_PX, top)}px`;
    dropdownMenu.style.left = `${left}px`;
    dropdownMenu.style.right = "auto";
    updatePanelSafeArea();
  }

  function setPanelOpen(isOpen, anchorPill) {
    if (!dropdownMenu) return;
    dropdownMenu.hidden = !isOpen;
    if (isOpen) {
      panelAnchorPill = anchorPill || getActivePill();
      root.requestAnimationFrame(() => positionPanel(panelAnchorPill));
    } else {
      if (!panelPinned) panelAnchorPill = null;
      setFloatingHost();
      updatePanelSafeArea();
    }
    pills.forEach((pill) => pill.setAttribute("aria-expanded", String(isOpen && pill === panelAnchorPill)));
  }

  function setPanelPinned(nextPinned) {
    panelPinned = Boolean(nextPinned);
    if (!panelPinned) {
      panelPinnedWidthPx = null;
      panelPinnedTopPx = null;
      panelPinnedLeftPx = null;
    } else if (dropdownMenu && !dropdownMenu.hidden) {
      const rect = dropdownMenu.getBoundingClientRect();
      const anchor = panelAnchorPill || getActivePill();
      const hostRect = getFloatingHost(anchor).getBoundingClientRect();
      panelPinnedWidthPx = rect.width || null;
      panelPinnedTopPx = rect.top - hostRect.top;
      panelPinnedLeftPx = rect.left - hostRect.left;
    }
    panelPin?.setAttribute("aria-pressed", String(panelPinned));
    panelPin?.setAttribute("aria-label", panelPinned ? "Unpin networks panel" : "Pin networks panel");
    panelPin?.setAttribute("title", panelPinned ? "Unpin networks panel" : "Pin networks panel");
    if (panelPinIcon) panelPinIcon.src = panelPinned ? PIN_ICON_ON_SRC : PIN_ICON_OFF_SRC;
    if (dropdownMenu && !dropdownMenu.hidden) root.requestAnimationFrame(() => positionPanel(panelAnchorPill || getActivePill()));
    else if (!panelPinned) setFloatingHost();
    updatePanelSafeArea();
  }

  function syncPanelForActiveScope() {
    if (panelPinned && dropdownMenu && !dropdownMenu.hidden) {
      panelAnchorPill = getActivePill();
      pills.forEach((pill) => pill.setAttribute("aria-expanded", String(pill === panelAnchorPill)));
      root.requestAnimationFrame(() => positionPanel(panelAnchorPill));
    } else {
      setPanelOpen(false);
    }
    updateDropdownState();
    root.requestAnimationFrame(updatePanelSafeArea);
  }

  pills.forEach((pill) => pill.addEventListener("click", () => {
    root.UkAqHexMapToolbarController?.closeRegionPopover?.();
    const isOpen = !(dropdownMenu?.hidden ?? true);
    setPanelOpen(!(isOpen && panelAnchorPill === pill), pill);
    updateDropdownState();
  }));
  panelPin?.addEventListener("click", () => setPanelPinned(!panelPinned));
  document.addEventListener("mousedown", (event) => {
    if (panelPinned || !dropdownMenu || dropdownMenu.hidden) return;
    if (pills.some((pill) => pill.contains(event.target)) || dropdownMenu.contains(event.target)) return;
    setPanelOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panelPinned) setPanelOpen(false);
  });
  root.addEventListener("resize", () => {
    cachedPanelWidth = 0;
    if (dropdownMenu && !dropdownMenu.hidden && !panelPinned) positionPanel(panelAnchorPill || getActivePill());
    updatePanelSafeArea();
  });
  root.addEventListener("scroll", () => {
    if (dropdownMenu && !dropdownMenu.hidden && !panelPinned) positionPanel(panelAnchorPill || getActivePill());
  }, { passive: true });
  root.addEventListener("crregionchange", () => root.requestAnimationFrame(updatePanelSafeArea));

  persistSelection();
  syncSelectionUi();
  setPanelPinned(false);

  return Object.freeze({
    loadCatalog,
    getCatalog,
    getCatalogByCode,
    getCatalogByCodeMap,
    getSelection: selectionSnapshot,
    getSelectedEntries: selectedEntries,
    setSelection,
    registerScope,
    updateScope,
    setActiveScope,
    closePanel: () => setPanelOpen(false),
    syncPanelForActiveScope,
  });
}

const networkController = initHexMapNetworkController(globalThis);
export default networkController;
