// Thin Hex Map adapter for the shared pollutant-context controller.
(function (root, factory) {
  function installNetworkScopeDropdownGuard() {
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

    function guardMap(map, scope) {
      if (!map || typeof map !== "object" || guardedMaps.has(map)) return map;
      guardedMaps.add(map);

      const originalRestoreNetworks = map.restoreNetworks;
      if (typeof originalRestoreNetworks === "function") {
        map.restoreNetworks = function guardedRestoreNetworks(...args) {
          const list = networkList();
          if (list && activeScope() === scope) {
            restoreRememberedScope(scope, list);
          }
          const result = originalRestoreNetworks.apply(this, args);
          if (list && activeScope() === scope) {
            rememberScope(scope, list);
          }
          return result;
        };
      }

      const originalEnsureSearchDataLoaded = map.ensureSearchDataLoaded;
      if (typeof originalEnsureSearchDataLoaded === "function") {
        map.ensureSearchDataLoaded = async function guardedEnsureSearchDataLoaded(...args) {
          const list = networkList();
          const activeBefore = activeScope();

          // If this scope is active, its normal rendering owns the shared dropdown.
          if (!list || !activeBefore || activeBefore === scope) {
            const result = await originalEnsureSearchDataLoaded.apply(this, args);
            if (list && activeScope() === scope) rememberScope(scope, list);
            return result;
          }

          // The inactive scope may preload and calculate its own counts, but it must
          // not leave those scope-specific rows in the single shared dropdown.
          const activeNodesBefore = Array.from(list.childNodes);
          rememberScope(activeBefore, list);

          try {
            return await originalEnsureSearchDataLoaded.apply(this, args);
          } finally {
            const renderedNodes = Array.from(list.childNodes);
            const didReplaceRows = !sameNodes(activeNodesBefore, renderedNodes);
            const activeAfter = activeScope();

            if (didReplaceRows) {
              rememberScope(scope, list);
            }

            if (didReplaceRows && activeAfter === activeBefore) {
              list.replaceChildren(...activeNodesBefore);
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
        get() {
          return value;
        },
        set(nextValue) {
          value = guardMap(nextValue, scope);
        },
      });
    }

    // These hooks are installed before the inline Hex Map controllers are created,
    // so even the initial forced background search preload is scope-safe.
    hookMapProperty("ukMap", "uk");
    hookMapProperty("crMap", "cr");
  }

  installNetworkScopeDropdownGuard();

  const domain = root.UkAqStationChartDomain
    || (typeof module === "object" && module.exports ? require("../station_chart/station-chart-domain.js") : null);
  const api = factory(domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqHexMapStationChartAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain) {
  "use strict";

  if (!domain) throw new Error("UkAqStationChartDomain is required");

  function createHexMapStationChartAdapter(options = {}) {
    const eventTarget = options.eventTarget || (typeof window !== "undefined" ? window : null);
    const controller = options.controller;
    if (!controller?.setPollutantContext) throw new Error("pollutant_context_controller_required");
    let mounted = false;

    function selection() {
      const value = typeof options.getSelection === "function" ? options.getSelection() : {};
      return value && typeof value === "object" ? value : {};
    }

    function request(pollutant) {
      const normalized = domain.normalizePollutant(pollutant);
      if (!normalized || (typeof options.isActive === "function" && !options.isActive())) return false;
      void controller.setPollutantContext({
        pollutant: normalized,
        entries: [],
        status: "loading",
        preserveRange: true,
        preserveSelection: true,
        ...selection(),
      });
      return true;
    }

    function resolveStatus(context, explicitStatus) {
      const status = String(explicitStatus || context?.dataStatus || "").trim().toLowerCase();
      if (status === "failed") return "failed";
      const pollutant = domain.normalizePollutant(context?.pollutant);
      const loadedPollutant = domain.normalizePollutant(context?.loadedPollutant);
      return status === "ready" && pollutant && loadedPollutant === pollutant ? "ready" : "loading";
    }

    function sync(context, explicitStatus) {
      if (!context || (typeof options.isActive === "function" && !options.isActive(context.mapKey))) return false;
      const pollutant = domain.normalizePollutant(context.pollutant);
      if (!pollutant) return false;
      const status = resolveStatus(context, explicitStatus);
      void controller.setPollutantContext({
        pollutant,
        entries: status === "ready" ? (Array.isArray(context.entries) ? context.entries : []) : [],
        status,
        preserveRange: true,
        preserveSelection: true,
        ...selection(),
      });
      return true;
    }

    function handlePollutantChange(event) {
      request(event?.detail?.pollutant);
    }

    function mount() {
      if (mounted || !eventTarget?.addEventListener) return false;
      eventTarget.addEventListener("pollutantchange", handlePollutantChange);
      mounted = true;
      return true;
    }

    function destroy() {
      if (mounted && eventTarget?.removeEventListener) {
        eventTarget.removeEventListener("pollutantchange", handlePollutantChange);
      }
      mounted = false;
    }

    return Object.freeze({
      mount,
      destroy,
      request,
      sync,
      resolveStatus,
      get mounted() { return mounted; },
    });
  }

  return { createHexMapStationChartAdapter };
});
