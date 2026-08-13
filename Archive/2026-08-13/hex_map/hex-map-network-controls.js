(function initHexMapKeepOneNetwork() {
  "use strict";

  if (!document.body.classList.contains("hex-map-page")) return;
  const list = document.getElementById("network-list");
  const keepOneButton = document.getElementById("network-deselect-all");
  if (!list || !keepOneButton) return;

  keepOneButton.setAttribute("aria-label", "Keep one network selected");
  keepOneButton.title = "Keep one network selected";

  function networkInputs() {
    return Array.from(list.querySelectorAll('input[type="checkbox"]'));
  }

  function syncKeepOneState() {
    const inputs = networkInputs();
    const selectedCount = inputs.filter((input) => input.checked).length;
    keepOneButton.disabled = !inputs.length || selectedCount <= 1;
  }

  document.addEventListener("change", (event) => {
    const input = event.target instanceof HTMLInputElement
      ? event.target.closest('#network-list input[type="checkbox"]')
      : null;
    if (!input) return;
    const inputs = networkInputs();
    if (!inputs.some((candidate) => candidate.checked)) {
      input.checked = true;
    }
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("#network-deselect-all")
      : null;
    if (target !== keepOneButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const inputs = networkInputs();
    const selected = inputs.filter((input) => input.checked);
    if (selected.length <= 1) {
      syncKeepOneState();
      return;
    }

    const changed = selected.slice(1);
    changed.forEach((input) => {
      input.checked = false;
    });
    changed[0].dispatchEvent(new Event("change", { bubbles: true }));
    syncKeepOneState();
  }, true);

  window.addEventListener("networkselectionchange", syncKeepOneState);
  const observer = new MutationObserver(syncKeepOneState);
  observer.observe(list, { childList: true, subtree: true });
  syncKeepOneState();
})();

(function installNetworkScopeDropdownGuard(root) {
  "use strict";

  if (!root?.document || typeof Object.defineProperty !== "function") return;
  const nodesByScope = { uk: null, cr: null };
  const guardedMaps = new WeakSet();

  function networkList() {
    return root.document.getElementById("network-list");
  }

  function activeScope() {
    const tab = root.mapTabController?.getActiveTab?.();
    return tab === "uk" || tab === "cr" ? tab : null;
  }

  function rememberScope(scope, list) {
    if (!list || (scope !== "uk" && scope !== "cr")) return;
    nodesByScope[scope] = Array.from(list.childNodes);
  }

  function sameNodes(left, right) {
    return left.length === right.length && left.every((node, index) => node === right[index]);
  }

  function applySharedSelection(list) {
    if (!list) return;
    const state = root.mapNetworkState?.shared;
    if (!state) return;
    const selected = Array.isArray(state.selected)
      ? new Set(state.selected.map((code) => String(code || "").toLowerCase()))
      : null;
    const selectAll = selected === null && state.allSelected !== false;
    Array.from(list.querySelectorAll("input[data-network]")).forEach((input) => {
      const code = String(input.dataset.network || "").toLowerCase();
      input.checked = selected ? selected.has(code) : selectAll;
    });
  }

  function restoreRememberedScope(scope, list) {
    const nodes = nodesByScope[scope];
    if (!list || !Array.isArray(nodes) || !nodes.length) return false;
    list.replaceChildren(...nodes);
    applySharedSelection(list);
    return true;
  }

  function restoreActiveScope(scope, list) {
    const map = scope === "uk" ? root.ukMap : scope === "cr" ? root.crMap : null;
    if (typeof map?.restoreNetworks === "function") {
      map.restoreNetworks();
      return true;
    }
    return restoreRememberedScope(scope, list);
  }

  function guardMap(map, scope) {
    if (!map || typeof map !== "object" || guardedMaps.has(map)) return map;
    guardedMaps.add(map);
    const originalRestoreNetworks = map.restoreNetworks;
    if (typeof originalRestoreNetworks === "function") {
      map.restoreNetworks = function guardedRestoreNetworks(...args) {
        const list = networkList();
        if (list && activeScope() === scope) restoreRememberedScope(scope, list);
        const result = originalRestoreNetworks.apply(this, args);
        if (list && activeScope() === scope) rememberScope(scope, list);
        return result;
      };
    }
    const originalEnsureSearchDataLoaded = map.ensureSearchDataLoaded;
    if (typeof originalEnsureSearchDataLoaded === "function") {
      map.ensureSearchDataLoaded = async function guardedEnsureSearchDataLoaded(...args) {
        const list = networkList();
        const activeBefore = activeScope();
        if (!list || !activeBefore || activeBefore === scope) {
          const result = await originalEnsureSearchDataLoaded.apply(this, args);
          if (list && activeScope() === scope) rememberScope(scope, list);
          return result;
        }
        const activeNodesBefore = Array.from(list.childNodes);
        rememberScope(activeBefore, list);
        try {
          return await originalEnsureSearchDataLoaded.apply(this, args);
        } finally {
          const renderedNodes = Array.from(list.childNodes);
          const didReplaceRows = !sameNodes(activeNodesBefore, renderedNodes);
          const activeAfter = activeScope();
          if (didReplaceRows) rememberScope(scope, list);
          if (didReplaceRows && activeAfter === activeBefore) {
            restoreActiveScope(activeBefore, list);
            applySharedSelection(list);
            rememberScope(activeBefore, list);
          } else if (activeAfter === scope) {
            applySharedSelection(list);
            rememberScope(scope, list);
          }
        }
      };
    }
    return map;
  }

  function hookMapProperty(propertyName, scope) {
    const descriptor = Object.getOwnPropertyDescriptor(root, propertyName);
    if (descriptor && !descriptor.configurable) {
      guardMap(root[propertyName], scope);
      return;
    }
    let value = guardMap(root[propertyName], scope);
    Object.defineProperty(root, propertyName, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return value; },
      set(nextValue) { value = guardMap(nextValue, scope); },
    });
  }

  hookMapProperty("ukMap", "uk");
  hookMapProperty("crMap", "cr");
})(typeof globalThis !== "undefined" ? globalThis : this);
