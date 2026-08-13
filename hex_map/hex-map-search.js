// Page-lifetime Hex Map search controller for UK and countries/regions.
(function (root) {
  "use strict";

  function syncActiveTabInput(tabKey) {
    const isUk = tabKey === "uk";
    const fromInput = document.getElementById(isUk ? "cr-map-search-input" : "uk-map-search-input");
    const toInput = document.getElementById(isUk ? "uk-map-search-input" : "cr-map-search-input");
    if (!fromInput || !toInput) return;
    const text = fromInput.value;
    toInput.value = text;
    const toClear = toInput.closest("[data-map-search]")?.querySelector(".map-search-clear");
    if (toClear) toClear.hidden = !text;
  }

  function preloadInactiveMap(tabKey) {
    if (tabKey === "uk") {
      void root.crMap?.ensureSearchDataLoaded?.();
    } else {
      void root.ukMap?.ensureSearchDataLoaded?.();
    }
  }

  function createHexMapSearchController() {
  const searchRoots = Array.from(document.querySelectorAll("[data-map-search]"));
  if (!searchRoots.length) {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const postcodeSuggestUrl = String(params.get("postcode_suggest_url") || "").trim() || "/api/aq/postcode_suggest";
  const postcodeLookupUrl = String(params.get("postcode_lookup_url") || "").trim() || "/api/aq/postcode_lookup";
  const postcodeSuggestUrlCandidates = [postcodeSuggestUrl];
  const postcodeLookupUrlCandidates = [postcodeLookupUrl];
  let workingPostcodeSuggestUrl = null;
  let workingPostcodeLookupUrl = null;
  const failedPostcodeSuggestUrls = new Set();
  const failedPostcodeLookupUrls = new Set();
  let postcodeSuggestDisabled = false;
  let postcodeLookupDisabled = false;
  const MAX_RESULTS = 6;
  const MAX_PER_TYPE = 2;
  const MAX_LIMIT = 10;
  const POSTCODE_DEBOUNCE_MS = 250;
  const LOCAL_SEARCH_MIN_CHARS = 1;
  const MOBILE_BREAKPOINT_QUERY = "(max-width: 720px)";
  const POSTCODE_PREFIX_HINTS_URL = "/api/aq/postcode_prefix_hints";

  let prefixHintsCache = null;

  async function loadPrefixHints() {
    try {
      const response = await window.ukAqFetchCacheApi(POSTCODE_PREFIX_HINTS_URL);
      const bodyText = await response.text();
      if (!response.ok) {
        const debug = window.ukAqWebsiteDebugLog;
        if (debug?.enabled?.()) {
          const capped = debug.capText?.(bodyText, 4096) || { text: String(bodyText || "").slice(0, 4096), bytes: String(bodyText || "").length, truncated: String(bodyText || "").length > 4096 };
          debug.recordEvent?.("postcode_prefix_hints_failed", {
            route: "postcode_prefix_hints",
            url: debug.sanitizeUrl?.(POSTCODE_PREFIX_HINTS_URL) || POSTCODE_PREFIX_HINTS_URL,
            status: response.status,
            status_text: response.statusText || "",
            headers: debug.redactHeaders?.(response.headers) || {},
            body_text_summary: debug.parseBodyJson?.(JSON.stringify({ body_text: capped.text })) || { truncated: capped.truncated, preview: capped.text },
            body_json_summary: debug.parseBodyJson?.(capped.text) || null,
            body_bytes: capped.bytes,
            body_truncated: capped.truncated,
          });
          void debug.flush?.("postcode-prefix-hints-failed");
        }
        return;
      }
      let payload = null;
      try {
        payload = JSON.parse(bodyText || "{}");
      } catch (error) {
        window.ukAqWebsiteDebugLog?.recordEvent?.("postcode_prefix_hints_malformed", {
          route: "postcode_prefix_hints",
          url: window.ukAqWebsiteDebugLog?.sanitizeUrl?.(POSTCODE_PREFIX_HINTS_URL) || POSTCODE_PREFIX_HINTS_URL,
          status: response.status,
          body_preview: String(bodyText || "").slice(0, 4096),
          error: { message: error instanceof Error ? error.message : String(error) },
        });
        void window.ukAqWebsiteDebugLog?.flush?.("postcode-prefix-hints-malformed");
        return;
      }
      if (payload?.ok && payload.postcode_samples_1 && payload.postcode_samples_2) {
        prefixHintsCache = payload;
      }
    } catch (_err) {
      // best-effort; fall back to API fetch on demand
    }
  }

  function getHintRows(normalizedQuery) {
    if (!prefixHintsCache) return null;
    const sampleList = normalizedQuery.length === 1
      ? prefixHintsCache.postcode_samples_1[normalizedQuery]
      : prefixHintsCache.postcode_samples_2[normalizedQuery];
    if (!Array.isArray(sampleList) || !sampleList.length) return null;
    const requestLimit = parseLimit(params.get("search_limit"), MAX_RESULTS);
    return sampleList.slice(0, requestLimit).map((row) => ({
      group: "postcode",
      kind: "postcode",
      type_label: getResultTypeLabel("postcode"),
      postcode: row.postcode,
      postcode_normalised: row.postcode_normalised,
      area_name: row.area_name || null,
      post_town: row.post_town || null,
      area_town_id: null,
      pcon_code: normalizeCode(row.pcon_code),
      la_code: normalizeCode(row.la_code),
      primary: row.postcode || row.postcode_normalised,
      secondary: buildPostcodeLabel("", row.area_name, row.post_town),
    }));
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function normalizePostcode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function normalizeCode(value) {
    const code = typeof value === "string" ? value.trim().toUpperCase() : "";
    return code || null;
  }

  function parseLimit(rawValue, fallback) {
    const parsed = Number.parseInt(rawValue ?? "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(MAX_LIMIT, Math.max(1, parsed));
  }

  function looksLikePostcodePrefix(value) {
    const compact = normalizePostcode(value);
    if (!compact || compact.length > 7 || !/^[A-Z0-9]+$/.test(compact)) {
      return false;
    }
    if (!/^[A-Z]/.test(compact)) {
      return false;
    }
    if (compact.length <= 2) {
      return /^[A-Z][A-Z0-9]?$/.test(compact);
    }
    if (compact.length === 3) {
      return /^[A-Z]{1,2}\d[A-Z0-9]?$/.test(compact);
    }
    return /^[A-Z]{1,2}\d[A-Z0-9]{1,4}$/.test(compact);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildPostcodeLabel(postcode, areaName, postTown) {
    const trimmedPostcode = String(postcode || "").trim();
    const area = String(areaName || "").trim();
    const town = String(postTown || "").trim();
    const parts = [];
    if (trimmedPostcode) {
      parts.push(trimmedPostcode);
    }
    if (area && town) {
      if (normalizeText(area) === normalizeText(town)) {
        parts.push(area);
      } else {
        parts.push(area, town);
      }
    } else if (area) {
      parts.push(area);
    } else if (town) {
      parts.push(town);
    }
    return parts.join(", ");
  }

  function getResultTypeLabel(kind) {
    if (kind === "postcode" || kind === "postcode_hint") {
      return "POSTCODE";
    }
    if (kind === "constituency") {
      return "CONSTITUENCY";
    }
    if (kind === "local_authority") {
      return "LOCAL\nAUTHORITY";
    }
    if (kind === "sensor") {
      return "SENSOR";
    }
    return "RESULT";
  }

  function isMobileSearch() {
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  }

  function getActiveTab() {
    if (window.mapTabController?.getActiveTab) {
      return window.mapTabController.getActiveTab();
    }
    return window.UkAqHexMapCoordinator?.getActiveMap?.() || "uk";
  }

  function switchToUkTab() {
    if (window.mapTabController?.switchToUk) {
      window.mapTabController.switchToUk({ updateUrl: true, push: false });
      return;
    }
    document.getElementById("tab-uk")?.click();
  }

  function switchToCrTab(region) {
    if (window.mapTabController?.switchToCr) {
      window.mapTabController.switchToCr(region, { updateUrl: true, push: false });
      return;
    }
    document.getElementById("tab-cr")?.click();
  }

  function selectPconByCode(code) {
    if (!code || !window.ukMap?.selectPconByCode) {
      return false;
    }
    return Boolean(window.ukMap.selectPconByCode(code));
  }

  function selectLaByCode(code) {
    if (!code || !window.crMap?.selectAreaByCode) {
      return false;
    }
    return Boolean(window.crMap.selectAreaByCode(code, { allowRegionSwitch: true, updateUrl: true }));
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function ensureUkSearchDataLoaded() {
    if (!window.ukMap?.ensureSearchDataLoaded) {
      return false;
    }
    try {
      return Boolean(await window.ukMap.ensureSearchDataLoaded());
    } catch (error) {
      console.warn("uk_aq UK search ensure failed", error);
      return false;
    }
  }

  async function ensureCrSearchDataLoaded() {
    if (!window.crMap?.ensureSearchDataLoaded) {
      return false;
    }
    try {
      return Boolean(await window.crMap.ensureSearchDataLoaded());
    } catch (error) {
      console.warn("uk_aq C&R search ensure failed", error);
      return false;
    }
  }

  async function selectConstituencyCode(code) {
    const normalized = normalizeCode(code);
    if (!normalized) {
      return false;
    }
    switchToUkTab();
    await ensureUkSearchDataLoaded();
    if (selectPconByCode(normalized)) {
      return true;
    }
    await delay(120);
    return selectPconByCode(normalized);
  }

  async function selectLocalAuthorityCode(code, regionName = null) {
    const normalized = normalizeCode(code);
    if (!normalized) {
      return false;
    }
    switchToCrTab(regionName || null);
    await ensureCrSearchDataLoaded();
    if (selectLaByCode(normalized)) {
      return true;
    }
    await delay(120);
    return selectLaByCode(normalized);
  }

  function makeRequestUrl(basePath, paramsObject) {
    const requestUrl = new URL(basePath, window.location.origin);
    Object.entries(paramsObject).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") {
        return;
      }
      requestUrl.searchParams.set(key, String(value));
    });
    return requestUrl.toString();
  }

  async function safeReadJson(response) {
    try {
      return await response.json();
    } catch (_err) {
      return null;
    }
  }

  async function fetchPostcodeSuggestions(query, signal, limit) {
    if (postcodeSuggestDisabled) {
      const error = new Error("Postcode search unavailable");
      error.status = 503;
      throw error;
    }
    const baseCandidates = workingPostcodeSuggestUrl
      ? [workingPostcodeSuggestUrl]
      : postcodeSuggestUrlCandidates;
    const candidates = baseCandidates.filter((url) => !failedPostcodeSuggestUrls.has(url));
    if (!candidates.length) {
      postcodeSuggestDisabled = true;
      const error = new Error("Postcode search unavailable");
      error.status = 503;
      throw error;
    }
    let lastError = null;
    for (const baseUrl of candidates) {
      const requestUrl = makeRequestUrl(baseUrl, {
        q: query,
        limit,
      });
      const response = await window.ukAqFetchCacheApi(requestUrl, { signal });
      const payload = await safeReadJson(response);
      if (!response.ok) {
        if (response.status === 404 && !workingPostcodeSuggestUrl) {
          failedPostcodeSuggestUrls.add(baseUrl);
          continue;
        }
        if (response.status === 400) {
          workingPostcodeSuggestUrl = baseUrl;
          return [];
        }
        const message = payload?.message || "Postcode search unavailable";
        const error = new Error(message);
        error.status = response.status;
        lastError = error;
        if (!workingPostcodeSuggestUrl && (response.status === 401 || response.status === 403 || response.status === 405)) {
          failedPostcodeSuggestUrls.add(baseUrl);
          continue;
        }
        throw error;
      }
      workingPostcodeSuggestUrl = baseUrl;
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      return rows.map((row) => {
        if (row?.type === "postcode_hint") {
          return null;
        }
        const postcode = String(row?.postcode || "").trim();
        const postcodeNormalised = normalizePostcode(row?.postcode_normalised || postcode);
        const areaName = String(row?.area_name || "").trim();
        const postTown = String(row?.post_town || "").trim();
        const pconCode = normalizeCode(row?.pcon_code);
        const laCode = normalizeCode(row?.la_code);
        return {
          group: "postcode",
          kind: "postcode",
          type_label: getResultTypeLabel("postcode"),
          postcode,
          postcode_normalised: postcodeNormalised,
          area_name: areaName || null,
          post_town: postTown || null,
          area_town_id: Number.isFinite(Number(row?.area_town_id)) ? Number(row.area_town_id) : null,
          pcon_code: pconCode,
          la_code: laCode,
          primary: postcode || postcodeNormalised,
          secondary: buildPostcodeLabel("", areaName, postTown),
        };
      }).filter((row) => row?.primary);
    }
    postcodeSuggestDisabled = true;
    if (lastError) {
      throw lastError;
    }
    const error = new Error("Postcode search unavailable");
    error.status = 503;
    throw error;
  }

  async function fetchExactPostcode(postcode) {
    if (postcodeLookupDisabled) {
      const error = new Error("Postcode lookup unavailable");
      error.status = 503;
      throw error;
    }
    const baseCandidates = workingPostcodeLookupUrl
      ? [workingPostcodeLookupUrl]
      : postcodeLookupUrlCandidates;
    const candidates = baseCandidates.filter((url) => !failedPostcodeLookupUrls.has(url));
    if (!candidates.length) {
      postcodeLookupDisabled = true;
      const error = new Error("Postcode lookup unavailable");
      error.status = 503;
      throw error;
    }
    let lastError = null;
    for (const baseUrl of candidates) {
      const requestUrl = makeRequestUrl(baseUrl, { postcode });
      const response = await window.ukAqFetchCacheApi(requestUrl);
      const payload = await safeReadJson(response);
      if (!response.ok || payload?.ok === false) {
        const status = response.status || 500;
        if (status === 404 && !workingPostcodeLookupUrl) {
          failedPostcodeLookupUrls.add(baseUrl);
          continue;
        }
        const error = new Error(payload?.message || "Postcode lookup unavailable");
        error.status = status;
        error.code = payload?.error || null;
        lastError = error;
        if (!workingPostcodeLookupUrl && (status === 401 || status === 403 || status === 405)) {
          failedPostcodeLookupUrls.add(baseUrl);
          continue;
        }
        throw error;
      }
      workingPostcodeLookupUrl = baseUrl;
      return payload || {};
    }
    postcodeLookupDisabled = true;
    if (lastError) {
      throw lastError;
    }
    const error = new Error("Postcode lookup unavailable");
    error.status = 503;
    throw error;
  }

  function buildConstituencySearchIndex() {
    const rows = window.ukMap?.getConstituencySearchRecords?.() || [];
    return rows.map((row) => {
      const code = normalizeCode(row?.code);
      const name = String(row?.name || "").trim();
      if (!code || !name) {
        return null;
      }
      return {
        group: "constituency",
        kind: "constituency",
        type_label: getResultTypeLabel("constituency"),
        code,
        primary: name,
        secondary: row.region || "",
        _nameNorm: normalizeText(name),
        _searchNorm: normalizeText(name),
      };
    }).filter(Boolean);
  }

  function buildLocalAuthoritySearchIndex() {
    const rows = window.crMap?.getLocalAuthoritySearchRecords?.() || [];
    return rows.map((row) => {
      const code = normalizeCode(row?.code);
      const name = String(row?.name || "").trim();
      const regionName = String(row?.region_name || "").trim();
      if (!code || !name) {
        return null;
      }
      return {
        group: "local_authority",
        kind: "local_authority",
        type_label: getResultTypeLabel("local_authority"),
        code,
        region_name: regionName || null,
        primary: name,
        secondary: regionName || "",
        _nameNorm: normalizeText(name),
        _searchNorm: normalizeText(`${name} ${regionName}`),
      };
    }).filter(Boolean);
  }

  function buildSensorSearchIndex() {
    const rows = window.ukMap?.getSensorSearchRecords?.() || [];
    return rows.map((row) => {
      const stationName = String(row?.station_name || "").trim();
      if (!stationName) return null;
      const stationId = String(row?.station_id || "").trim();
      const networkName = String(row?.network_label || "").trim();
      return {
        group: "sensor",
        kind: "sensor",
        type_label: getResultTypeLabel("sensor"),
        station_id: stationId || null,
        pcon_code: normalizeCode(row?.pcon_code),
        la_code: normalizeCode(row?.la_code),
        primary: stationName,
        secondary: networkName || "",
        _nameNorm: normalizeText(stationName),
        _searchNorm: normalizeText(`${stationName} ${networkName}`),
      };
    }).filter(Boolean);
  }

  function rankLocalMatches(records, rawQuery) {
    const queryNorm = normalizeText(rawQuery);
    const queryCode = normalizePostcode(rawQuery);
    if (!queryNorm) {
      return [];
    }
    const scored = [];
    records.forEach((record) => {
      const code = normalizeCode(record?.code || record?.station_id);
      const nameNorm = record?._nameNorm || "";
      const searchNorm = record?._searchNorm || nameNorm;
      let score = Number.POSITIVE_INFINITY;
      if (code && queryCode && code === queryCode) {
        score = 0;
      } else if (nameNorm === queryNorm) {
        score = 1;
      } else if (nameNorm.startsWith(queryNorm)) {
        score = 2;
      } else if (searchNorm.split(" ").some((token) => token.startsWith(queryNorm))) {
        score = 3;
      } else if (searchNorm.includes(queryNorm)) {
        score = 4;
      } else {
        return;
      }
      scored.push({ score, record });
    });
    scored.sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.record.primary.localeCompare(right.record.primary, undefined, { sensitivity: "base" });
    });
    return scored.map((entry) => entry.record);
  }

  function mergeSearchResults(groups, limit) {
    const orderedTypes = ["postcode", "sensor", "constituency", "local_authority"];
    const typePriority = new Map(orderedTypes.map((type, index) => [type, index]));
    const pools = {};
    orderedTypes.forEach((type) => {
      pools[type] = Array.isArray(groups[type]) ? [...groups[type]] : [];
    });
    const output = [];

    orderedTypes.forEach((type) => {
      const pool = pools[type];
      let taken = 0;
      while (pool.length && output.length < limit && taken < MAX_PER_TYPE) {
        output.push(pool.shift());
        taken += 1;
      }
    });

    orderedTypes.forEach((type) => {
      const pool = pools[type];
      while (pool.length && output.length < limit) {
        output.push(pool.shift());
      }
    });

    // Keep strict display grouping by type priority while preserving ranking within each type.
    output.sort((left, right) => {
      const leftPriority = typePriority.get(left?.group) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = typePriority.get(right?.group) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority;
    });

    return output;
  }

  function buildResultMarkup(result, index, isActive, context) {
    const activeClass = isActive ? " is-active" : "";
    const noDataFill = getComputedStyle(document.documentElement).getPropertyValue("--no-data").trim() || "#efe6d8";
    const kind = context?.kind || "uk";
    const getSensorColor = context?.getSensorColor || (() => null);
    const pollutantLabel = context?.pollutantLabel || "PM2.5";
    const getPconColor = (code) => {
      const value = window.ukMap?.getPconMetricValue?.(code);
      if (!Number.isFinite(value)) return null;
      return window.ukMap?.applyColorScale?.(value) ?? window.crMap?.applyColorScale?.(value) ?? null;
    };
    const getLaColor = (code) => {
      const value = window.crMap?.getUniversalLaMetricValue?.(code);
      if (!Number.isFinite(value)) return null;
      return window.crMap?.applyColorScale?.(value) ?? window.ukMap?.applyColorScale?.(value) ?? null;
    };

    function makeHexSvg(fillColor) {
      // fillColor is null when no data
      const fill = fillColor || noDataFill;
      const isNoData = fillColor === null;
      const pts = [0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = deg * Math.PI / 180;
        return `${(10 + 9 * Math.cos(rad)).toFixed(1)},${(10 + 9 * Math.sin(rad)).toFixed(1)}`;
      }).join(" ");
      const stroke = isNoData ? "rgba(20,34,37,0.2)" : "rgba(0,0,0,0.18)";
      return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><polygon points="${pts}" fill="${escapeHtml(fill)}" stroke="${stroke}" stroke-width="1"/></svg>`;
    }

    function makeArrowSvg() {
      return `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M10 6L7 3M10 6L7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    function lookupDestRecord(code) {
      if (!code) return null;
      if (kind === "cr") {
        const rows = window.crMap?.getLocalAuthoritySearchRecords?.() || [];
        return rows.find((r) => r.code === code) || null;
      }
      const rows = window.ukMap?.getConstituencySearchRecords?.() || [];
      return rows.find((r) => r.code === code) || null;
    }

    function makeDestCol(code, isSelf, fallbackColor = null) {
      const color = (code ? (kind === "cr" ? getLaColor(code) : getPconColor(code)) : null) ?? fallbackColor;
      const hexSvgStr = makeHexSvg(color);
      const arrowHtml = `<span class="map-search-result-arrow">${makeArrowSvg()}</span>`;
      if (isSelf) {
        return `<span class="map-search-result-dest is-self">${hexSvgStr}${arrowHtml}</span>`;
      }
      const rec = lookupDestRecord(code);
      const destName = rec?.name || (code ? escapeHtml(code) : "");
      const destRegion = kind === "cr" ? (rec?.region_name || "") : (rec?.region || "");
      const nameHtml = destName ? `<div class="map-search-result-dest-name">${escapeHtml(destName)}</div>` : "";
      const regionHtml = destRegion ? `<div class="map-search-result-dest-region">${escapeHtml(destRegion)}</div>` : "";
      const textHtml = (nameHtml || regionHtml) ? `<span class="map-search-result-dest-text">${nameHtml}${regionHtml}</span>` : "";
      return `<span class="map-search-result-dest">${hexSvgStr}${textHtml}${arrowHtml}</span>`;
    }

    const typeHtml = `<span class="map-search-result-type">${escapeHtml(result.type_label)}</span>`;
    let copyHtml = "";
    let destHtml = "";

    if (result.kind === "constituency") {
      const hexSvgStr = makeHexSvg(getPconColor(result.code));
      const secondary = result.secondary
        ? `<span class="map-search-result-secondary">${escapeHtml(result.secondary)}</span>` : "";
      copyHtml = `<span class="map-search-result-copy"><span class="map-search-result-col2-icon">${hexSvgStr}</span><span class="map-search-result-text-block"><span class="map-search-result-primary">${escapeHtml(result.primary)}</span>${secondary}</span></span>`;
      destHtml = `<span class="map-search-result-dest is-self"><span class="map-search-result-arrow">${makeArrowSvg()}</span></span>`;
    } else if (result.kind === "local_authority") {
      const hexSvgStr = makeHexSvg(getLaColor(result.code));
      const secondary = result.secondary
        ? `<span class="map-search-result-secondary">${escapeHtml(result.secondary)}</span>` : "";
      copyHtml = `<span class="map-search-result-copy"><span class="map-search-result-col2-icon">${hexSvgStr}</span><span class="map-search-result-text-block"><span class="map-search-result-primary">${escapeHtml(result.primary)}</span>${secondary}</span></span>`;
      destHtml = `<span class="map-search-result-dest is-self"><span class="map-search-result-arrow">${makeArrowSvg()}</span></span>`;
    } else if (result.kind === "sensor") {
      const sensorColor = result.station_id ? getSensorColor(result.station_id) : null;
      const hasData = sensorColor !== null;
      const dotClass = hasData ? "has-data" : "no-data";
      const dotStyle = hasData ? ` style="background:${escapeHtml(sensorColor)}"` : "";
      const pillHtml = `<span class="sensor-reading-pill"><span class="sensor-reading-dot ${dotClass}"${dotStyle}></span>${escapeHtml(pollutantLabel)}</span>`;
      const networkHtml = result.secondary
        ? `<span class="map-search-result-secondary">${escapeHtml(result.secondary)}</span>` : "";
      copyHtml = `<span class="map-search-result-copy"><span class="map-search-result-text-block"><span class="map-search-result-primary">${escapeHtml(result.primary)}</span><span class="map-search-result-sub">${pillHtml}${networkHtml}</span></span></span>`;
      const destCode = kind === "cr" ? result.la_code : result.pcon_code;
      destHtml = makeDestCol(destCode, false, sensorColor);
    } else {
      // postcode / postcode_hint — pcon/la codes not resolved until selection
      const secondary = result.secondary
        ? `<span class="map-search-result-secondary">${escapeHtml(result.secondary)}</span>` : "";
      copyHtml = `<span class="map-search-result-copy"><span class="map-search-result-text-block"><span class="map-search-result-primary">${escapeHtml(result.primary)}</span>${secondary}</span></span>`;
      const destCode = kind === "cr" ? result.la_code : result.pcon_code;
      if (destCode && lookupDestRecord(destCode)) {
        destHtml = makeDestCol(destCode, false);
      } else {
        // destCode absent or not yet in hex data — use area hint from postcode metadata.
        // Prefer area_name, then post_town. Only fall back to raw code as a last resort.
        if (destCode && !lookupDestRecord(destCode)) {
          console.warn(
            `[uk-aq] postcode result has LA code not found in hex map: ${destCode}`,
            { postcode: result.postcode || result.primary, la_code: destCode, area_name: result.area_name || null, post_town: result.post_town || null },
          );
        }
        const color = destCode ? (kind === "cr" ? getLaColor(destCode) : getPconColor(destCode)) : null;
        const hexSvgStr = destCode ? makeHexSvg(color) : "";
        const areaName = String(result.area_name || result.lad_name || "").trim();
        const postTown = String(result.post_town || "").trim();
        const fallbackLabel = areaName || postTown || destCode || "";
        const nameHtml = areaName ? `<div class="map-search-result-dest-name">${escapeHtml(areaName)}</div>`
          : (fallbackLabel ? `<div class="map-search-result-dest-name">${escapeHtml(fallbackLabel)}</div>` : "");
        const regionHtml = (areaName && postTown) ? `<div class="map-search-result-dest-region">${escapeHtml(postTown)}</div>` : "";
        const textHtml = (nameHtml || regionHtml) ? `<span class="map-search-result-dest-text">${nameHtml}${regionHtml}</span>` : "";
        destHtml = `<span class="map-search-result-dest">${hexSvgStr}${textHtml}<span class="map-search-result-arrow">${makeArrowSvg()}</span></span>`;
      }
    }

    return `<button type="button" class="map-search-result${activeClass}" role="option" aria-selected="${isActive ? "true" : "false"}" data-result-index="${index}">${typeHtml}${copyHtml}${destHtml}</button>`;
  }

  function getPlaceholder(kind) {
    if (isMobileSearch()) {
      return "Search UK-AQ…";
    }
    if (kind === "cr") {
      return "Search postcodes, local authorities, sensors…";
    }
    return "Search postcodes, constituencies, sensors…";
  }

  function createMapSearchController(rootElement) {
    const kind = rootElement.getAttribute("data-map-kind") || "uk";
    const inputEl = rootElement.querySelector(".map-search-input");
    const clearEl = rootElement.querySelector(".map-search-clear");
    const resultsEl = rootElement.querySelector(".map-search-results");
    if (!inputEl || !clearEl || !resultsEl) {
      return null;
    }

    const state = {
      results: [],
      activeIndex: -1,
      debounceTimerId: null,
      suggestAbortController: null,
      requestSeq: 0,
      message: "",
    };

    const context = {
      kind,
      getSensorColor: (stationId) => window.ukMap?.getSensorCurrentColor?.(stationId) ?? null,
      get pollutantLabel() {
        const map = kind === "cr" ? window.crMap : window.ukMap;
        return map?.getPollutantLabel?.() || "PM2.5";
      },
    };

    function syncPlaceholder() {
      inputEl.placeholder = getPlaceholder(kind);
    }

    function setActiveIndex(nextIndex, { scrollIntoView = false } = {}) {
      if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= state.results.length) {
        state.activeIndex = -1;
      } else {
        state.activeIndex = nextIndex;
      }

      resultsEl.querySelectorAll("[data-result-index]").forEach((el) => {
        const index = Number.parseInt(el.getAttribute("data-result-index"), 10);
        const isActive = index === state.activeIndex;
        el.classList.toggle("is-active", isActive);
        el.setAttribute("aria-selected", isActive ? "true" : "false");
        if (isActive && scrollIntoView) {
          el.scrollIntoView({ block: "nearest" });
        }
      });
    }

    function setExpanded(expanded) {
      inputEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

    function closeResults() {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      state.results = [];
      state.activeIndex = -1;
      state.message = "";
      setExpanded(false);
    }

    function renderCurrentResults() {
      const hasRows = state.results.length > 0;
      const hasMessage = Boolean(state.message);
      if (!hasRows && !hasMessage) {
        closeResults();
        return;
      }
      const rows = state.results.map((result, index) => buildResultMarkup(result, index, index === state.activeIndex, context));
      const destinationHeader = hasRows
        ? `<div class="map-search-results-header" aria-hidden="true"><span></span><span></span><span class="map-search-results-dest-header">${escapeHtml(kind === "cr" ? "Local Authority" : "Constituency")}</span></div>`
        : "";
      const messageRow = hasMessage ? `<div class="map-search-message">${escapeHtml(state.message)}</div>` : "";
      resultsEl.innerHTML = `${destinationHeader}${rows.join("")}${messageRow}`;
      resultsEl.hidden = false;
      setExpanded(true);
    }

    function getLocalResultGroups(queryText) {
      if (normalizeText(queryText).length < LOCAL_SEARCH_MIN_CHARS) {
        return {
          constituency: [],
          local_authority: [],
          sensor: [],
        };
      }
      return {
        constituency: rankLocalMatches(buildConstituencySearchIndex(), queryText),
        local_authority: rankLocalMatches(buildLocalAuthoritySearchIndex(), queryText),
        sensor: rankLocalMatches(buildSensorSearchIndex(), queryText),
      };
    }

    function mergeAndRender(localGroups, postcodeRows, message) {
      const merged = mergeSearchResults({
        postcode: postcodeRows || [],
        constituency: localGroups.constituency || [],
        local_authority: localGroups.local_authority || [],
        sensor: localGroups.sensor || [],
      }, MAX_RESULTS);
      state.results = merged;
      state.activeIndex = merged.length ? 0 : -1;
      state.message = message || "";
      renderCurrentResults();
    }

    async function runPostcodeLookupResult(selectedResult) {
      try {
        const exact = await fetchExactPostcode(selectedResult.postcode || selectedResult.postcode_normalised || selectedResult.primary);
        const postcode = String(exact?.postcode || selectedResult.postcode || "").trim();
        const label = exact?.label || buildPostcodeLabel(postcode, exact?.area_name, exact?.post_town) || postcode;
        inputEl.value = label;
        clearEl.hidden = !inputEl.value;

        // TODO: extend when postcode API returns pcon_codes[] for split postcodes
        const pconCodes = Array.isArray(exact?.pcon_codes) ? exact.pcon_codes : null;
        if (pconCodes && pconCodes.length > 1) {
          const constituencyIndex = buildConstituencySearchIndex();
          const lookupName = (code) => {
            const rec = constituencyIndex.find((r) => r.code === normalizeCode(code));
            return rec?.primary || code || "";
          };
          const sortedCodes = [...pconCodes].sort((a, b) =>
            lookupName(a).localeCompare(lookupName(b), undefined, { sensitivity: "base" })
          );
          state.results = sortedCodes.map((code) => {
            const normCode = normalizeCode(code);
            const rec = constituencyIndex.find((r) => r.code === normCode);
            return {
              group: "constituency",
              kind: "constituency",
              type_label: getResultTypeLabel("constituency"),
              code: normCode || code,
              primary: rec?.primary || normCode || code,
              secondary: rec?.secondary || "",
              _nameNorm: rec?._nameNorm || normalizeText(rec?.primary || code),
              _searchNorm: rec?._searchNorm || normalizeText(rec?.primary || code),
            };
          });
          state.activeIndex = state.results.length ? 0 : -1;
          state.message = "";
          renderCurrentResults();
          return;
        }

        const activeTab = getActiveTab();
        const pconCode = normalizeCode(exact?.pcon_code);
        const laCode = normalizeCode(exact?.la_code);
        if (activeTab === "uk") {
          if (pconCode && await selectConstituencyCode(pconCode)) {
            closeResults();
            return;
          }
          if (laCode && await selectLocalAuthorityCode(laCode)) {
            closeResults();
            return;
          }
        } else {
          if (laCode && await selectLocalAuthorityCode(laCode)) {
            closeResults();
            return;
          }
          if (pconCode && await selectConstituencyCode(pconCode)) {
            closeResults();
            return;
          }
        }
        closeResults();
      } catch (error) {
        const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 0;
        const message = status === 404
          ? "Postcode not found."
          : (status === 400 ? "Enter a valid UK postcode." : "Postcode lookup unavailable");
        state.message = message;
        renderCurrentResults();
      }
    }

    async function selectConstituencyResult(result) {
      await selectConstituencyCode(result.code);
      inputEl.value = result.primary;
      clearEl.hidden = !inputEl.value;
      closeResults();
    }

    async function selectLocalAuthorityResult(result) {
      await selectLocalAuthorityCode(result.code, result.region_name || null);
      inputEl.value = result.primary;
      clearEl.hidden = !inputEl.value;
      closeResults();
    }

    async function selectSensorResult(result) {
      const activeTab = getActiveTab();
      if (activeTab === "uk") {
        if (result.pcon_code) {
          await selectConstituencyCode(result.pcon_code);
        } else if (result.la_code) {
          await selectLocalAuthorityCode(result.la_code);
        }
      } else {
        if (result.la_code) {
          await selectLocalAuthorityCode(result.la_code);
        } else if (result.pcon_code) {
          await selectConstituencyCode(result.pcon_code);
        }
      }
      inputEl.value = result.primary;
      clearEl.hidden = !inputEl.value;
      closeResults();
    }

    async function selectResult(result) {
      if (!result) {
        return;
      }
      if (result.kind === "postcode_hint") {
        inputEl.value = result.prefix || "";
        clearEl.hidden = !inputEl.value;
        runSearch(true);
        return;
      }
      if (result.kind === "postcode") {
        await runPostcodeLookupResult(result);
        return;
      }
      if (result.kind === "constituency") {
        await selectConstituencyResult(result);
        return;
      }
      if (result.kind === "local_authority") {
        await selectLocalAuthorityResult(result);
        return;
      }
      if (result.kind === "sensor") {
        await selectSensorResult(result);
      }
    }

    function clearPendingSuggest() {
      if (state.debounceTimerId) {
        window.clearTimeout(state.debounceTimerId);
        state.debounceTimerId = null;
      }
      if (state.suggestAbortController) {
        state.suggestAbortController.abort();
        state.suggestAbortController = null;
      }
    }

    function runSearch(immediate = false) {
      clearPendingSuggest();
      const query = inputEl.value || "";
      clearEl.hidden = !query;
      const trimmed = query.trim();
      if (!trimmed) {
        closeResults();
        return;
      }
      const localGroups = getLocalResultGroups(trimmed);
      const shouldFetchPostcode = looksLikePostcodePrefix(trimmed);
      if (!shouldFetchPostcode) {
        mergeAndRender(localGroups, [], "");
        return;
      }
      // For 1-2 char queries use preloaded hints to avoid the 4→6 jump
      const compactQuery = normalizePostcode(trimmed);
      if (compactQuery.length <= 2) {
        const hintRows = getHintRows(compactQuery);
        if (hintRows) {
          mergeAndRender(localGroups, hintRows, "");
          return;
        }
      }
      const requestSeq = ++state.requestSeq;
      const requestLimit = parseLimit(params.get("search_limit"), MAX_RESULTS);
      const triggerFetch = async () => {
        const controller = new AbortController();
        state.suggestAbortController = controller;
        let postcodeRows = [];
        let message = "";
        try {
          postcodeRows = await fetchPostcodeSuggestions(trimmed, controller.signal, requestLimit);
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }
          message = "Postcode search unavailable";
          console.warn("postcode_suggest request failed", error);
        }
        if (requestSeq !== state.requestSeq) {
          return;
        }
        const refreshedLocalGroups = getLocalResultGroups(trimmed);
        mergeAndRender(refreshedLocalGroups, postcodeRows, message);
      };
      if (immediate) {
        void triggerFetch();
      } else {
        state.debounceTimerId = window.setTimeout(() => {
          void triggerFetch();
        }, POSTCODE_DEBOUNCE_MS);
      }
      mergeAndRender(localGroups, [], "");
    }

    inputEl.addEventListener("input", () => {
      runSearch(false);
    });

    inputEl.addEventListener("focus", () => {
      window.crMap?.ensureAllRegionsFetched?.();
      if (inputEl.value.trim()) {
        runSearch(true);
      }
    });

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        if (!state.results.length) {
          return;
        }
        event.preventDefault();
        const nextIndex = state.activeIndex < state.results.length - 1 ? state.activeIndex + 1 : 0;
        setActiveIndex(nextIndex, { scrollIntoView: true });
        return;
      }
      if (event.key === "ArrowUp") {
        if (!state.results.length) {
          return;
        }
        event.preventDefault();
        const nextIndex = state.activeIndex > 0 ? state.activeIndex - 1 : state.results.length - 1;
        setActiveIndex(nextIndex, { scrollIntoView: true });
        return;
      }
      if (event.key === "Enter") {
        if (state.activeIndex < 0 || state.activeIndex >= state.results.length) {
          return;
        }
        event.preventDefault();
        void selectResult(state.results[state.activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        if (!resultsEl.hidden) {
          event.preventDefault();
          closeResults();
        }
      }
    });

    resultsEl.addEventListener("mouseover", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-result-index]") : null;
      if (!target) return;
      const nextIndex = Number.parseInt(target.getAttribute("data-result-index"), 10);
      if (Number.isFinite(nextIndex) && nextIndex !== state.activeIndex) {
        setActiveIndex(nextIndex);
      }
    });

    resultsEl.addEventListener("mousedown", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-result-index]") : null;
      if (!target) {
        return;
      }
      // Use mousedown to ensure the selection happens before any document-level close handlers fire.
      // preventDefault keeps the input focus.
      event.preventDefault();
      const nextIndex = Number.parseInt(target.getAttribute("data-result-index"), 10);
      if (Number.isFinite(nextIndex) && nextIndex >= 0 && nextIndex < state.results.length) {
        setActiveIndex(nextIndex);
        void selectResult(state.results[nextIndex]);
      }
    });

    clearEl.addEventListener("click", () => {
      clearPendingSuggest();
      inputEl.value = "";
      clearEl.hidden = true;
      closeResults();
      inputEl.focus();
    });

    syncPlaceholder();

    return {
      rootElement,
      inputEl,
      syncPlaceholder,
      closeResults,
    };
  }

  const controllers = searchRoots
    .map((root) => createMapSearchController(root))
    .filter(Boolean);

  if (!controllers.length) {
    return;
  }

  function syncAllPlaceholders() {
    controllers.forEach((controller) => controller.syncPlaceholder());
  }

  window.addEventListener("resize", syncAllPlaceholders);
  document.addEventListener("mousedown", (event) => {
    const target = event.target;
    controllers.forEach((controller) => {
      if (!controller.rootElement.contains(target)) {
        controller.closeResults();
      }
    });
  });
  syncAllPlaceholders();
  if (getActiveTab() === "uk") {
    void ensureCrSearchDataLoaded();
  } else {
    void ensureUkSearchDataLoaded();
  }
  // Preload prefix hints after page settles so 1-2 char searches render immediately
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => { void loadPrefixHints(); });
  } else {
    window.setTimeout(() => { void loadPrefixHints(); }, 1000);
  }

  return Object.freeze({
    controllers: Object.freeze(controllers.slice()),
  });
  }

  let controller = null;
  root.UkAqHexMapSearch = Object.freeze({
    mount() {
      if (!controller) controller = createHexMapSearchController();
      return controller;
    },
    syncActiveTabInput,
    preloadInactiveMap,
    get controller() { return controller; },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
