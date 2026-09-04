import pollutantDomain from "../shared/domain/pollutants-module.js";
import networkDomain from "../shared/domain/networks-module.js";
import coordinator from "./hex-map-coordinator.js";
import networkController from "./hex-map-network-controller.js";
import summaryPresenter from "./hex-map-summary.js";
import scrollAffordances from "./hex-map-scroll-affordances.js";
import "./hex-map-station-chart-adapter-module.js";
import search from "./hex-map-search.js";

function initHexMapUkController(root) {
      "use strict";

      if (!root?.document || !document.body.classList.contains("hex-map-page")) return;

      if (!pollutantDomain?.definitions || !networkDomain?.resolveCode || !networkController?.loadCatalog || !coordinator?.registerMap) {
        throw new Error("UK AQ shared domain/data modules must load before the Hex Map.");
      }
      const PROJECT_REF_PLACEHOLDER = "zztjgmdiftqtdcrlfpvc";
      const ANON_KEY_PLACEHOLDER = "sb_publishable_Cru7ACLoK8kKQdID5jPaDw_3RHvQNxO";
      const params = new URLSearchParams(window.location.search);
      const projectRefParam = params.get("project_ref");
      const anonKeyParam = params.get("anon_key");
      const cacheBaseParam = params.get("cache_base");
      const cacheBaseUrl = resolveCacheBaseUrl(cacheBaseParam);
      const cacheSessionParam = params.get("cache_session_url");
      const mapDateParam = params.get("map_date");
      const pconVersionParam = params.get("pcon_version");
      const initialMapSettings = coordinator.getMapSettings();
      const inferredProjectRef = inferProjectRefFromHost();
      const projectRef = PROJECT_REF_PLACEHOLDER.includes("__SUPABASE_PROJECT_REF__")
        ? (projectRefParam || inferredProjectRef || "")
        : PROJECT_REF_PLACEHOLDER;
      const anonKey = ANON_KEY_PLACEHOLDER.includes("__SB_PUBLISHABLE_DEFAULT_KEY__")
        ? (anonKeyParam || "")
        : ANON_KEY_PLACEHOLDER;
      const cacheOrigin = cacheBaseUrl ? new URL(cacheBaseUrl).origin : "";
      const defaultCacheSessionUrl = cacheOrigin ? `${cacheOrigin}/api/aq/session/start` : "";
      const cacheSessionUrl = (cacheSessionParam || defaultCacheSessionUrl || "").trim();
      const REST_URL = cacheBaseUrl
        ? `${cacheBaseUrl}/pcon-hex`
        : "";
      const LATEST_SNAPSHOT_URL = cacheBaseUrl
        ? `${cacheBaseUrl}/latest-snapshot`
        : "";
      const SNAPSHOT_WINDOWS = new Set(["3h", "6h", "1d", "7d", "all"]);
      function resolveLatestUrl(windowLabel) {
        const normalizedWindow = String(windowLabel || "").trim().toLowerCase();
        if (LATEST_SNAPSHOT_URL && SNAPSHOT_WINDOWS.has(normalizedWindow)) {
          return LATEST_SNAPSHOT_URL;
        }
        return "";
      }
      const POPULATION_URL = projectRef
        ? `https://${projectRef}.supabase.co/functions/v1/uk_aq_population`
        : "";
      let activePollutant = coordinator.getPollutant();
      const POLLUTANT_CACHE_TTL = 60 * 1000;
      const pollutantCache = new Map();
      const latestSinceByKey = new Map();
      const latestSinceIdByKey = new Map();
      const latestEtagByKey = new Map();
      const pconEtagByKey = new Map();
      const pconSinceByKey = new Map();
      let latestLoadId = 0;
      const MAP_CUTOVER = "2023-11-29";
      const MAP_CONFIGS = [
        {
          id: "pcon24",
          label: "2024 constituencies",
          hexUrl: "/data/PCON/uk-constituencies-2023.hexjson",
          version: "2024",
          effectiveFrom: MAP_CUTOVER,
        },
        {
          id: "pcon23",
          label: "Pre-2024 constituencies",
          hexUrl: "/data/PCON/uk-constituencies-2017.hexjson",
          version: "2023",
          effectiveUntil: MAP_CUTOVER,
        },
      ];
      const mapDateKey = normalizeDateKey(mapDateParam);
      const activeMap = pickMapConfig(mapDateKey);
      const HEX_DATA_URL = activeMap.hexUrl;
      const activePconVersion = pconVersionParam || activeMap.version;
        const METRIC_LABELS = {
          median: "Typical (median)",
          mean: "Average (mean)",
        };
      const MIN_VALID_PM25_VALUE = 0.09;
      const MAX_VALID_PM25_VALUE = 500;
      const WINDOW_OPTIONS = {
        "3h": 3 * 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "1d": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        all: null,
      };
      const WINDOW_LABELS = {
        "3h": "3 Hours",
        "6h": "6 Hours",
        "1d": "1 Day",
        "7d": "7 Days",
        all: "No Limit",
      };
      const NETWORK_CATALOG_URL = cacheBaseUrl
        ? `${cacheBaseUrl}/networks`
        : "/api/aq/networks";
      const GOVUK_NETWORK_MATCHERS = ["gov_uk_aurn"];
      const OPENAQ_NETWORK_MATCHERS = ["openaq"];
      const BREATHE_LONDON_MATCHERS = ["breathelondon"];
      const LAQN_NETWORK_MATCHERS = ["laqn"];
      const SENSOR_COMMUNITY_MATCHERS = ["sensorcommunity"];
      const TOTAL_PCON_COUNT = 650;
      const SORT_DEFAULTS = {
        sensor: "asc",
        network: "asc",
        pm25: "desc",
        updated: "desc",
      };
      const HEAT_STOPS = ["--heat-0", "--heat-1", "--heat-2", "--heat-3", "--heat-4"];
      const HEAT_STOP_FALLBACKS = ["#00a85a", "#ffd54a", "#ff9b3a", "#e03c3c", "#5b2a86"];
      const REGION_NAMES = {
        E12000001: "North East",
        E12000002: "North West",
        E12000003: "Yorkshire and The Humber",
        E12000004: "East Midlands",
        E12000005: "West Midlands",
        E12000006: "East of England",
        E12000007: "London",
        E12000008: "South East",
        E12000009: "South West",
        S92000003: "Scotland",
        W92000004: "Wales",
        N92000002: "Northern Ireland",
      };
      const AXIAL_DIRECTIONS = [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 },
      ];
      const EDGE_DIRECTION_CACHE = new Map();

      const statusEl = document.getElementById("status");
      const statusIndicator = statusEl ? statusEl.closest(".status-indicator") : null;
      const errorEl = document.getElementById("error");
      const rowCount = document.getElementById("row-count");
      const lastUpdated = document.getElementById("last-updated");
      const endpointHint = document.getElementById("endpoint-hint");
      const mapTitle = document.getElementById("map-title");
      const pollutantSelector = document.getElementById("pollutant-selector");
      const pollutantButtons = pollutantSelector
        ? Array.from(pollutantSelector.querySelectorAll("button[data-pollutant]"))
        : [];
      const legendPollutantLabel = document.getElementById("legend-pollutant");
      const legendLabel = document.getElementById("legend-label");
      const legendMin = document.getElementById("legend-min");
      const legendMax = document.getElementById("legend-max");
      const legendScale = document.getElementById("legend-scale");
      requestAnimationFrame(() => {
        if (!legendLabel) return;
        const saved = legendLabel.textContent;
        legendLabel.style.minWidth = "";
        let maxW = 0;
        for (const mk of Object.keys(METRIC_LABELS)) {
          legendLabel.textContent = METRIC_LABELS[mk];
          maxW = Math.max(maxW, legendLabel.scrollWidth);
        }
        legendLabel.textContent = saved;
        if (maxW > 0) legendLabel.style.minWidth = `${maxW}px`;
      });
      const legendTicks = Array.from(document.querySelectorAll(".legend-tick"));
      const legendTickLabels = Array.from(document.querySelectorAll(".legend-tick-label"));
      const summaryStations = document.getElementById("summary-stations");
      const summaryHighestLabel = document.getElementById("summary-highest-label");
      const summaryLowestLabel = document.getElementById("summary-lowest-label");
      const summaryLowestValue = document.getElementById("summary-lowest-value");
      const summaryLowestDatetime = document.getElementById("summary-lowest-datetime");
      const summaryLowestConnector = document.getElementById("summary-lowest-connector");
      const summaryLowestName = document.getElementById("summary-lowest-name");
      const summaryHighestValue = document.getElementById("summary-highest-value");
      const summaryHighestDatetime = document.getElementById("summary-highest-datetime");
      const summaryHighestConnector = document.getElementById("summary-highest-connector");
      const summaryHighestName = document.getElementById("summary-highest-name");
      const sensorValueLabel = document.getElementById("sensor-value-label");
      const overallSummaryCard = document.getElementById("overall-summary");
      const overallSummaryTitle = document.getElementById("summary-overall-title");
      const extraNetworkSummaryDefs = [
        {
          key: "openaq",
          matchers: OPENAQ_NETWORK_MATCHERS,
          elements: {
            sensors: document.getElementById("network-openaq-sensors"),
            coverageValue: document.getElementById("network-openaq-coverage-value"),
            coverageBar: document.getElementById("network-openaq-coverage-bar"),
            coverageFill: document.getElementById("network-openaq-coverage-fill"),
            average: document.getElementById("network-openaq-average"),
            median: document.getElementById("network-openaq-median"),
            highest: document.getElementById("network-openaq-highest"),
            lowest: document.getElementById("network-openaq-lowest"),
            latest: document.getElementById("network-openaq-latest"),
          },
        },
        {
          key: "breathe-london",
          matchers: BREATHE_LONDON_MATCHERS,
          elements: {
            sensors: document.getElementById("network-breathe-sensors"),
            coverageValue: document.getElementById("network-breathe-coverage-value"),
            coverageBar: document.getElementById("network-breathe-coverage-bar"),
            coverageFill: document.getElementById("network-breathe-coverage-fill"),
            average: document.getElementById("network-breathe-average"),
            median: document.getElementById("network-breathe-median"),
            highest: document.getElementById("network-breathe-highest"),
            lowest: document.getElementById("network-breathe-lowest"),
            latest: document.getElementById("network-breathe-latest"),
          },
        },
        {
          key: "laqn",
          matchers: LAQN_NETWORK_MATCHERS,
          elements: {
            sensors: document.getElementById("network-laqn-sensors"),
            coverageValue: document.getElementById("network-laqn-coverage-value"),
            coverageBar: document.getElementById("network-laqn-coverage-bar"),
            coverageFill: document.getElementById("network-laqn-coverage-fill"),
            average: document.getElementById("network-laqn-average"),
            median: document.getElementById("network-laqn-median"),
            highest: document.getElementById("network-laqn-highest"),
            lowest: document.getElementById("network-laqn-lowest"),
            latest: document.getElementById("network-laqn-latest"),
          },
        },
        {
          key: "sensor-community",
          matchers: SENSOR_COMMUNITY_MATCHERS,
          elements: {
            sensors: document.getElementById("network-sc-sensors"),
            coverageValue: document.getElementById("network-sc-coverage-value"),
            coverageBar: document.getElementById("network-sc-coverage-bar"),
            coverageFill: document.getElementById("network-sc-coverage-fill"),
            average: document.getElementById("network-sc-average"),
            median: document.getElementById("network-sc-median"),
            highest: document.getElementById("network-sc-highest"),
            lowest: document.getElementById("network-sc-lowest"),
            latest: document.getElementById("network-sc-latest"),
          },
        },
      ];
      const tooltip = document.getElementById("tooltip");
      const sensorDetailsSection = document.getElementById("sensor-details");
      const detailsTitle = document.getElementById("details-title");
      const detailsMeta = document.getElementById("details-meta");
      const detailsEmpty = document.getElementById("details-empty");
      const detailsTableWrap = document.getElementById("sensor-table-wrap");
      const detailsTableBody = document.getElementById("sensor-table-body");
      const networkSummary = document.getElementById("network-summary");
      const sensorShareList = document.getElementById("sensor-share-list");
      const networkSummaryCoverage = document.getElementById("network-summary-coverage");
      const networkSummarySensors = document.getElementById("network-summary-sensors");
      const networkSummaryFreshness = document.getElementById("network-summary-freshness");
      const aurnSensors = document.getElementById("network-aurn-sensors");
      const aurnCoverageValue = document.getElementById("network-aurn-coverage-value");
      const aurnCoverageBar = document.getElementById("network-aurn-coverage-bar");
      const aurnCoverageFill = document.getElementById("network-aurn-coverage-fill");
      const aurnAverage = document.getElementById("network-aurn-average");
      const aurnMedian = document.getElementById("network-aurn-median");
      const aurnHighest = document.getElementById("network-aurn-highest");
      const aurnLowest = document.getElementById("network-aurn-lowest");
      const aurnLatest = document.getElementById("network-aurn-latest");
      const mapSvg = document.getElementById("hex-map");
      const svg = d3.select("#hex-map");
      const mapResizeTarget = svg.node()?.parentElement || svg.node();
      if (mapResizeTarget && typeof ResizeObserver !== "undefined") {
        const mapResizeObserver = new ResizeObserver(() => {
          if (statusEl.textContent === "Live") {
            renderMapIfReady();
          }
        });
        mapResizeObserver.observe(mapResizeTarget);
      }
      const ukRoot = document.getElementById("tab-panel-uk");
      const mapSettingsButton = document.querySelector(".map-settings");
      const mapSettingsPanel = document.getElementById("map-settings-panel");
      const mapSettingsClose = document.getElementById("map-settings-close");
      const mapPanel = document.querySelector(".map-panel");
      const mapWrap = document.querySelector("#tab-panel-uk .map-wrap");
      const windowInputs = Array.from(document.querySelectorAll("input[name='averagingWindow']"));
      const metricInputs = Array.from(document.querySelectorAll("input[name='metricSelect']"));
      const metricGroup = document.querySelector(".metric-group");
      const metricToggle = metricGroup ? metricGroup.querySelector(".metric-toggle") : null;
      const colorScaleInputs = Array.from(document.querySelectorAll("input[name='colourScale']"));
      const colorScaleGroup = document.querySelector(".colour-scale-group");
      const colorScaleToggle = colorScaleGroup ? colorScaleGroup.querySelector(".colour-scale-toggle") : null;
      const networkPanel = document.querySelector(".network-panel");
      const sortHeaders = detailsTableWrap
        ? Array.from(detailsTableWrap.querySelectorAll("th[data-sort-key]"))
        : [];
      const sortHeaderButtons = sortHeaders
        .map((header) => header.querySelector("button[data-sort-key]"))
        .filter(Boolean);
      const mapCanvasWrap = document.getElementById("map-inline-sensor-panel")?.closest(".map-canvas-wrap") || null;
      const inlinePanelClose = document.getElementById("sensor-panel-close");
      const inlinePanelWindowLabel = document.getElementById("sensor-panel-window-label");
      const inlinePanelTitle = document.getElementById("sensor-panel-title");
      const inlinePanelTitleLaunch = document.querySelector("#tab-panel-uk .sensor-panel-title-launch");
      const inlinePanelLaunchButton = document.querySelector("#tab-panel-uk .sensor-title-icon-button");
      const inlinePanelReading = document.getElementById("sensor-panel-reading");
      const inlinePanelNetworkLabel = document.getElementById("sensor-panel-network-label");
      const inlinePanelCount = document.getElementById("sensor-panel-count");
      const inlinePanelHexIcon = document.getElementById("sensor-panel-hex-icon");
      const inlinePanelBody = document.getElementById("sensor-panel-body");
      const SENSOR_PANEL_EMPTY_HEIGHT = 116;
      const SENSOR_PANEL_HEADER_HEIGHT = 62;
      const SENSOR_TABLE_HEADER_HEIGHT = 44;
      const SENSOR_PANEL_ROW_HEIGHT = 46;
      const SENSOR_PANEL_MAX_VISIBLE_ROWS = 4;
      const detailScrollAffordances = scrollAffordances?.attachSensorTable?.(detailsTableWrap, {
        contentEl: detailsTableBody,
        isScrollbarHidden: () => !detailsTableWrap?.classList.contains("is-scroll-forced"),
        trackOffsetTop: SENSOR_TABLE_HEADER_HEIGHT,
      });
      const restoreDetailsScrollPosition = (nextKey, previousScrollTop) => {
        detailScrollAffordances?.restorePosition?.(nextKey, previousScrollTop);
      };
      let chartLaunchAvailable = false;
      const formatSelectedAreaSensorCount = (inWindowCount, outsideWindowCount) => {
        const inWindow = Math.max(0, Number(inWindowCount) || 0);
        const outside = Math.max(0, Number(outsideWindowCount) || 0);
        return outside > 0
          ? `${formatSensorCount(inWindow)} (+${formatNumber(outside)} outside window)`
          : `${formatSensorCount(inWindow)} (0 outside window)`;
      };
      const syncInlinePanelTitleInteractivity = () => {
        if (!inlinePanelTitle) {
          return;
        }
        const isChartModeActive = Boolean(window.hexChartMode?.isActive?.("uk"));
        const isInteractive = chartLaunchAvailable && !isChartModeActive;
        inlinePanelTitleLaunch?.setAttribute("data-chart-launch-available", isInteractive ? "true" : "false");
        if (inlinePanelLaunchButton) {
          inlinePanelLaunchButton.disabled = !isInteractive;
        }
        inlinePanelTitle.setAttribute("aria-disabled", isInteractive ? "false" : "true");
        if (!isInteractive) {
          inlinePanelTitle.removeAttribute("role");
          inlinePanelTitle.removeAttribute("tabindex");
          return;
        }
        inlinePanelTitle.setAttribute("role", "button");
        inlinePanelTitle.setAttribute("tabindex", "0");
      };
      if (inlinePanelClose) {
        inlinePanelClose.addEventListener("click", () => {
          if (window.hexChartMode?.isActive?.("uk")) {
            window.hexChartMode?.exit?.();
          }
          setSelectedCell(null);
        });
      }
      const openSelectedAreaChartMode = () => {
        if (!chartLaunchAvailable || !selectedPconCode || window.hexChartMode?.isActive?.("uk")) {
          return;
        }
        window.hexChartMode?.enter?.({ mapKey: "uk" });
      };
      inlinePanelLaunchButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        openSelectedAreaChartMode();
      });
      inlinePanelTitle?.addEventListener("click", (event) => {
        if (!chartLaunchAvailable || window.hexChartMode?.isActive?.("uk")) {
          return;
        }
        event.stopPropagation();
        openSelectedAreaChartMode();
      });
      inlinePanelTitle?.addEventListener("keydown", (event) => {
        if (!chartLaunchAvailable || window.hexChartMode?.isActive?.("uk")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openSelectedAreaChartMode();
        }
      });
      syncInlinePanelTitleInteractivity();
      if (detailsTableWrap) {
        detailsTableWrap.addEventListener("click", (event) => {
          const launchButton = event.target instanceof Element
            ? event.target.closest(".sensor-chart-launch[data-station-id]")
            : null;
          if (launchButton && detailsTableWrap.contains(launchButton)) {
            event.stopPropagation();
            const stationId = String(launchButton.dataset.stationId || "").trim();
            if (!stationId || window.hexChartMode?.isActive?.("uk")) {
              return;
            }
            window.hexChartMode?.enter?.({
              mapKey: "uk",
              initialSensorId: stationId,
            });
            return;
          }
          const selectorHeaderButton = event.target instanceof Element
            ? event.target.closest(".hex-chart-selector[data-chart-header-action]")
            : null;
          if (selectorHeaderButton && detailsTableWrap.contains(selectorHeaderButton)) {
            event.stopPropagation();
            const action = String(selectorHeaderButton.getAttribute("data-chart-header-action") || "").trim();
            if (!action) {
              return;
            }
            if (window.hexChartMode?.isActive?.("uk")) {
              window.hexChartMode?.applyHeaderSelectionAction?.(action, { mapKey: "uk" });
            }
            return;
          }
          const selectorButton = event.target instanceof Element
            ? event.target.closest(".hex-chart-selector[data-station-id]")
            : null;
          if (selectorButton && detailsTableWrap.contains(selectorButton)) {
            event.stopPropagation();
            const stationId = String(selectorButton.dataset.stationId || "").trim();
            if (!stationId) {
              return;
            }
            if (window.hexChartMode?.isActive?.("uk")) {
              window.hexChartMode?.selectSensor?.(stationId, { mapKey: "uk", mode: "toggle" });
            }
            return;
          }
          const button = event.target instanceof Element
            ? event.target.closest(".sensor-name-button[data-station-id]")
            : null;
          if (!button || !detailsTableWrap.contains(button)) {
            return;
          }
          event.stopPropagation();
          const stationId = String(button.dataset.stationId || "").trim();
          if (!stationId) {
            return;
          }
          if (window.hexChartMode?.isActive?.("uk")) {
            window.hexChartMode?.selectSensor?.(stationId, { mapKey: "uk", mode: "single" });
            return;
          }
          window.hexChartMode?.enter?.({
            mapKey: "uk",
            initialSensorId: stationId,
          });
        });
      }

      let currentMetric = initialMapSettings.metric;
      let currentColorScale = initialMapSettings.colorScale;
      let currentWindow = initialMapSettings.window;
      let sortKey = "pm25";
      let sortDir = "desc";
      let hexData = null;
      let hexCells = [];
      let hexBounds = null;
      let hexSide = null;
      let hexLayout = "odd-r";
      let hasRendered = false;
      let lastRenderWidth = 0;
      let lastRenderHeight = 0;
      let basePconRows = [];
      let basePconLookup = new Map();
      let pconRows = [];
      let pconLookup = new Map();
      let pconCodes = new Set();
      let boundaryPaths = [];
      let baseLatestRows = [];
      let baseLatestRowsAllWindow = [];
      let scopedLatestRows = [];
      let scopedLatestRowsAllWindow = [];
      let latestRows = [];
      let latestPollutant = null;
      let chartDataStatus = "loading";
      let ukRefreshTimer = null;
      let ukWasHidden = true;
      let ukBootstrapReady = false;
      let populationLookup = new Map();
      let selectedPconCode = null;
      let selectedCell = null;
      let areaRegionLookup = new Map();
      let pinnedTooltipCell = null;
      let ukSearchPreloadPromise = null;
      let colorScale = null;
      let currentDomainMax = null;
      function setStatus(value) {
        if (!statusEl) {
          return;
        }
        statusEl.textContent = value;
        if (statusIndicator) {
          const isLive = value === "Live";
          statusIndicator.dataset.state = isLive ? "live" : "idle";
        }
        root.dispatchEvent(new CustomEvent("hexmapstatuschange", {
          detail: { mapKey: "uk", status: String(value || "").toLowerCase() },
        }));
      }

      if (endpointHint) {
        endpointHint.textContent = REST_URL
          ? `Endpoint: ${REST_URL} (${activeMap.label})`
          : "Missing cache endpoint base URL. Add ?cache_base=... to the URL.";
      }

      function resolveCacheBaseUrl(rawValue) {
        const explicit = typeof rawValue === "string" ? rawValue.trim() : "";
        if (explicit) {
          return explicit.replace(/\/+$/, "");
        }
        if (window.location.protocol === "http:" || window.location.protocol === "https:") {
          return `${window.location.origin.replace(/\/$/, "")}/api/aq`;
        }
        return "https://cic-test.chronicillnesschannel.co.uk/api/aq";
      }

      async function fetchCacheApi(input, init = {}, retryOnAuthFailure = true) {
        const timingId = nextHexMapTimingId();
        const requestLabel = getHexMapRequestLabel(input);
        markHexMapTiming(timingId, `fetch:${requestLabel}:start`);
        try {
          return await window.ukAqSharedAuth.fetchCacheApi(input, init, retryOnAuthFailure);
        } finally {
          markHexMapTiming(timingId, `fetch:${requestLabel}:end`);
          measureHexMapTiming(
            timingId,
            `fetch:${requestLabel}`,
            `fetch:${requestLabel}:start`,
            `fetch:${requestLabel}:end`,
          );
        }
      }
      window.ukAqFetchCacheApi = fetchCacheApi;

      const ACCESS_LOGIN_REDIRECT_KEY = "uk_aq_access_login_redirect_ts";
      const HEX_MAP_TIMING_PREFIX = "uk-aq-hex-map";
      const MAP_TIMING_KEY = "uk";
      let hexMapTimingSequence = 0;

      function nextHexMapTimingId() {
        hexMapTimingSequence += 1;
        return hexMapTimingSequence;
      }

      function getHexMapTimingMarkName(timingId, stage) {
        return `${HEX_MAP_TIMING_PREFIX}:${MAP_TIMING_KEY}:${timingId}:${stage}`;
      }

      function getHexMapRequestLabel(input) {
        try {
          const requestUrl = input instanceof Request
            ? new URL(input.url)
            : new URL(String(input), window.location.href);
          return requestUrl.pathname.replace(/^\/+/, "").replace(/\//g, ":") || "request";
        } catch (_err) {
          return "request";
        }
      }

      function markHexMapTiming(timingId, stage) {
        if (typeof performance === "undefined" || typeof performance.mark !== "function") {
          return;
        }
        performance.mark(getHexMapTimingMarkName(timingId, stage));
      }

      function measureHexMapTiming(timingId, measureName, startStage, endStage) {
        if (typeof performance === "undefined" || typeof performance.measure !== "function") {
          return;
        }
        try {
          performance.measure(
            `${HEX_MAP_TIMING_PREFIX}:${MAP_TIMING_KEY}:${timingId}:${measureName}`,
            getHexMapTimingMarkName(timingId, startStage),
            getHexMapTimingMarkName(timingId, endStage),
          );
        } catch (_err) {
          // Ignore missing-mark errors when a load aborts before completion.
        }
      }

      function isLikelyAccessFetchFailure(error) {
        if (!(error instanceof TypeError)) {
          return false;
        }
        const message = String(error.message || "").toLowerCase();
        return message.includes("failed to fetch") || message.includes("networkerror");
      }

      function buildAccessLoginUrl() {
        const host = window.location.hostname || "";
        if (!host) {
          return null;
        }
        const appSlug = host.split(".")[0];
        if (!appSlug) {
          return null;
        }
        const loginOrigin = `https://${appSlug}.cloudflareaccess.com`;
        const redirectPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        return `${loginOrigin}/cdn-cgi/access/login/${host}?redirect_url=${encodeURIComponent(redirectPath)}`;
      }

      function maybeRedirectToAccessLogin(error) {
        if (!cacheOrigin || !cacheSessionUrl || !isLikelyAccessFetchFailure(error)) {
          return false;
        }
        if ((window.location.hostname || "").endsWith(".cloudflareaccess.com")) {
          return false;
        }
        const loginUrl = buildAccessLoginUrl();
        if (!loginUrl) {
          return false;
        }
        try {
          const now = Date.now();
          const last = Number(sessionStorage.getItem(ACCESS_LOGIN_REDIRECT_KEY) || "0");
          if (Number.isFinite(last) && now - last < 10000) {
            return false;
          }
          sessionStorage.setItem(ACCESS_LOGIN_REDIRECT_KEY, String(now));
        } catch (_err) {
          // Ignore storage failures and continue with redirect.
        }
        window.location.assign(loginUrl);
        return true;
      }

      function inferProjectRefFromHost() {
        const host = window.location.hostname || "";
        if (host.endsWith(".supabase.co")) {
          return host.split(".")[0];
        }
        return null;
      }

      function normalizeDateKey(value) {
        if (!value) {
          return null;
        }
        const trimmed = value.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          return null;
        }
        return trimmed;
      }

      function pickMapConfig(dateKey) {
        if (!dateKey) {
          return MAP_CONFIGS[0];
        }
        return dateKey < MAP_CUTOVER ? MAP_CONFIGS[1] : MAP_CONFIGS[0];
      }

      function normalizeNumber(value) {
        if (value === null || value === undefined) {
          return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      }

      function clampValue(value, pollutantKey) {
        const numeric = normalizeNumber(value);
        if (numeric === null) {
          return null;
        }
        if (pollutantKey === "pm25" && numeric > MAX_VALID_PM25_VALUE) {
          return null;
        }
        return numeric;
      }

      function formatNumber(value) {
        if (value === null || value === undefined || Number.isNaN(value)) {
          return "-";
        }
        return value.toLocaleString();
      }

      function SensorShareBars(listEl, initialData = []) {
        if (!listEl) {
          return {
            render: () => {},
          };
        }
        const MIN_BAR_PERCENT = 4;
        const MAX_BAR_PERCENT = 78;
        const COUNT_GAP = 16;

        const updatePlacement = (row) => {
          const bar = row.querySelector(".sensor-share-bar");
          const count = row.querySelector(".sensor-share-count");
          if (!bar || !count) {
            return;
          }
          row.classList.remove("is-stacked");
          const barWidthPct = Number(row.dataset.barWidth || 0);
          const barRect = bar.getBoundingClientRect();
          const countRect = count.getBoundingClientRect();
          const barEnd = barRect.left + (barRect.width * barWidthPct) / 100 + COUNT_GAP;
          const overflow = barEnd + countRect.width > barRect.right;
          if (overflow) {
            row.classList.add("is-stacked");
          }
        };

        const updateAll = () => {
          Array.from(listEl.querySelectorAll(".sensor-share-item")).forEach(updatePlacement);
        };

        const render = (data) => {
          const items = Array.isArray(data) ? data.slice() : [];
          const totalSensors = items.reduce((sum, item) => sum + (Number(item?.sensors) || 0), 0);
          const maxSensors = items.reduce((max, item) => Math.max(max, Number(item?.sensors) || 0), 0);
          items.sort((a, b) => (Number(b?.sensors) || 0) - (Number(a?.sensors) || 0));
          listEl.innerHTML = "";

          items.forEach((item) => {
            const name = item?.name || "Unknown";
            const sensors = Number(item?.sensors) || 0;
            const shareExact = totalSensors ? (sensors / totalSensors) * 100 : 0;
            const shareRounded = Math.round(shareExact);
            const relativeWidth = maxSensors ? (sensors / maxSensors) * MAX_BAR_PERCENT : 0;
            const displayWidth = relativeWidth > 0 ? Math.max(relativeWidth, MIN_BAR_PERCENT) : 0;

            const li = document.createElement("li");
            li.className = "sensor-share-item";
            li.setAttribute("role", "listitem");
            li.setAttribute("aria-label", `${name}: ${formatNumber(sensors)} sensors, ${shareRounded} percent share`);
            li.dataset.barWidth = displayWidth.toFixed(2);
            li.style.setProperty("--bar-width", `${displayWidth}%`);
            li.style.setProperty("--bar-min-width", shareExact > 0 ? `${MIN_BAR_PERCENT}%` : "0%");

            const label = document.createElement("div");
            label.className = "sensor-share-label";
            const labelName = document.createElement("span");
            labelName.className = "sensor-share-name";
            labelName.textContent = name;
            const labelPercent = document.createElement("span");
            labelPercent.className = "sensor-share-percent";
            labelPercent.textContent = `${shareRounded}%`;
            label.append(labelName, labelPercent);

            const barRow = document.createElement("div");
            barRow.className = "sensor-share-bar-row";
            const bar = document.createElement("div");
            bar.className = "sensor-share-bar";
            const fill = document.createElement("span");
            fill.className = "sensor-share-fill";
            bar.appendChild(fill);
            const count = document.createElement("span");
            count.className = "sensor-share-count";
            count.textContent = formatNumber(sensors);
            barRow.append(bar, count);

            li.append(label, barRow);
            listEl.appendChild(li);
          });

          requestAnimationFrame(updateAll);
        };

        if (window.ResizeObserver) {
          const observer = new ResizeObserver(updateAll);
          observer.observe(listEl);
        } else {
          window.addEventListener("resize", updateAll);
        }

        render(initialData);
        return { render };
      }

      function NetworkSummaryCards(targets, data) {
        if (!targets) {
          return {
            render: () => {},
          };
        }
        const { coverageEl, sensorsEl, freshnessEl } = targets;

        const renderCoverageCard = (metrics) => {
          const covered = Number(metrics?.pconCovered) || 0;
          const total = Number(metrics?.pconTotal) || 0;
          const percent = total ? Math.round((covered / total) * 100) : 0;

          const card = document.createElement("div");
          card.className = "network-summary-content";
          const title = document.createElement("h4");
          title.className = "network-summary-title";
          title.textContent = "Coverage";

          const value = document.createElement("div");
          value.className = "network-summary-value network-summary-accent";
          value.textContent = `${percent}%`;

          const subtext = document.createElement("div");
          subtext.className = "network-summary-subtext";
          subtext.textContent = `${formatNumber(covered)} / ${formatNumber(total)} constituencies`;

          const bar = document.createElement("div");
          bar.className = "network-summary-bar";
          const fill = document.createElement("span");
          fill.className = "network-summary-bar-fill";
          fill.style.width = `${total ? (covered / total) * 100 : 0}%`;
          bar.appendChild(fill);

          card.append(title, value, subtext, bar);
          return card;
        };

        const renderSensorsCard = (metrics) => {
          const totalSensors = Number(metrics?.totalSensors) || 0;
          const avgSensors = Number(metrics?.avgSensorsPerPcon);

          const card = document.createElement("div");
          card.className = "network-summary-content";
          const title = document.createElement("h4");
          title.className = "network-summary-title";
          title.textContent = "Sensors";

          const grid = document.createElement("div");
          grid.className = "network-summary-grid";

          const totalBlock = document.createElement("div");
          totalBlock.className = "network-summary-metric";
          const totalLabel = document.createElement("div");
          totalLabel.className = "network-summary-label";
          totalLabel.textContent = "Total Active Sensors";
          const totalValue = document.createElement("div");
          totalValue.className = "network-summary-number";
          totalValue.textContent = formatNumber(totalSensors);
          totalBlock.append(totalLabel, totalValue);

          const avgBlock = document.createElement("div");
          avgBlock.className = "network-summary-metric";
          const avgLabel = document.createElement("div");
          avgLabel.className = "network-summary-label";
          avgLabel.textContent = "Average sensors per covered constituency";
          const avgValue = document.createElement("div");
          avgValue.className = "network-summary-number";
          avgValue.textContent = Number.isFinite(avgSensors) ? avgSensors.toFixed(1) : "-";
          avgBlock.append(avgLabel, avgValue);

          grid.append(totalBlock, avgBlock);
          card.append(title, grid);
          return card;
        };

        const renderFreshnessCard = (metrics) => {
          const latest = metrics?.newestReadingISO || null;
          const stalest = metrics?.oldestReadingISO || null;

          const card = document.createElement("div");
          card.className = "network-summary-content";
          const title = document.createElement("h4");
          title.className = "network-summary-title";
          title.textContent = "Data Freshness";

          const grid = document.createElement("div");
          grid.className = "network-summary-grid";

          const latestBlock = document.createElement("div");
          latestBlock.className = "network-summary-metric";
          const latestLabel = document.createElement("div");
          latestLabel.className = "network-summary-label";
          latestLabel.textContent = "Latest update";
          const latestValue = document.createElement("div");
          latestValue.className = latest ? "network-summary-number" : "network-summary-empty";
          latestValue.textContent = latest ? formatSummaryTimestamp(latest) : "No data";
          latestBlock.append(latestLabel, latestValue);

          const stalestBlock = document.createElement("div");
          stalestBlock.className = "network-summary-metric";
          const stalestLabel = document.createElement("div");
          stalestLabel.className = "network-summary-label";
          stalestLabel.textContent = "Oldest Update";
          const stalestValue = document.createElement("div");
          stalestValue.className = stalest ? "network-summary-number" : "network-summary-empty";
          stalestValue.textContent = stalest ? formatSummaryTimestamp(stalest) : "No data";
          stalestBlock.append(stalestLabel, stalestValue);

          grid.append(latestBlock, stalestBlock);
          card.append(title, grid);
          return card;
        };

        const render = (metrics) => {
          if (coverageEl) {
            coverageEl.innerHTML = "";
            coverageEl.append(renderCoverageCard(metrics));
          }
          if (sensorsEl) {
            sensorsEl.innerHTML = "";
            sensorsEl.append(renderSensorsCard(metrics));
          }
          if (freshnessEl) {
            freshnessEl.innerHTML = "";
            freshnessEl.append(renderFreshnessCard(metrics));
          }
        };

        render(data);
        return { render };
      }

      function collectSelectedStationEntries(rows) {
        const stationMap = new Map();
        rows.forEach((item, index) => {
          const value = resolveLatestValue(item);
          if (!Number.isFinite(value)) {
            return;
          }
          const stationKey = resolveStationKey(item) || `station-${index}`;
          const timestamp = resolveLatestTimestamp(item);
          const existing = stationMap.get(stationKey);
          if (!existing || (timestamp && (!existing.timestamp || timestamp > existing.timestamp))) {
            stationMap.set(stationKey, { row: item, value, timestamp });
          }
        });
        return Array.from(stationMap.values());
      }

      function getSelectedNetworkLabel(row, selectedNetworkCodes) {
        const entries = collectNetworkEntries(row);
        if (selectedNetworkCodes && selectedNetworkCodes.size) {
          const match = entries.find((entry) => entry.code && selectedNetworkCodes.has(entry.code));
          if (match) {
            return match.label || match.code;
          }
        }
        return resolvePrimaryNetworkLabel(row) || "Unknown network";
      }

      function buildSelectedNetworkSummary() {
        const windowed = filterRowsByWindow(scopedLatestRows);
        const scopedRows = getRowsForActivePollutant(windowed);
        const entries = collectSelectedStationEntries(scopedRows);
        const selectedNetworkCodes = getActiveNetworkCodes();
        const pconSet = new Set();
        const counts = new Map();
        let newest = null;
        let oldest = null;

        entries.forEach((entry) => {
          const pcon = resolvePconCode(entry.row);
          if (pcon) {
            pconSet.add(pcon);
          }
          const timestamp = entry.timestamp;
          if (timestamp) {
            if (!newest || timestamp > newest) {
              newest = timestamp;
            }
            if (!oldest || timestamp < oldest) {
              oldest = timestamp;
            }
          }
          const label = getSelectedNetworkLabel(entry.row, selectedNetworkCodes);
          counts.set(label, (counts.get(label) || 0) + 1);
        });

        const shareData = Array.from(counts.entries()).map(([name, sensors]) => ({ name, sensors }));
        const totalSensors = entries.length;
        const pconCovered = pconSet.size;
        const pconTotal = pconCodes.size || TOTAL_PCON_COUNT;
        const avgSensorsPerPcon = pconCovered ? totalSensors / pconCovered : null;

        return {
          pconCovered,
          pconTotal,
          totalSensors,
          avgSensorsPerPcon,
          newestReadingISO: newest ? newest.toISOString?.() || newest : null,
          oldestReadingISO: oldest ? oldest.toISOString?.() || oldest : null,
          shareData,
        };
      }

      function formatSensorCount(value) {
        const count = Number.isFinite(value) ? value : 0;
        const label = count === 1 ? "Sensor" : "Sensors";
        return `${formatNumber(count)} ${label}`;
      }

      function formatCoveragePercent(covered, total) {
        if (!total) {
          return "0%";
        }
        const percent = (covered / total) * 100;
        return `${Math.round(percent)}%`;
      }

      function formatCoverageValue(covered, total) {
        return `${formatCoveragePercent(covered, total)} (${formatNumber(covered)} / ${formatNumber(total)})`;
      }

      function updateCoverageElements(valueEl, fillEl, barEl, covered, total, areaLabel) {
        if (!valueEl || !fillEl || !barEl) {
          return;
        }
        const percentRaw = total ? (covered / total) * 100 : 0;
        const percent = Math.max(0, Math.min(100, percentRaw));
        const coverageLabel = formatCoverageValue(covered, total);
        valueEl.textContent = coverageLabel;
        fillEl.style.width = `${percent}%`;
        const areaSuffix = areaLabel ? ` ${areaLabel}` : "";
        const ariaLabel = `Coverage ${coverageLabel}${areaSuffix}`;
        barEl.setAttribute("aria-label", ariaLabel);
        barEl.title = ariaLabel;
      }

      function formatValue(value) {
        const numeric = normalizeNumber(value);
        if (numeric === null) {
          return "-";
        }
        return numeric.toFixed(1);
      }

      function escapeHtmlLocal(value) {
        return String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function formatTimestamp(value) {
        if (!value) {
          return "unknown";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return "unknown";
        }
        return parsed.toLocaleString();
      }

      function formatShortTimestamp(value) {
        if (!value) {
          return "-";
        }
        const parsed = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return "-";
        }
        const day = String(parsed.getDate()).padStart(2, "0");
        const month = String(parsed.getMonth() + 1).padStart(2, "0");
        const year = String(parsed.getFullYear()).slice(-2);
        const hours = String(parsed.getHours()).padStart(2, "0");
        const minutes = String(parsed.getMinutes()).padStart(2, "0");
        return `${day}/${month}/${year} ${hours}:${minutes}`;
      }

      function formatSummaryTimestamp(value) {
        if (!value) {
          return "-";
        }
        const parsed = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return "-";
        }
        const day = String(parsed.getDate()).padStart(2, "0");
        const month = String(parsed.getMonth() + 1).padStart(2, "0");
        const year = String(parsed.getFullYear());
        const hours = String(parsed.getHours()).padStart(2, "0");
        const minutes = String(parsed.getMinutes()).padStart(2, "0");
        return `${day}/${month}/${year} ${hours}:${minutes}`;
      }

      function parseDate(value) {
        if (!value) {
          return null;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return null;
        }
        return parsed;
      }

      function normalizeWindowKey(value) {
        if (!value || !(value in WINDOW_OPTIONS)) {
          return "all";
        }
        return value;
      }

      function setWindow(nextWindow, options = {}) {
        const normalized = normalizeWindowKey(nextWindow);
        if (!normalized) {
          return;
        }
        if (normalized === currentWindow) {
          syncWindowInputs();
          return;
        }
        if (!options.coordinated) {
          coordinator.updateMapSettings({ window: normalized }, { source: "uk" });
          return;
        }
        currentWindow = normalized;
        syncWindowInputs();
        if (!isUkMapVisible()) {
          return;
        }
        setMapLoading(true);
        const latestCacheKey = getLatestCacheKey(activePollutant, currentWindow);
        // Window switches must compare like-for-like snapshots. Drop incremental
        // state for the target window so we always fetch a fresh full window.
        latestSinceByKey.delete(latestCacheKey);
        latestSinceIdByKey.delete(latestCacheKey);
        latestEtagByKey.delete(latestCacheKey);
        pollutantCache.delete(latestCacheKey);
        loadMapData();
      }

      function getPollutantLabel(key) {
        return pollutantDomain.get(key)?.label || "PM2.5";
      }

      function getPollutantUnits(key) {
        return pollutantDomain.get(key)?.unit || "µg/m³";
      }

      function getNonZeroThreshold() {
        return activePollutant === "pm25" ? MIN_VALID_PM25_VALUE : 0;
      }

      function updatePollutantLabels() {
        const pollutantLabel = getPollutantLabel(activePollutant);
        const pollutantUnits = getPollutantUnits(activePollutant);
        if (mapTitle) {
          mapTitle.textContent = `Latest ${pollutantLabel} by constituency`;
        }
        if (legendPollutantLabel) {
          legendPollutantLabel.textContent = `${pollutantLabel} (${pollutantUnits})`;
        }
        if (overallSummaryTitle) {
          overallSummaryTitle.textContent = `${pollutantLabel} summary`;
        }
        if (summaryHighestLabel) {
          summaryHighestLabel.textContent = `Highest ${pollutantLabel}`;
        }
        if (summaryLowestLabel) {
          summaryLowestLabel.textContent = `Lowest ${pollutantLabel} (Non-zero)`;
        }
        if (sensorValueLabel) {
          sensorValueLabel.textContent = pollutantLabel;
        }
        if (mapSvg) {
          mapSvg.setAttribute("aria-label", `Hex cartogram of ${pollutantLabel} by constituency`);
        }
      }

      let ukInitialLoad = true;

      function setMapLoading(isLoading) {
        if (!mapWrap) {
          return;
        }
        if (!isLoading) {
          if (ukInitialLoad) {
            ukInitialLoad = false;
            mapWrap.classList.remove("is-initial");
          }
          const dataHexes = mapWrap.querySelectorAll(".hex.has-data");
          mapWrap.classList.remove("is-loading");
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              dataHexes.forEach((el) => {
                const targetFill = el.getAttribute("data-fill");
                if (targetFill) el.style.fill = targetFill;
              });
            });
          });
        } else {
          mapWrap.classList.add("is-loading");
        }
        if (isLoading && tooltip) {
          tooltip.classList.remove("visible");
        }
      }

      function isUkMapVisible() {
        return !document.hidden && !ukRoot?.hidden;
      }

      function clearUkRefreshTimer() {
        if (ukRefreshTimer) {
          clearInterval(ukRefreshTimer);
          ukRefreshTimer = null;
        }
      }

      function startUkRefreshTimer() {
        clearUkRefreshTimer();
        if (!isUkMapVisible()) {
          return;
        }
        ukRefreshTimer = setInterval(() => {
          if (isUkMapVisible()) {
            if (window.hexChartMode?.isActive?.("uk")) {
              window.hexChartMode.refresh?.();
            } else {
              loadMapData();
            }
          }
        }, 60 * 1000);
      }

      function syncUkPollingOnVisibility() {
        if (!isUkMapVisible()) {
          clearUkRefreshTimer();
          ukWasHidden = true;
          return;
        }
        if (!ukBootstrapReady) {
          return;
        }
        startUkRefreshTimer();
        if (ukWasHidden) {
          loadMapData();
          ukWasHidden = false;
        }
      }

      function getLatestCacheKey(pollutantKey = activePollutant, windowKey = currentWindow) {
        return `${pollutantKey || "all"}::${windowKey || "all"}`;
      }

      function normalizeIsoTimestamp(value) {
        if (!value) {
          return null;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return null;
        }
        return parsed.toISOString();
      }

      function normalizeCursorId(value) {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return null;
        }
        return Math.trunc(parsed);
      }

      function resolveLatestRowKey(row) {
        const stationId = row?.station_id ?? row?.station?.id ?? null;
        const pollutantKey = getPollutantKeyFromRow(row);
        if (stationId !== null && stationId !== undefined && pollutantKey) {
          return `${stationId}::${pollutantKey}`;
        }
        return row?.id
          ?? row?.timeseries_id
          ?? row?.timeseries_ref
          ?? null;
      }

      function mergeLatestRows(existingRows, incomingRows) {
        const merged = new Map();
        const extras = [];
        const upsert = (row) => {
          const key = resolveLatestRowKey(row);
          if (key === null || key === undefined || key === "") {
            extras.push(row);
            return;
          }
          merged.set(String(key), row);
        };
        existingRows.forEach(upsert);
        incomingRows.forEach(upsert);
        return [...merged.values(), ...extras];
      }

      function mergePconRows(existingRows, incomingRows) {
        const merged = new Map();
        const extras = [];
        const upsert = (row) => {
          const key = row?.pcon_code;
          if (!key) {
            extras.push(row);
            return;
          }
          merged.set(String(key), row);
        };
        existingRows.forEach(upsert);
        incomingRows.forEach(upsert);
        return [...merged.values(), ...extras];
      }

      function getPollutantCache(key) {
        const cached = pollutantCache.get(key);
        if (!cached) {
          return null;
        }
        if (Date.now() - cached.timestamp > POLLUTANT_CACHE_TTL) {
          return null;
        }
        return cached;
      }

      function applyCachedPollutant(key) {
        const cached = getPollutantCache(key);
        if (!cached) {
          return false;
        }
        baseLatestRows = cached.latestRows;
        const cachedAllRows = getPollutantCache(getLatestCacheKey(activePollutant, "all"));
        baseLatestRowsAllWindow = cachedAllRows?.latestRows || cached.latestRows || [];
        latestPollutant = cached.latestPollutant || activePollutant;
        chartDataStatus = latestPollutant === activePollutant ? "ready" : "loading";
        const networkRowsForWindow = getNetworkRowsForWindow();
        const windowNetworkDefs = buildNetworkDefs(networkRowsForWindow);
        const coverageByCode = buildNetworkCoverageByCode(networkRowsForWindow);
        renderNetworkFiltersIfNeeded(
          windowNetworkDefs,
          coverageByCode,
          TOTAL_PCON_COUNT,
          "constituencies",
        );
        applyNetworkFilters();
        requestAnimationFrame(() => {
          setMapLoading(false);
        });
        return true;
      }

      function syncPollutantButtons() {
        if (!pollutantButtons.length) {
          return;
        }
        pollutantButtons.forEach((button) => {
          const key = button.dataset.pollutant;
          const isActive = key === activePollutant;
          button.setAttribute("aria-checked", isActive ? "true" : "false");
          button.tabIndex = isActive ? 0 : -1;
        });
      }

      function setActivePollutant(nextPollutant, options = {}) {
        if (!nextPollutant) {
          return;
        }
        const normalized = normalizePollutantKey(nextPollutant);
        if (!normalized || normalized === activePollutant) {
          syncPollutantButtons();
          updatePollutantLabels();
          return;
        }
        if (!options.coordinated) {
          coordinator.setPollutant(normalized, { source: coordinator.getActiveMap() });
          return;
        }
        activePollutant = normalized;
        chartDataStatus = "loading";
        updatePollutantLabels();
        syncPollutantButtons();
        if (options.deferFetch) {
          return;
        }
        if (!isUkMapVisible()) {
          return;
        }
        setMapLoading(true);
        if (applyCachedPollutant(getLatestCacheKey(activePollutant, currentWindow))) {
          return;
        }
        loadMapData();
      }

      function handlePollutantKeydown(event) {
        if (!pollutantButtons.length) {
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") {
          return;
        }
        event.preventDefault();
        const currentIndex = pollutantButtons.findIndex((button) => button.dataset.pollutant === activePollutant);
        if (currentIndex === -1) {
          return;
        }
        const direction = (event.key === "ArrowLeft" || event.key === "ArrowUp") ? -1 : 1;
        const nextIndex = (currentIndex + direction + pollutantButtons.length) % pollutantButtons.length;
        const nextButton = pollutantButtons[nextIndex];
        if (!nextButton) {
          return;
        }
        setActivePollutant(nextButton.dataset.pollutant);
        nextButton.focus();
      }

      function getWindowCutoff() {
        const windowMs = WINDOW_OPTIONS[currentWindow];
        if (!windowMs) {
          return null;
        }
        return Date.now() - windowMs;
      }

      function isTimestampInWindow(timestamp, cutoff) {
        if (!cutoff) {
          return true;
        }
        if (!timestamp) {
          return false;
        }
        return timestamp.getTime() >= cutoff;
      }

      function getDefaultSortDir(key) {
        return SORT_DEFAULTS[key] || "asc";
      }

      function getSortDirection(columnKey, activeKey, activeDir) {
        return columnKey === activeKey ? activeDir : getDefaultSortDir(columnKey);
      }

      function renderSortIcon(columnKey, activeKey, activeDir) {
        const direction = getSortDirection(columnKey, activeKey, activeDir);
        return direction === "asc" ? "↑" : "↓";
      }

      function getSortTooltip(columnKey, activeKey, activeDir) {
        const isActive = columnKey === activeKey;
        if (!isActive) {
          if (columnKey === "sensor" || columnKey === "network") return "Click to sort A to Z";
          if (columnKey === "pm25") return "Click to sort high to low";
          return "Click to sort newest first";
        }
        return "";
      }

      function syncColorScaleInputs() {
        colorScaleInputs.forEach((input) => {
          input.checked = input.value === currentColorScale;
        });
        if (colorScaleGroup) {
          colorScaleGroup.dataset.active = currentColorScale;
        }
      }

      function syncWindowInputs() {
        windowInputs.forEach((input) => {
          input.checked = input.value === currentWindow;
        });
      }

      function setColorScale(nextScale, options = {}) {
        if (!nextScale) {
          return;
        }
        if (nextScale === currentColorScale) {
          syncColorScaleInputs();
          return;
        }
        if (!options.coordinated) {
          coordinator.updateMapSettings({ colorScale: nextScale }, { source: "uk" });
          return;
        }
        currentColorScale = nextScale;
        syncColorScaleInputs();
        updateLegendScaleDescription();
        renderMap();
        updateDetailsPanel();
        updateSummary();
      }

      function getLegendCapValue() {
        return activePollutant === "no2" ? 100 : 50;
      }

      function updateLegendScaleDescription() {
        if (!legendScale) {
          return;
        }
        const capValue = getLegendCapValue();
        const description = currentColorScale === "linear"
          ? `Linear colour scale: values map directly; values above ${capValue} are shown as ${capValue}+.`
          : `Power-eased colour scale: pulls low values toward mid-range; values above ${capValue} are shown as ${capValue}+.`;
        legendScale.title = description;
        legendScale.setAttribute("aria-label", description);
      }

      function openSettingsPanel() {
        if (!mapSettingsPanel || !mapSettingsButton) {
          return;
        }
        syncSettingsPanelWidth();
        mapSettingsPanel.classList.add("open");
        positionSettingsPanel();
        mapSettingsButton.setAttribute("aria-expanded", "true");
      }

      function closeSettingsPanel() {
        if (!mapSettingsPanel || !mapSettingsButton) {
          return;
        }
        mapSettingsPanel.classList.remove("open");
        mapSettingsButton.setAttribute("aria-expanded", "false");
      }

      function toggleSettingsPanel() {
        if (!mapSettingsPanel) {
          return;
        }
        if (mapSettingsPanel.classList.contains("open")) {
          closeSettingsPanel();
        } else {
          openSettingsPanel();
        }
      }

      function syncSettingsPanelWidth() {
        if (!mapSettingsPanel) {
          return;
        }
        const panelWidth = networkPanel?.getBoundingClientRect().width || 0;
        if (panelWidth > 0) {
          mapSettingsPanel.style.width = `${panelWidth}px`;
        } else {
          mapSettingsPanel.style.removeProperty("width");
        }
      }

      function positionSettingsPanel() {
        if (!mapSettingsPanel || !mapSettingsButton || !mapCanvasWrap) {
          return;
        }
        const gap = 8;
        mapSettingsPanel.style.top = "0px";
        mapSettingsPanel.style.bottom = "auto";
        const canvasRect = mapCanvasWrap.getBoundingClientRect();
        const buttonRect = mapSettingsButton.getBoundingClientRect();
        const panelHeight = mapSettingsPanel.getBoundingClientRect().height || mapSettingsPanel.scrollHeight || 0;
        const buttonTop = buttonRect.top - canvasRect.top;
        const buttonBottom = buttonRect.bottom - canvasRect.top;
        const belowTop = buttonBottom + gap;
        const aboveTop = buttonTop - panelHeight - gap;
        const hasSpaceAbove = aboveTop >= gap;
        const maxBelowTop = Math.max(gap, canvasRect.height - panelHeight - gap);
        const top = hasSpaceAbove ? aboveTop : Math.min(belowTop, maxBelowTop);
        mapSettingsPanel.style.left = `${buttonRect.left - canvasRect.left}px`;
        mapSettingsPanel.style.top = `${Math.max(gap, top)}px`;
        mapSettingsPanel.style.bottom = "auto";
      }

      function resolveCssColor(name, fallback) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
      }

      function resolveNetworkId(row) {
        return networkDomain.resolveId(row);
      }

      function resolveNetworkCode(row) {
        return networkDomain.resolveCode(row);
      }

      function getCatalogNetworkByCode(code) {
        return networkController.getCatalogByCode(code);
      }

      function resolveNetworkLabel(row) {
        return networkDomain.resolveLabel(row, networkController.getCatalogByCodeMap());
      }

      async function fetchNetworkCatalog() {
        return networkController.loadCatalog({
          url: NETWORK_CATALOG_URL,
          fetchApi: fetchCacheApi,
        });
      }

      function resolveStationName(row) {
        return row?.display_name
          || row?.station?.display_name
          || "Unknown sensor";
      }

      function resolveConnectorCode(row) {
        return row?.connector_code
          || row?.connector?.connector_code
          || row?.station?.connector_code
          || row?.station?.connector?.connector_code
          || null;
      }

      function resolveConnectorLabel(row) {
        const label = row?.connector_label
          || row?.connector?.label
          || row?.station?.connector_label
          || row?.station?.connector?.label
          || null;
        if (label) {
          return label;
        }
        const code = resolveConnectorCode(row);
        return code || "Unknown network";
      }

      function resolvePrimaryNetworkEntry(row) {
        const code = resolveNetworkCode(row);
        const label = resolveNetworkLabel(row);
        if (!code || !label) {
          return null;
        }
        return {
          id: resolveNetworkId(row) || getCatalogNetworkByCode(code)?.id || null,
          code,
          label,
        };
      }

      function resolvePrimaryNetworkLabel(row) {
        return resolveNetworkLabel(row);
      }

      function resolveSecondaryNetworkLabels(row) {
        return [];
      }

      function collectNetworkEntries(row) {
        const code = resolveNetworkCode(row);
        const label = resolveNetworkLabel(row);
        if (!code || !label) {
          return [];
        }
        return [{
          id: resolveNetworkId(row) || getCatalogNetworkByCode(code)?.id || null,
          code,
          label,
        }];
      }

      function buildNetworkDefs(rows) {
        const byCode = new Map(
          networkController.getCatalog().map((def) => [
            def.code,
            { ...def, count: 0 },
          ])
        );
        const seenStationsByCode = new Map();
        rows.forEach((row) => {
          const entry = resolvePrimaryNetworkEntry(row);
          if (!entry || !byCode.has(entry.code)) return;
          const stationKey = resolveStationKey(row)
            || `${resolveStationName(row)}::${resolveCoordinatePair(row).lat ?? ""}::${resolveCoordinatePair(row).lon ?? ""}`;
          if (!seenStationsByCode.has(entry.code)) {
            seenStationsByCode.set(entry.code, new Set());
          }
          const seenStations = seenStationsByCode.get(entry.code);
          if (seenStations.has(stationKey)) {
            return;
          }
          seenStations.add(stationKey);
          byCode.get(entry.code).count++;
        });
        return Array.from(byCode.values()).sort((a, b) => a.label.localeCompare(b.label));
      }

      function getNetworkRowsForWindow() {
        const windowed = filterRowsByWindow(baseLatestRows);
        return getRowsForActivePollutant(windowed);
      }

      function buildNetworkCoverageByCode(rows) {
        const coverageByCode = new Map();
        rows.forEach((row) => {
          const areaCode = resolvePconCode(row);
          if (!areaCode) {
            return;
          }
          const seenCodes = new Set();
          collectNetworkEntries(row).forEach((entry) => {
            const code = String(entry?.code || "").trim();
            if (!code || seenCodes.has(code)) {
              return;
            }
            seenCodes.add(code);
            if (!coverageByCode.has(code)) {
              coverageByCode.set(code, new Set());
            }
            coverageByCode.get(code).add(areaCode);
          });
        });
        return coverageByCode;
      }

      function renderNetworkFiltersIfNeeded(defs, coverageByCode, coverageTotal, coverageAreaLabel) {
        return networkController.updateScope("uk", {
          definitions: defs,
          coverageByCode,
          coverageTotal,
          coverageAreaLabel,
        });
      }

      function resolveNetworkCodes(row) {
        const code = resolveNetworkCode(row);
        return code ? [code] : [];
      }

      function resolvePconCode(row) {
        return row?.pcon_code
          || row?.station?.pcon_code
          || null;
      }

      function resolveLaCode(row) {
        return row?.la_code
          || row?.lad_code
          || row?.local_authority_code
          || row?.station?.la_code
          || row?.station?.lad_code
          || row?.station?.local_authority_code
          || null;
      }

      function resolveStationKey(row) {
        return row?.station_id
          || row?.station?.id
          || row?.station_ref
          || row?.station?.station_ref
          || row?.station?.ref
          || row?.display_name
          || row?.station?.display_name
          || null;
      }

      function resolveLatestValue(row) {
        const raw = row?.last_value
          ?? row?.latest_value
          ?? row?.value
          ?? row?.observed_value
          ?? row?.lastValue
          ?? row?.latestValue;
        const pollutantKey = getPollutantKeyFromRow(row) || activePollutant;
        return clampValue(raw, pollutantKey);
      }

      function resolveLatestTimestamp(row) {
        return parseDate(row?.last_value_at || row?.observed_at || row?.latest_value_at);
      }

      function resolveCoordinatePair(row) {
        const candidates = [
          [row?.latitude, row?.longitude],
          [row?.lat, row?.lon],
          [row?.lat, row?.lng],
          [row?.station?.latitude, row?.station?.longitude],
          [row?.station?.lat, row?.station?.lon],
          [row?.station?.lat, row?.station?.lng],
        ];
        for (const candidate of candidates) {
          const lat = normalizeNumber(candidate?.[0]);
          const lon = normalizeNumber(candidate?.[1]);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return { lat, lon };
          }
        }
        return { lat: null, lon: null };
      }

      function filterRowsByWindow(rows) {
        const cutoff = getWindowCutoff();
        if (!cutoff) {
          return rows;
        }
        return rows.filter((row) => {
          const timestamp = resolveLatestTimestamp(row);
          return isTimestampInWindow(timestamp, cutoff);
        });
      }

      function extractPollutantText(row) {
        return [
          row?.pollutant,
          row?.pollutant_label,
          row?.phenomenon_label,
          row?.phenomenon?.pollutant_label,
          row?.phenomenon?.notation,
          row?.phenomenon?.label,
        ].filter(Boolean).join(" ").trim().toLowerCase();
      }

      function getPollutantKeyFromText(value) {
        return pollutantDomain.matchText(value);
      }

      function getPollutantKeyFromRow(row) {
        return getPollutantKeyFromText(extractPollutantText(row));
      }

      function normalizePollutantKey(value) {
        if (!value) {
          return null;
        }
        const trimmed = String(value).trim().toLowerCase();
        if (!trimmed) {
          return null;
        }
        return getPollutantKeyFromText(trimmed);
      }

      function isPm25Row(row) {
        return getPollutantKeyFromRow(row) === "pm25";
      }

      function rowMatchesPollutant(row, pollutantKey) {
        if (!pollutantKey) {
          return false;
        }
        const key = getPollutantKeyFromRow(row);
        return key === pollutantKey;
      }

      function getRowsForActivePollutant(rows) {
        if (!rows.length) {
          return rows;
        }
        const hintKey = latestPollutant;
        if (hintKey && hintKey === activePollutant) {
          return rows;
        }
        const hasLabels = rows.some((row) => extractPollutantText(row));
        if (!hintKey && !hasLabels) {
          return rows;
        }
        return rows.filter((row) => rowMatchesPollutant(row, activePollutant));
      }



      function collectStationEntries(rows, pconCode) {
        const stationMap = new Map();
        rows.forEach((item, index) => {
          if (resolvePconCode(item) !== pconCode) {
            return;
          }
          const stationKey = resolveStationKey(item) || `${pconCode}-${index}`;
          const timestamp = resolveLatestTimestamp(item);
          const value = resolveLatestValue(item);
          const normalizedValue = Number.isFinite(value) ? value : null;
          const existing = stationMap.get(stationKey);
          if (!existing) {
            stationMap.set(stationKey, { row: item, value: normalizedValue, timestamp });
            return;
          }
          if (timestamp && (!existing.timestamp || timestamp > existing.timestamp)) {
            stationMap.set(stationKey, { row: item, value: normalizedValue, timestamp });
            return;
          }
          if (!existing.timestamp && !timestamp && existing.value === null && normalizedValue !== null) {
            stationMap.set(stationKey, { row: item, value: normalizedValue, timestamp });
          }
        });
        return Array.from(stationMap.values());
      }

      function countStationsByNetwork(entries) {
        const counts = new Map();
        entries.forEach((entry) => {
          const label = resolvePrimaryNetworkLabel(entry.row) || "Unknown network";
          counts.set(label, (counts.get(label) || 0) + 1);
        });
        return Array.from(counts.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => a.label.localeCompare(b.label));
      }

      function rowMatchesNetwork(row, matchers) {
        const entries = collectNetworkEntries(row);
        return entries.some((entry) => {
          const label = `${entry.code || ""} ${entry.label || ""}`.toLowerCase();
          return matchers.some((token) => label.includes(token));
        });
      }

      function collectNetworkEntriesByMatcher(rows, matchers) {
        const stationMap = new Map();
        rows.forEach((item, index) => {
          if (!rowMatchesNetwork(item, matchers)) {
            return;
          }
          const value = resolveLatestValue(item);
          if (!Number.isFinite(value)) {
            return;
          }
          const stationKey = resolveStationKey(item) || `network-${index}`;
          const timestamp = resolveLatestTimestamp(item);
          const existing = stationMap.get(stationKey);
          if (!existing || (timestamp && (!existing.timestamp || timestamp > existing.timestamp))) {
            stationMap.set(stationKey, { row: item, value, timestamp });
          }
        });
        return Array.from(stationMap.values());
      }

      function computeNetworkSummary(rows, matchers) {
        const scopedRows = getRowsForActivePollutant(rows);
        const entries = collectNetworkEntriesByMatcher(scopedRows, matchers);
        const totalCount = entries.length;
        const cutoff = getWindowCutoff();
        const reportingEntries = entries.filter((entry) => entry.timestamp
          && isTimestampInWindow(entry.timestamp, cutoff));
        const values = reportingEntries.map((entry) => entry.value).filter((value) => Number.isFinite(value));
        if (!values.length) {
          return {
            totalCount,
            windowCount: reportingEntries.length,
            mean: null,
            median: null,
            highest: null,
            lowest: null,
            coverage: 0,
            latestTimestamp: null,
          };
        }
        const sorted = [...values].sort((a, b) => a - b);
        const midpoint = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
          ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
          : sorted[midpoint];
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        let highest = reportingEntries[0];
        let lowest = reportingEntries[0];
        reportingEntries.forEach((entry) => {
          if (entry.value > highest.value) {
            highest = entry;
          }
          if (entry.value < lowest.value) {
            lowest = entry;
          }
        });
        const coverage = new Set(
          reportingEntries
            .map((entry) => resolvePconCode(entry.row))
            .filter(Boolean)
        ).size;
        const latestTimestamp = reportingEntries.reduce((latest, entry) => {
          if (!entry.timestamp) {
            return latest;
          }
          if (!latest || entry.timestamp > latest) {
            return entry.timestamp;
          }
          return latest;
        }, null);
        return {
          totalCount,
          windowCount: reportingEntries.length,
          mean,
          median,
          highest,
          lowest,
          coverage,
          latestTimestamp,
        };
      }

      function updateExtraNetworkSummaries() {
        if (!extraNetworkSummaryDefs.length) {
          return;
        }
        const pollutantUnits = getPollutantUnits(activePollutant);
        extraNetworkSummaryDefs.forEach((def) => {
          const summary = computeNetworkSummary(scopedLatestRows, def.matchers);
          const sensorLabel = summary.totalCount
            ? (currentWindow === "all"
              ? formatNumber(summary.totalCount)
              : `${formatNumber(summary.windowCount)} in window / ${formatNumber(summary.totalCount)} total`)
            : "0";
          if (def.elements.sensors) {
            def.elements.sensors.textContent = sensorLabel;
          }
          updateCoverageElements(
            def.elements.coverageValue,
            def.elements.coverageFill,
            def.elements.coverageBar,
            summary.coverage,
            TOTAL_PCON_COUNT,
            "constituencies"
          );
          if (def.elements.average) {
            def.elements.average.textContent = Number.isFinite(summary.mean)
              ? `${formatValue(summary.mean)} ${pollutantUnits}`
              : "-";
          }
          if (def.elements.median) {
            def.elements.median.textContent = Number.isFinite(summary.median)
              ? `${formatValue(summary.median)} ${pollutantUnits}`
              : "-";
          }
          if (def.elements.highest) {
            def.elements.highest.textContent = summary.highest
              ? `${formatValue(summary.highest.value)} ${pollutantUnits} · ${formatSummaryTimestamp(summary.highest.timestamp)}`
              : "-";
          }
          if (def.elements.lowest) {
            def.elements.lowest.textContent = summary.lowest
              ? `${formatValue(summary.lowest.value)} ${pollutantUnits} · ${formatSummaryTimestamp(summary.lowest.timestamp)}`
              : "-";
          }
          if (def.elements.latest) {
            def.elements.latest.textContent = summary.latestTimestamp
              ? formatSummaryTimestamp(summary.latestTimestamp)
              : "-";
          }
        });
      }

      function updateOverallSummary() {
        if (!summaryStations || !summaryLowestValue || !summaryLowestDatetime || !summaryLowestConnector
          || !summaryLowestName || !summaryHighestValue || !summaryHighestDatetime
          || !summaryHighestConnector || !summaryHighestName) {
          return;
        }
        const pollutantLabel = getPollutantLabel(activePollutant);
        const pollutantUnits = getPollutantUnits(activePollutant);
        updatePollutantLabels();
        if (overallSummaryTitle) {
          overallSummaryTitle.textContent = `${pollutantLabel} summary`;
        }
        if (!pconRows.length) {
          summaryStations.textContent = "-";
        } else {
          const totalStations = pconRows.reduce((total, row) => {
            const count = normalizeNumber(row.station_count);
            return total + (count ?? 0);
          }, 0);
          summaryStations.textContent = formatNumber(totalStations);
        }

        const summaryBaseRows = filterRowsByWindow(scopedLatestRows);
        const rowsForSummary = getRowsForActivePollutant(summaryBaseRows);
        const rowsWithPcon = rowsForSummary.filter((row) => resolvePconCode(row));
        let candidates = rowsWithPcon
          .map((row) => {
            const value = resolveLatestValue(row);
            if (!Number.isFinite(value)) {
              return null;
            }
            return { row, value };
          })
          .filter(Boolean);

        if (!candidates.length) {
          summaryLowestValue.textContent = "-";
          summaryLowestDatetime.textContent = "-";
          summaryLowestConnector.textContent = "-";
          summaryLowestName.textContent = `No ${pollutantLabel} data`;
          summaryHighestValue.textContent = "-";
          summaryHighestDatetime.textContent = "-";
          summaryHighestConnector.textContent = "-";
          summaryHighestName.textContent = `No ${pollutantLabel} data`;
          return;
        }

        const nonZeroThreshold = getNonZeroThreshold();
        const candidatesForLowest = candidates.filter(({ value }) => value > nonZeroThreshold);
        const lowestPool = candidatesForLowest.length ? candidatesForLowest : candidates;

        let lowest = lowestPool[0];
        for (const candidate of lowestPool) {
          if (candidate.value < lowest.value) {
            lowest = candidate;
          }
        }

        let highest = candidates[0];
        for (const candidate of candidates) {
          if (candidate.value > highest.value) {
            highest = candidate;
          }
        }

        summaryLowestValue.textContent = `${formatValue(lowest.value)} ${pollutantUnits}`;
        summaryLowestDatetime.textContent = formatSummaryTimestamp(resolveLatestTimestamp(lowest.row));
        summaryLowestConnector.textContent = resolveConnectorLabel(lowest.row);
        summaryLowestName.textContent = resolveStationName(lowest.row);
        summaryHighestValue.textContent = `${formatValue(highest.value)} ${pollutantUnits}`;
        summaryHighestDatetime.textContent = formatSummaryTimestamp(resolveLatestTimestamp(highest.row));
        summaryHighestConnector.textContent = resolveConnectorLabel(highest.row);
        summaryHighestName.textContent = resolveStationName(highest.row);
      }

      function updateSummary() {
        updateOverallSummary();
        const selectedNetworkSummary = buildSelectedNetworkSummary();
        if (networkSummaryCardsComponent) {
          networkSummaryCardsComponent.render(selectedNetworkSummary);
        }
        if (sensorShareBars) {
          sensorShareBars.render(selectedNetworkSummary.shareData || []);
        }
        // ── Top summary boxes ──
        if (summaryPresenter?.updateSummary) {
          const pollutantLabel = getPollutantLabel(activePollutant);
          const pollutantUnits = getPollutantUnits(activePollutant);
          const capValue = getLegendCapValue();
          const totalSensorsForTopSummary = pconRows.reduce((total, row) => {
            const count = normalizeNumber(row.station_count);
            return total + (count ?? 0);
          }, 0);
          const baseRows = filterRowsByWindow(scopedLatestRows);
          const pollutantRows = getRowsForActivePollutant(baseRows);
          const candidates = pollutantRows
            .map((row) => { const v = resolveLatestValue(row); return Number.isFinite(v) ? { row, value: v } : null; })
            .filter(Boolean);
          let highestValue = null, highestColor = null, highestSensor = '—', highestNetwork = '—';
          if (candidates.length) {
            let h = candidates[0];
            for (const c of candidates) { if (c.value > h.value) h = c; }
            highestValue = h.value;
            const palette = HEAT_STOPS.map((n, i) => resolveCssColor(n, HEAT_STOP_FALLBACKS[i]));
            highestColor = d3.interpolateRgbBasis(palette)(mapValueToT(highestValue, capValue));
            highestSensor = resolveStationName(h.row);
            highestNetwork = resolvePrimaryNetworkLabel(h.row) || "Unknown network";
          }
          summaryPresenter.updateSummary({
            totalSensors: totalSensorsForTopSummary,
            pconCovered: selectedNetworkSummary.pconCovered,
            pconTotal: selectedNetworkSummary.pconTotal,
            areaLabel: 'constituencies',
            pollutantLabel,
            pollutantUnits,
            highestValue,
            highestColor,
            highestSensor,
            highestNetwork,
            newestReadingISO: selectedNetworkSummary.newestReadingISO,
            oldestReadingISO: selectedNetworkSummary.oldestReadingISO,
          });
        }
      }

      function updateRowCountText() {
        if (!rowCount) {
          return;
        }
        const withData = pconRows.filter((row) => getStationCount(row) > 0);
        const pollutantLabel = getPollutantLabel(activePollutant);
        rowCount.textContent = `${formatNumber(withData.length)} of ${formatNumber(pconCodes.size)} constituencies with ${pollutantLabel} data`;
      }

      function updateLegend(minValue, maxValue, capValue) {
        legendLabel.textContent = METRIC_LABELS[currentMetric];
        if (minValue === null || maxValue === null || capValue === null) {
          legendMin.textContent = "-";
          legendMax.textContent = "-";
          return;
        }
        legendMin.textContent = String(Math.round(minValue));
        legendMax.textContent = `${Math.round(capValue)}+`;
      }

      function mapValueToT(value, capValue) {
        if (!Number.isFinite(value) || !Number.isFinite(capValue) || capValue <= 0) {
          return 0;
        }
        const clamped = Math.max(0, Math.min(capValue, value));
        const ratio = clamped / capValue;
        if (currentColorScale === "linear") {
          return Math.max(0, Math.min(1, ratio));
        }
        const exponent = 0.8;
        const base = Math.pow(ratio, exponent);
        const boosted = base + 0.05 * base * base; // small top boost to keep 40 near ~87%
        return Math.max(0, Math.min(1, boosted));
      }

      function updateLegendTicks(capValue) {
        if (!legendTicks.length || !legendTickLabels.length) {
          return;
        }
        const tickValues = capValue >= 100 ? [20, 40, 60, 80] : [10, 20, 30, 40];
        legendTicks.forEach((element, index) => {
          const value = tickValues[index] ?? null;
          if (value === null) {
            return;
          }
          element.dataset.value = String(value);
        });
        legendTickLabels.forEach((element, index) => {
          const value = tickValues[index] ?? null;
          if (value === null) {
            return;
          }
          element.dataset.value = String(value);
          element.textContent = String(value);
        });
        const updatePosition = (element) => {
          const value = Number(element.dataset.value);
          if (!Number.isFinite(value)) {
            return;
          }
          const t = mapValueToT(value, capValue);
          element.style.left = `${(t * 100).toFixed(1)}%`;
        };
        legendTicks.forEach(updatePosition);
        legendTickLabels.forEach(updatePosition);
        if (legendScale) {
          legendScale.classList.add("is-ready");
        }
      }

      function updateSelectedHexStyles() {
        const hexes = svg.selectAll(".hex");
        if (!hexes.size()) {
          return;
        }
        if (!selectedPconCode) {
          hexes.classed("is-selected", false).classed("is-dimmed", false);
          return;
        }
        hexes
          .classed("is-selected", (cell) => cell.pcon_code === selectedPconCode)
          .classed("is-dimmed", (cell) => cell.pcon_code !== selectedPconCode);
      }

      function setSelectedCell(cell) {
        selectedCell = cell || null;
        selectedPconCode = cell?.pcon_code || null;
        if (mapCanvasWrap) mapCanvasWrap.classList.toggle("hex-selected", !!cell);
        pinnedTooltipCell = null;
        if (tooltip) {
          tooltip.classList.remove("visible");
        }
        updateSelectedHexStyles();
        updateSummary();
        updateDetailsPanel();
        updateSelectedHexViewportShift();
      }

      function updateSelectedHexViewportShift() {
        if (!mapCanvasWrap) {
          return;
        }
        if (!selectedPconCode) {
          mapCanvasWrap.style.removeProperty("--selected-hex-shift-y");
          return;
        }
        window.requestAnimationFrame(() => {
          if (!selectedPconCode || !mapCanvasWrap) {
            return;
          }
          mapCanvasWrap.style.setProperty("--selected-hex-shift-y", "0px");
          const selectedHex = svg.node()?.querySelector(".hex.is-selected");
          const viewport = mapCanvasWrap.querySelector(".map-svg-viewport");
          if (!selectedHex || !viewport) {
            return;
          }
          const hexRect = selectedHex.getBoundingClientRect();
          const viewportRect = viewport.getBoundingClientRect();
          const panelHeight = Number.parseFloat(getComputedStyle(mapCanvasWrap).getPropertyValue("--sensor-panel-height")) || 240;
          const visibleHeight = Math.max(120, viewportRect.height - panelHeight);
          const targetY = viewportRect.top + (visibleHeight / 2);
          const hexY = hexRect.top + (hexRect.height / 2);
          const maxShiftY = Math.max(panelHeight * 0.3, viewportRect.height * 0.35);
          const shiftY = Math.max(-maxShiftY, Math.min(maxShiftY, targetY - hexY));
          mapCanvasWrap.style.setProperty("--selected-hex-shift-y", `${shiftY.toFixed(1)}px`);
        });
      }

      function selectPconByCode(code) {
        const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
        if (!normalized) {
          return false;
        }
        const match = hexCells.find((cell) => {
          const cellCode = typeof cell?.pcon_code === "string" ? cell.pcon_code.trim().toUpperCase() : "";
          return cellCode === normalized;
        }) || null;
        if (!match) {
          return false;
        }
        setSelectedCell(match);
        if (tooltip) {
          tooltip.classList.remove("visible");
        }
        pinnedTooltipCell = null;
        return true;
      }

      function compareTextValues(a, b) {
        const left = a ? String(a) : "";
        const right = b ? String(b) : "";
        if (!left && !right) {
          return 0;
        }
        if (!left) {
          return 1;
        }
        if (!right) {
          return -1;
        }
        return left.localeCompare(right, undefined, { sensitivity: "base" });
      }

      function compareNumericValues(a, b) {
        const left = Number.isFinite(a) ? a : null;
        const right = Number.isFinite(b) ? b : null;
        if (left === null && right === null) {
          return 0;
        }
        if (left === null) {
          return 1;
        }
        if (right === null) {
          return -1;
        }
        return left - right;
      }

      function getEntrySortValue(entry, key) {
        if (key === "sensor") {
          return resolveStationName(entry.row) || "";
        }
        if (key === "network") {
          return resolvePrimaryNetworkLabel(entry.row) || "Unknown network";
        }
        if (key === "pm25") {
          return entry.value;
        }
        if (key === "updated") {
          return entry.timestamp instanceof Date ? entry.timestamp.getTime() : null;
        }
        return "";
      }

      function compareEntries(a, b, key) {
        const left = getEntrySortValue(a, key);
        const right = getEntrySortValue(b, key);
        if (key === "sensor" || key === "network") {
          return compareTextValues(left, right);
        }
        return compareNumericValues(left, right);
      }

      function sortDetailEntries(entries) {
        const activeKey = sortKey;
        const direction = sortDir;
        entries.sort((a, b) => {
          if (a.inWindow !== b.inWindow) {
            return a.inWindow ? -1 : 1;
          }
          const cmp = compareEntries(a, b, activeKey);
          if (cmp !== 0) {
            return direction === "asc" ? cmp : -cmp;
          }
          return compareTextValues(
            getEntrySortValue(a, "sensor"),
            getEntrySortValue(b, "sensor")
          );
        });
      }

      function syncSortHeaders() {
        const ACTIVE_ARIA = {
          sensor: { asc: "Sensor, sorted A to Z. Click to sort Z to A.", desc: "Sensor, sorted Z to A. Click to sort A to Z." },
          network: { asc: "Network, sorted A to Z. Click to sort Z to A.", desc: "Network, sorted Z to A. Click to sort A to Z." },
          pm25: { asc: "PM2.5, sorted low to high. Click to sort high to low.", desc: "PM2.5, sorted high to low. Click to sort low to high." },
          updated: { asc: "Updated, sorted oldest first. Click to sort newest first.", desc: "Updated, sorted newest first. Click to sort oldest first." },
        };
        const sortingHidden = detailsTableWrap?.classList.contains("sensor-list-sort-hidden") === true;
        sortHeaderButtons.forEach((button) => {
          const key = button.dataset.sortKey;
          const isActive = key === sortKey;
          const direction = getSortDirection(key, sortKey, sortDir);
          const th = button.closest("th");
          button.classList.toggle("is-active", isActive && !sortingHidden);
          button.disabled = sortingHidden;
          button.tabIndex = sortingHidden ? -1 : 0;
          if (th) th.setAttribute("aria-sort", !sortingHidden && isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none");
          const icon = button.querySelector(".sort-icon,.sort-arrow");
          if (icon) {
            icon.textContent = sortingHidden ? "" : renderSortIcon(key, sortKey, sortDir);
          }
          if (sortingHidden) {
            button.setAttribute("aria-label", "");
            button.title = "";
          } else if (isActive) {
            button.setAttribute("aria-label", ACTIVE_ARIA[key]?.[sortDir] || "");
            button.title = "";
          } else {
            button.setAttribute("aria-label", "");
            button.title = getSortTooltip(key, sortKey, sortDir);
          }
        });
      }

      function updateInlinePanelHeight(sensorCount, extraRowCount = 0) {
        if (!mapCanvasWrap) {
          return;
        }
        const count = Math.max(0, Number(sensorCount) || 0);
        const totalRows = count + Math.max(0, Number(extraRowCount) || 0);
        const hasOverflowByCount = totalRows > SENSOR_PANEL_MAX_VISIBLE_ROWS;
        const visibleRows = Math.min(totalRows, SENSOR_PANEL_MAX_VISIBLE_ROWS);
        const effectiveRowHeight = SENSOR_PANEL_ROW_HEIGHT;
        const tableWrapMaxHeight = SENSOR_TABLE_HEADER_HEIGHT + (visibleRows * effectiveRowHeight);
        const panelHeight = count
          ? SENSOR_PANEL_HEADER_HEIGHT
            + SENSOR_TABLE_HEADER_HEIGHT
            + (visibleRows * effectiveRowHeight)
          : SENSOR_PANEL_EMPTY_HEIGHT;
        mapCanvasWrap.style.setProperty("--sensor-panel-height", `${panelHeight}px`);
        if (inlinePanelBody) {
          inlinePanelBody.classList.toggle("is-scroll-forced", hasOverflowByCount);
        }
        if (detailsTableWrap) {
          detailsTableWrap.style.maxHeight = `${tableWrapMaxHeight}px`;
          const hasOverflowByContent = detailsTableWrap.scrollHeight > (tableWrapMaxHeight + 1);
          const hasOverflow = hasOverflowByCount || hasOverflowByContent;
          detailsTableWrap.style.overflowY = hasOverflow ? "scroll" : "hidden";
          detailsTableWrap.classList.toggle("is-scroll-forced", hasOverflow);
          inlinePanelBody?.classList.toggle("is-scroll-forced", hasOverflow);
        }
        detailScrollAffordances?.update?.();
      }

      function updateDetailsPanel() {
        if (!detailsTitle || !detailsMeta || !detailsEmpty || !detailsTableWrap || !detailsTableBody) {
          return;
        }
        const pollutantUnits = getPollutantUnits(activePollutant);
        const previousScrollTop = detailsTableWrap.scrollTop;
        if (!selectedPconCode) {
          chartLaunchAvailable = false;
          syncInlinePanelTitleInteractivity();
          if (sensorDetailsSection) sensorDetailsSection.hidden = true;
          detailsTitle.textContent = "Constituency sensors";
          detailsMeta.textContent = "Click a hex to view sensors.";
          if (inlinePanelWindowLabel) inlinePanelWindowLabel.textContent = "Select a hex";
          if (inlinePanelTitle) inlinePanelTitle.textContent = "";
          if (inlinePanelReading) inlinePanelReading.textContent = "";
          if (inlinePanelNetworkLabel) inlinePanelNetworkLabel.textContent = "";
          if (inlinePanelCount) inlinePanelCount.textContent = "";
          detailsEmpty.hidden = true;
          detailsTableWrap.hidden = true;
          detailsTableWrap.classList.add("sensor-list-sort-hidden");
          detailsTableWrap.classList.remove("is-chart-select-mode");
          syncSortHeaders();
          updateInlinePanelHeight(0);
          if (networkSummary) networkSummary.hidden = true;
          detailsTableBody.innerHTML = "";
          restoreDetailsScrollPosition("", 0);
          return;
        }
        if (sensorDetailsSection) sensorDetailsSection.hidden = true;
        if (networkSummary) networkSummary.hidden = true;
        const row = pconLookup.get(selectedPconCode);
        const areaName = selectedCell?.pcon_name || row?.pcon_name || selectedPconCode;
        detailsTitle.textContent = areaName;
        const metricVal = getMetricValue(row);
        const valueLabel = Number.isFinite(metricVal)
          ? `${formatValue(metricVal)} ${pollutantUnits}`
          : "No data";
        const methodDisplayLabel = currentMetric === "median" ? "Typical (median)" : "Average (mean)";
        if (inlinePanelWindowLabel) inlinePanelWindowLabel.textContent = "";
        if (inlinePanelTitle) inlinePanelTitle.textContent = areaName;
        if (inlinePanelReading) {
          inlinePanelReading.innerHTML = `<span class="sensor-panel-value">${valueLabel}</span> <span class="sensor-panel-method">${methodDisplayLabel}</span>`;
        }
        if (inlinePanelNetworkLabel) inlinePanelNetworkLabel.textContent = "";
        if (inlinePanelHexIcon) {
          const iconColor = (colorScale && Number.isFinite(metricVal)) ? colorScale(metricVal) : "var(--ink-soft)";
          inlinePanelHexIcon.style.color = iconColor;
        }
        const detailSourceRows = scopedLatestRowsAllWindow.length ? scopedLatestRowsAllWindow : scopedLatestRows;
        const scopedRows = getRowsForActivePollutant(detailSourceRows);
        const stationEntries = collectStationEntries(scopedRows, selectedPconCode);
        chartLaunchAvailable = stationEntries.length > 0;
        syncInlinePanelTitleInteractivity();
        if (!stationEntries.length) {
          const zeroCount = formatSelectedAreaSensorCount(0, 0);
          detailsMeta.textContent = zeroCount;
          if (inlinePanelCount) inlinePanelCount.textContent = zeroCount;
          if (inlinePanelReading) inlinePanelReading.textContent = "";
          if (inlinePanelHexIcon) {
            inlinePanelHexIcon.style.color = "var(--no-data)";
            inlinePanelHexIcon.classList.add("sensor-panel-hex-icon--outlined");
          }
          detailsEmpty.textContent = "No sensors found for this constituency.";
          detailsEmpty.hidden = false;
          detailsTableWrap.hidden = true;
          detailsTableWrap.classList.add("sensor-list-sort-hidden");
          detailsTableWrap.classList.remove("is-chart-select-mode");
          syncSortHeaders();
          detailsTableBody.innerHTML = "";
          updateInlinePanelHeight(0);
          updateSelectedHexViewportShift();
          return;
        }
        const cutoff = getWindowCutoff();
        const entries = stationEntries.map((entry) => ({
          ...entry,
          inWindow: isTimestampInWindow(entry.timestamp, cutoff),
        }));
        sortDetailEntries(entries);
        const outsideWindowCount = entries.filter((entry) => !entry.inWindow).length;
        const inWindowCount = entries.length - outsideWindowCount;
        const countText = formatSelectedAreaSensorCount(inWindowCount, outsideWindowCount);
        detailsMeta.textContent = countText;
        if (inlinePanelCount) {
          inlinePanelCount.textContent = countText;
        }
        if (inlinePanelHexIcon) {
          inlinePanelHexIcon.classList.remove("sensor-panel-hex-icon--outlined");
        }
        const chartModeActive = window.hexChartMode?.isActive?.("uk") === true;
        detailsEmpty.hidden = true;
        detailsTableWrap.hidden = false;
        detailsTableWrap.classList.toggle("sensor-list-sort-hidden", entries.length <= 1);
        detailsTableWrap.classList.toggle("is-chart-select-mode", chartModeActive);
        syncSortHeaders();
        networkSummary.hidden = true;
        const renderSensorRow = (entry) => {
          const stationName = resolveStationName(entry.row);
          const stationId = String(resolveStationKey(entry.row) || stationName || "");
          const networkLabel = resolvePrimaryNetworkLabel(entry.row) || "Unknown network";
          const updatedText = formatSummaryTimestamp(entry.timestamp);
          const chartSelected = window.hexChartMode?.isSensorSelected?.("uk", stationId) === true;
          const symbolIndex = window.hexChartMode?.getSelectedSensorIndex?.("uk", stationId) ?? -1;
          const symbolMarkup = symbolIndex >= 0
              ? (window.ChartCore?.getSymbolSvgMarkup?.(symbolIndex, {
                className: "hex-chart-symbol-svg chart-mode-sensor-symbol-svg",
                sizePx: 28,
                area: 160,
                fill: "#3C78AC",
                stroke: "#fff",
                strokeWidth: 1.2,
              }) || "")
            : "";
          const rowClass = [
            entry.inWindow ? "" : "sensor-row--excluded",
            chartSelected ? "sensor-row--chart-selected" : "",
          ].filter(Boolean).join(" ");
          const readingColor = colorScale && Number.isFinite(entry.value) ? colorScale(entry.value) : "var(--no-data)";
          return `
            <tr class="${rowClass}">
              <td class="sensor-chart-select-col">${
                chartModeActive
                  ? `<button type="button" class="hex-chart-selector" data-station-id="${escapeHtmlLocal(stationId)}" aria-label="${chartSelected ? "Remove" : "Add"} ${escapeHtmlLocal(stationName)} from chart" aria-pressed="${chartSelected ? "true" : "false"}"></button>`
                  : ""
              }</td>
              <td class="sensor-chart-symbol-col">${
                chartModeActive
                  ? symbolMarkup
                  : `<button type="button" class="sensor-chart-launch" data-station-id="${escapeHtmlLocal(stationId)}" aria-label="Open chart for ${escapeHtmlLocal(stationName)}" title="Open chart">
                      <img src="/images/UK-AQ-Sensor-Buttons-chart.svg" alt="" aria-hidden="true" />
                    </button>`
              }</td>
              <td class="sensor-col-sensor"><button type="button" class="sensor-name-button" data-station-id="${escapeHtmlLocal(stationId)}">${escapeHtmlLocal(stationName)}</button></td>
              <td class="sensor-col-network">${escapeHtmlLocal(networkLabel)}</td>
              <td class="sensor-col-value"><span class="sensor-reading-cell"><span class="sensor-reading-dot" style="--sensor-reading-color:${readingColor}"></span><span class="sensor-reading-text">${Number.isFinite(entry.value) ? `${formatValue(entry.value)} ${pollutantUnits}` : "-"}</span></span></td>
              <td class="sensor-col-updated">${updatedText}</td>
            </tr>
          `;
        };
        const inWindowEntries = entries.filter((entry) => entry.inWindow);
        const outsideWindowEntries = entries.filter((entry) => !entry.inWindow);
        const dividerRow = inWindowEntries.length && outsideWindowEntries.length
          ? `<tr class="sensor-row-divider" aria-hidden="true"><td colspan="6">↓ OUTSIDE WINDOW ↓</td></tr>`
          : "";
        detailsTableBody.innerHTML = [
          inWindowEntries.map(renderSensorRow).join(""),
          dividerRow,
          outsideWindowEntries.map(renderSensorRow).join(""),
        ].join("");
        updateInlinePanelHeight(entries.length, dividerRow ? 1 : 0);
        updateSelectedHexViewportShift();
      }

      function updateNetworkSummary() {
        if (!aurnSensors || !aurnCoverageValue || !aurnCoverageBar || !aurnCoverageFill || !aurnAverage || !aurnMedian || !aurnHighest || !aurnLowest || !aurnLatest) {
          return;
        }
        const pollutantUnits = getPollutantUnits(activePollutant);
        const summary = computeNetworkSummary(scopedLatestRows, GOVUK_NETWORK_MATCHERS);
        const sensorLabel = currentWindow === "all"
          ? formatNumber(summary.totalCount)
          : `${formatNumber(summary.windowCount)} in window / ${formatNumber(summary.totalCount)} total`;
        aurnSensors.textContent = summary.totalCount ? sensorLabel : "0";
        const covered = summary.coverage;
        const total = TOTAL_PCON_COUNT;
        updateCoverageElements(
          aurnCoverageValue,
          aurnCoverageFill,
          aurnCoverageBar,
          covered,
          total,
          "constituencies"
        );
        aurnAverage.textContent = Number.isFinite(summary.mean)
          ? `${formatValue(summary.mean)} ${pollutantUnits}`
          : "-";
        aurnMedian.textContent = Number.isFinite(summary.median)
          ? `${formatValue(summary.median)} ${pollutantUnits}`
          : "-";
        aurnHighest.textContent = summary.highest
          ? `${formatValue(summary.highest.value)} ${pollutantUnits} · ${formatSummaryTimestamp(summary.highest.timestamp)}`
          : "-";
        aurnLowest.textContent = summary.lowest
          ? `${formatValue(summary.lowest.value)} ${pollutantUnits} · ${formatSummaryTimestamp(summary.lowest.timestamp)}`
          : "-";
        aurnLatest.textContent = summary.latestTimestamp
          ? formatSummaryTimestamp(summary.latestTimestamp)
          : "-";
        updateExtraNetworkSummaries();
      }

      function clearMap() {
        svg.selectAll("*").remove();
      }

      function offsetToPixel(layout, q, r, size) {
        if (layout === "odd-r") {
          return {
            x: size * Math.sqrt(3) * (q + 0.5 * (r & 1)),
            y: size * 1.5 * r,
          };
        }
        if (layout === "even-r") {
          return {
            x: size * Math.sqrt(3) * (q + 0.5 * ((r + 1) & 1)),
            y: size * 1.5 * r,
          };
        }
        if (layout === "odd-q") {
          return {
            x: size * 1.5 * q,
            y: size * Math.sqrt(3) * (r + 0.5 * (q & 1)),
          };
        }
        if (layout === "even-q") {
          return {
            x: size * 1.5 * q,
            y: size * Math.sqrt(3) * (r + 0.5 * ((q + 1) & 1)),
          };
        }
        return {
          x: size * Math.sqrt(3) * (q + r / 2),
          y: size * 1.5 * r,
        };
      }

      function computeHexBounds(cells, side) {
        const dx = (Math.sqrt(3) / 2) * side;
        const dy = side;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        cells.forEach((cell) => {
          const left = cell.cx - dx;
          const right = cell.cx + dx;
          const bottom = cell.cy - dy;
          const top = cell.cy + dy;
          if (left < minX) {
            minX = left;
          }
          if (bottom < minY) {
            minY = bottom;
          }
          if (right > maxX) {
            maxX = right;
          }
          if (top > maxY) {
            maxY = top;
          }
        });
        return { minX, minY, maxX, maxY };
      }

      function buildHexCellsFromHexjson(hexjson) {
        const layout = typeof hexjson?.layout === "string" ? hexjson.layout : "odd-r";
        const entries = Object.entries(hexjson?.hexes || {});
        const size = 1;
        const cells = entries.map(([key, value]) => {
          const q = Number(value?.q ?? value?.col ?? 0);
          const r = Number(value?.r ?? value?.row ?? 0);
          const { x, y } = offsetToPixel(layout, q, r, size);
          return {
            id: key,
            cx: x,
            cy: y,
            q,
            r,
            pcon_code: key,
            pcon_name: value?.n || null,
            region_code: value?.region || null,
            region_name: REGION_NAMES[value?.region] || null,
          };
        });
        return { cells, bounds: computeHexBounds(cells, size), side: size, layout };
      }

      function offsetToAxial(layout, col, row) {
        if (layout === "odd-r") {
          return { q: col - (row - (row & 1)) / 2, r: row };
        }
        if (layout === "even-r") {
          return { q: col - (row + (row & 1)) / 2, r: row };
        }
        if (layout === "odd-q") {
          return { q: col, r: row - (col - (col & 1)) / 2 };
        }
        if (layout === "even-q") {
          return { q: col, r: row - (col + (col & 1)) / 2 };
        }
        return { q: col, r: row };
      }

      function axialToOffset(layout, q, r) {
        if (layout === "odd-r") {
          return { col: q + (r - (r & 1)) / 2, row: r };
        }
        if (layout === "even-r") {
          return { col: q + (r + (r & 1)) / 2, row: r };
        }
        if (layout === "odd-q") {
          return { col: q, row: r + (q - (q & 1)) / 2 };
        }
        if (layout === "even-q") {
          return { col: q, row: r + (q + (q & 1)) / 2 };
        }
        return { col: q, row: r };
      }

      function getEdgeDirectionMap(layout) {
        if (EDGE_DIRECTION_CACHE.has(layout)) {
          return EDGE_DIRECTION_CACHE.get(layout);
        }
        const size = 1;
        const center = offsetToPixel(layout, 0, 0, size);
        const points = hexPoints(center.x, center.y, size);
        const edgeVectors = points.map((point, index) => {
          const next = points[(index + 1) % 6];
          return {
            x: (point[0] + next[0]) / 2 - center.x,
            y: (point[1] + next[1]) / 2 - center.y,
          };
        });
        const directionVectors = AXIAL_DIRECTIONS.map((dir) => {
          const offset = axialToOffset(layout, dir.q, dir.r);
          const neighbor = offsetToPixel(layout, offset.col, offset.row, size);
          return {
            x: neighbor.x - center.x,
            y: neighbor.y - center.y,
          };
        });
        const map = edgeVectors.map((edgeVector) => {
          let bestIndex = 0;
          let bestScore = -Infinity;
          const edgeLength = Math.hypot(edgeVector.x, edgeVector.y) || 1;
          directionVectors.forEach((directionVector, directionIndex) => {
            const dirLength = Math.hypot(directionVector.x, directionVector.y) || 1;
            const score = (edgeVector.x * directionVector.x + edgeVector.y * directionVector.y)
              / (edgeLength * dirLength);
            if (score > bestScore) {
              bestScore = score;
              bestIndex = directionIndex;
            }
          });
          return bestIndex;
        });
        EDGE_DIRECTION_CACHE.set(layout, map);
        return map;
      }

      function neighborForEdge(layout, col, row, edgeIndex) {
        const axial = offsetToAxial(layout, col, row);
        const directionIndex = getEdgeDirectionMap(layout)[edgeIndex];
        const direction = AXIAL_DIRECTIONS[directionIndex];
        const neighborAxial = { q: axial.q + direction.q, r: axial.r + direction.r };
        return axialToOffset(layout, neighborAxial.q, neighborAxial.r);
      }

      function buildPathsFromSegments(segments) {
        const pointKey = (point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
        const adjacency = new Map();
        segments.forEach((segment, index) => {
          const startKey = pointKey(segment.start);
          const endKey = pointKey(segment.end);
          if (!adjacency.has(startKey)) {
            adjacency.set(startKey, []);
          }
          if (!adjacency.has(endKey)) {
            adjacency.set(endKey, []);
          }
          adjacency.get(startKey).push(index);
          adjacency.get(endKey).push(index);
        });
        const unused = new Set(segments.map((_, index) => index));
        const paths = [];
        const takeSegment = (key) => {
          const candidates = adjacency.get(key);
          if (!candidates) {
            return null;
          }
          const nextIndex = candidates.find((index) => unused.has(index));
          if (nextIndex === undefined) {
            return null;
          }
          unused.delete(nextIndex);
          return nextIndex;
        };
        while (unused.size) {
          const index = unused.values().next().value;
          unused.delete(index);
          const segment = segments[index];
          const path = [segment.start, segment.end];
          let startKey = pointKey(segment.start);
          let endKey = pointKey(segment.end);
          while (true) {
            const nextIndex = takeSegment(endKey);
            if (nextIndex === null) {
              break;
            }
            const nextSegment = segments[nextIndex];
            const nextPoint = pointKey(nextSegment.start) === endKey
              ? nextSegment.end
              : nextSegment.start;
            path.push(nextPoint);
            endKey = pointKey(nextPoint);
          }
          while (true) {
            const prevIndex = takeSegment(startKey);
            if (prevIndex === null) {
              break;
            }
            const prevSegment = segments[prevIndex];
            const prevPoint = pointKey(prevSegment.start) === startKey
              ? prevSegment.end
              : prevSegment.start;
            path.unshift(prevPoint);
            startKey = pointKey(prevPoint);
          }
          paths.push(path);
        }
        return paths;
      }

      function regionCountry(regionCode) {
        if (!regionCode) {
          return null;
        }
        return String(regionCode).trim().charAt(0) || null;
      }

      function boundaryType(regionCode, neighborCode) {
        const country = regionCountry(regionCode);
        const neighborCountry = regionCountry(neighborCode) || country;
        if (!neighborCode) {
          return null;
        }
        if (country && neighborCountry && country !== neighborCountry) {
          return "country";
        }
        return "region";
      }

      function buildRegionBoundaryPaths(cells, layout) {
        const cellLookup = new Map(cells.map((cell) => [`${cell.q},${cell.r}`, cell]));
        const segmentsByType = { region: [], country: [] };
        cells.forEach((cell) => {
          const points = hexPoints(cell.cx, cell.cy, 1);
          for (let edgeIndex = 0; edgeIndex < 6; edgeIndex += 1) {
            const neighborOffset = neighborForEdge(layout, cell.q, cell.r, edgeIndex);
            const neighborKey = `${neighborOffset.col},${neighborOffset.row}`;
            const neighbor = cellLookup.get(neighborKey);
            if (!neighbor) {
              continue;
            }
            const neighborRegion = neighbor?.region_code || null;
            if (neighborRegion === cell.region_code) {
              continue;
            }
            if (neighborRegion && cell.region_code && cell.region_code > neighborRegion) {
              continue;
            }
            const type = boundaryType(cell.region_code, neighborRegion);
            if (!type) {
              continue;
            }
            segmentsByType[type].push({
              start: points[edgeIndex],
              end: points[(edgeIndex + 1) % 6],
            });
          }
        });
        return Object.entries(segmentsByType)
          .map(([type, segments]) => ({
            type,
            paths: buildPathsFromSegments(segments),
          }))
          .filter((boundary) => boundary.paths.length);
      }

      function prepareHexGrid() {
        if (!hexData || hexCells.length) {
          return;
        }
        const { cells, bounds, side, layout } = buildHexCellsFromHexjson(hexData);
        hexCells = cells;
        hexBounds = bounds;
        hexSide = side;
        hexLayout = layout;
        boundaryPaths = buildRegionBoundaryPaths(cells, layout);
      }

      function createProjection(bounds, width, height, padding) {
        const dataWidth = bounds.maxX - bounds.minX;
        const dataHeight = bounds.maxY - bounds.minY;
        const scale = Math.min(
          (width - padding * 2) / dataWidth,
          (height - padding * 2) / dataHeight,
        );
        const extraX = width - padding * 2 - dataWidth * scale;
        const extraY = height - padding * 2 - dataHeight * scale;
        return (point) => ([
          (point[0] - bounds.minX) * scale + padding + extraX / 2,
          (bounds.maxY - point[1]) * scale + padding + extraY / 2,
        ]);
      }

      function hexPoints(cx, cy, side) {
        const dx = Math.sqrt(3) / 2 * side;
        const dy = side / 2;
        return [
          [cx, cy + side],
          [cx + dx, cy + dy],
          [cx + dx, cy - dy],
          [cx, cy - side],
          [cx - dx, cy - dy],
          [cx - dx, cy + dy],
        ];
      }

      function applyMetricState() {
        metricInputs.forEach((input) => {
          input.checked = input.value === currentMetric;
        });
        if (metricGroup) {
          metricGroup.dataset.active = currentMetric;
        }
      }

      function setMetric(nextMetric, options = {}) {
        if (!nextMetric) {
          return;
        }
        if (nextMetric === currentMetric) {
          applyMetricState();
          return;
        }
        if (!options.coordinated) {
          coordinator.updateMapSettings({ metric: nextMetric }, { source: "uk" });
          return;
        }
        currentMetric = nextMetric;
        applyMetricState();
        renderMap();
        updateDetailsPanel();
      }

      function getMetricValue(row) {
        if (!row) {
          return null;
        }
        const raw = currentMetric === "mean"
          ? row.mean_value
          : row.median_value;
        return clampValue(raw, activePollutant);
      }

      function getStationCount(row) {
        if (!row) {
          return 0;
        }
        const count = normalizeNumber(row.station_count);
        return count === null ? 0 : count;
      }

      function getActiveNetworkCodes() {
        return networkController.getSelection();
      }

      function getCheckedNetworkEntries() {
        return networkController.getSelectedEntries();
      }

      function selectionIncludesMatcher(entries, matchers) {
        if (!entries.length || !Array.isArray(matchers) || !matchers.length) {
          return false;
        }
        return entries.some((entry) => {
          if (entry.label) {
            return matchers.some((token) => entry.label.includes(token));
          }
          if (entry.code) {
            return matchers.some((token) => entry.code.includes(token));
          }
          return false;
        });
      }

      function updateNetworkSummaryCardVisibility() {
        if (!networkController.getCatalog().length) {
          return;
        }
        const entries = getCheckedNetworkEntries();
        const cardDefs = [
          {
            card: aurnSensors?.closest(".network-card"),
            matchers: GOVUK_NETWORK_MATCHERS,
          },
          ...extraNetworkSummaryDefs.map((def) => ({
            card: def.elements?.sensors?.closest(".network-card"),
            matchers: def.matchers,
          })),
        ];
        cardDefs.forEach((def) => {
          if (!def.card) {
            return;
          }
          def.card.hidden = !selectionIncludesMatcher(entries, def.matchers);
        });
      }

      function filterLatestRowsByNetwork(rows, networkCodes) {
        if (!rows.length) {
          return [];
        }
        return rows.filter((row) => {
          const codes = resolveNetworkCodes(row);
          return codes.some((code) => networkCodes.has(code));
        });
      }

      function buildPconRowsFromLatest(rows) {
        if (!rows.length) {
          return [];
        }
        const groups = new Map();
        const scopedRows = getRowsForActivePollutant(rows);
        scopedRows.forEach((row, index) => {
          const pconCode = resolvePconCode(row);
          if (!pconCode) {
            return;
          }
          const value = resolveLatestValue(row);
          if (!Number.isFinite(value)) {
            return;
          }
          const stationKey = resolveStationKey(row) || `${pconCode}-${index}`;
          const timestamp = parseDate(row?.last_value_at || row?.observed_at || row?.latest_value_at);
          const group = groups.get(pconCode) || { stations: new Map(), latestAt: null };
          const existing = group.stations.get(stationKey);
          if (!existing || (timestamp && (!existing.timestamp || timestamp > existing.timestamp))) {
            group.stations.set(stationKey, { value, timestamp });
          }
          if (timestamp && (!group.latestAt || timestamp > group.latestAt)) {
            group.latestAt = timestamp;
          }
          groups.set(pconCode, group);
        });

        const rowsForMap = [];
        groups.forEach((group, pconCode) => {
          const values = Array.from(group.stations.values())
            .map((entry) => entry.value)
            .filter((value) => Number.isFinite(value));
          if (!values.length) {
            return;
          }
          const sorted = [...values].sort((a, b) => a - b);
          const midpoint = Math.floor(sorted.length / 2);
          const median = sorted.length % 2 === 0
            ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
            : sorted[midpoint];
          const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
          const baseRow = basePconLookup.get(pconCode) || {};
          rowsForMap.push({
            pcon_code: pconCode,
            pcon_name: baseRow.pcon_name || null,
            pcon_version: baseRow.pcon_version || activePconVersion,
            station_count: values.length,
            single_site: values.length === 1,
            median_value: median,
            mean_value: mean,
            latest_value_at: group.latestAt ? group.latestAt.toISOString() : null,
          });
        });
        return rowsForMap;
      }

      function applyNetworkFilters() {
        const networkRowsForWindow = getNetworkRowsForWindow();
        const windowNetworkDefs = buildNetworkDefs(networkRowsForWindow);
        const coverageByCode = buildNetworkCoverageByCode(networkRowsForWindow);
        renderNetworkFiltersIfNeeded(
          windowNetworkDefs,
          coverageByCode,
          TOTAL_PCON_COUNT,
          "constituencies",
        );
        updateNetworkSummaryCardVisibility();
        if (!basePconRows.length && !baseLatestRows.length && !baseLatestRowsAllWindow.length) {
          scopedLatestRows = [];
          scopedLatestRowsAllWindow = [];
          latestRows = [];
          pconRows = [];
          pconLookup = new Map();
          updateRowCountText();
          updateSummary();
          renderMap();
          updateDetailsPanel();
          window.hexChartMode?.syncFromMap?.("uk", { preserveChartMode: true, updateChart: false });
          return;
        }
        const networkCodes = getActiveNetworkCodes();
        let filteredLatest = [];
        if (networkCodes === null) {
          filteredLatest = baseLatestRows;
        } else if (networkCodes.size > 0) {
          filteredLatest = filterLatestRowsByNetwork(baseLatestRows, networkCodes);
        }
        let filteredLatestAllWindow = [];
        if (networkCodes === null) {
          filteredLatestAllWindow = baseLatestRowsAllWindow;
        } else if (networkCodes.size > 0) {
          filteredLatestAllWindow = filterLatestRowsByNetwork(baseLatestRowsAllWindow, networkCodes);
        }
        scopedLatestRows = filteredLatest;
        scopedLatestRowsAllWindow = filteredLatestAllWindow;
        latestRows = filterRowsByWindow(filteredLatest);
        const derived = latestRows.length ? buildPconRowsFromLatest(latestRows) : [];
        pconRows = derived;
        pconLookup = new Map(pconRows.map((row) => [row.pcon_code, row]));
        updateRowCountText();
        updateSummary();
        renderMap();
        updateDetailsPanel();
        window.hexChartMode?.syncFromMap?.("uk", { preserveChartMode: true, updateChart: false });
        refreshPinnedTooltip();
      }

      function buildTooltipHtml(cell) {
        const row = pconLookup.get(cell.pcon_code);
        const metricValue = getMetricValue(row);
        const areaName = cell.pcon_name || row?.pcon_name || cell.pcon_code || "Unknown constituency";
        const regionLabel = cell.region_name || cell.region_code || "Unknown region";
        const pollutantLabel = getPollutantLabel(activePollutant);
        const pollutantUnits = getPollutantUnits(activePollutant);
        const populationEntry = populationLookup.get(cell.pcon_code);
        const populationValue = normalizeNumber(populationEntry?.population_value);
        const populationDate = parseDate(populationEntry?.reference_date);
        const populationYear = populationDate ? populationDate.getFullYear() : null;
        const populationLabel = populationValue === null
          ? "Population: n/a"
          : `Population${populationYear ? ` (${populationYear})` : ""}: ${formatNumber(populationValue)}`;
        const valueLabel = Number.isFinite(metricValue)
          ? `${formatValue(metricValue)} ${pollutantUnits}`
          : `No ${pollutantLabel} data`;
        const rowsForTooltip = getRowsForActivePollutant(latestRows)
          .filter((item) => resolvePconCode(item) === cell.pcon_code);
        const stationEntries = collectStationEntries(rowsForTooltip, cell.pcon_code);
        const networkCounts = countStationsByNetwork(stationEntries);
        const networkLines = stationEntries.length
          ? networkCounts.map((entry) =>
            `<div class="tooltip-line"><span class="tooltip-network-name">${entry.label}</span>: ${formatSensorCount(entry.count)}</div>`
          )
          : [`<div class="tooltip-line">${formatSensorCount(0)}</div>`];
        if (stationEntries.length && networkCounts.length >= 2) {
          networkLines.push(
            `<div class="tooltip-line">Total: ${formatSensorCount(stationEntries.length)}</div>`
          );
        }
        return `
          <div class="tooltip-title">${areaName}</div>
          <div class="tooltip-line">Region: ${regionLabel}</div>
          <div class="tooltip-line">${populationLabel}</div>
          <div class="tooltip-line">${currentMetric === "median" ? "Typical" : "Average"}: ${valueLabel}</div>
          ${networkLines.join("")}
        `;
      }

      function showTooltipForCell(cell, event) {
        if (!tooltip || !cell) {
          return;
        }
        tooltip.innerHTML = buildTooltipHtml(cell);
        tooltip.classList.add("visible");
        if (event) {
          positionTooltip(event);
        }
      }

      function setPinnedTooltip(cell, event) {
        pinnedTooltipCell = cell || null;
        if (pinnedTooltipCell) {
          showTooltipForCell(pinnedTooltipCell, event);
        }
      }

      function refreshPinnedTooltip() {
        if (!pinnedTooltipCell) {
          return;
        }
        showTooltipForCell(pinnedTooltipCell);
      }

      function positionTooltip(event) {
        const left = event.clientX + window.scrollX + 12;
        const pointerY = event.clientY + window.scrollY;
        const viewportTop = window.scrollY;
        const viewportBottom = window.scrollY + window.innerHeight;
        const tooltipHeight = tooltip.offsetHeight || 0;
        let top = pointerY - 12;
        if (top + tooltipHeight > viewportBottom) {
          top = pointerY - tooltipHeight - 12;
        }
        if (top < viewportTop + 8) {
          top = viewportTop + 8;
        }
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      }

      function renderMapIfReady() {
        const width = svg.node().clientWidth;
        const height = svg.node().clientHeight;
        if (!width || !height) {
          return;
        }
        if (hasRendered && Math.abs(width - lastRenderWidth) < 1 && Math.abs(height - lastRenderHeight) < 1) {
          return;
        }
        renderMap();
      }

      function renderMap() {
        if (!hexData || !hexCells.length || !hexBounds || !hexSide) {
          return;
        }
        const width = svg.node().clientWidth;
        const height = svg.node().clientHeight;
        if (!width || !height) {
          return;
        }
        hasRendered = true;
        lastRenderWidth = width;
        lastRenderHeight = height;
        clearMap();
        const projection = createProjection(hexBounds, width, height, 24);
        const values = pconRows
          .map((row) => getMetricValue(row))
          .filter((value) => Number.isFinite(value));
        const maxValue = values.length ? d3.max(values) : null;
        const domainMin = 0;
        const domainMax = getLegendCapValue();
        const palette = HEAT_STOPS.map((name, index) =>
          resolveCssColor(name, HEAT_STOP_FALLBACKS[index])
        );
        colorScale = null;
        currentDomainMax = domainMax;
        if (maxValue !== null) {
          const interpolate = d3.interpolateRgbBasis(palette);
          colorScale = (value) => interpolate(mapValueToT(value, currentDomainMax));
        }
        updateLegend(maxValue === null ? null : domainMin, maxValue, domainMax);
        updateLegendScaleDescription();
        updateLegendTicks(domainMax);

        const isCurrentlyLoading = mapWrap.classList.contains("is-loading");
        const noDataColor = getComputedStyle(document.documentElement).getPropertyValue("--no-data").trim() || "#efe6d8";

        const hexGroup = svg.append("g");
        hexGroup.selectAll("polygon")
          .data(hexCells)
          .join("polygon")
          .attr("class", (cell) => {
            const row = pconLookup.get(cell.pcon_code);
            const value = getMetricValue(row);
            return (colorScale && Number.isFinite(value)) ? "hex has-data" : "hex";
          })
          .attr("points", (cell) => hexPoints(cell.cx, cell.cy, hexSide)
            .map((point) => projection(point))
            .map((point) => `${point[0]},${point[1]}`)
            .join(" "))
          .attr("fill", (cell) => {
            const row = pconLookup.get(cell.pcon_code);
            const value = getMetricValue(row);
            if (!colorScale || !Number.isFinite(value)) return "var(--no-data)";
            return isCurrentlyLoading ? noDataColor : colorScale(value);
          })
          .attr("data-fill", (cell) => {
            const row = pconLookup.get(cell.pcon_code);
            const value = getMetricValue(row);
            if (!colorScale || !Number.isFinite(value)) return null;
            return colorScale(value);
          })
          .on("click", (event, cell) => {
            event.stopPropagation();
            setSelectedCell(cell);
          })
          .on("mouseenter", (event, cell) => {
            if (pinnedTooltipCell) {
              return;
            }
            showTooltipForCell(cell, event);
          })
          .on("mousemove", (event) => {
            if (pinnedTooltipCell) {
              return;
            }
            positionTooltip(event);
          })
          .on("mouseleave", () => {
            if (pinnedTooltipCell) {
              return;
            }
            tooltip.classList.remove("visible");
          });

        const boundaryGroup = svg.append("g").attr("class", "region-boundaries");
        boundaryGroup.selectAll("path")
          .data(boundaryPaths)
          .join("path")
          .attr("class", (boundary) => `boundary-path boundary-${boundary.type || "region"}`)
          .attr("d", (boundary) => boundary.paths.map((path) => {
            const [first, ...rest] = path;
            const [startX, startY] = projection(first);
            const lines = rest.map((point) => {
              const [x, y] = projection(point);
              return `L${x},${y}`;
            }).join("");
            return `M${startX},${startY}${lines}`;
          }).join(""));
        updateSelectedHexStyles();
        updateSelectedHexViewportShift();
      }

      async function loadMapData(options = {}) {
        const force = Boolean(options?.force);
        if (!force && !isUkMapVisible()) {
          return;
        }
        const requestPollutant = activePollutant;
        chartDataStatus = "loading";
        const requestWindow = currentWindow;
        const requestId = ++latestLoadId;
        const timingId = nextHexMapTimingId();
        const isStale = () =>
          requestId !== latestLoadId
          || requestPollutant !== activePollutant
          || requestWindow !== currentWindow;
        markHexMapTiming(timingId, "load:start");
        setStatus("Loading...");
        setMapLoading(true);
        if (errorEl) {
          errorEl.textContent = "";
          errorEl.hidden = true;
        }
        latestPollutant = null;
        populationLookup = new Map();
        if (!REST_URL) {
          chartDataStatus = "failed";
          if (errorEl) {
            errorEl.textContent = "Missing cache endpoint base URL. Provide ?cache_base=... if needed.";
            errorEl.hidden = false;
          }
          setStatus("Error");
          setMapLoading(false);
          window.hexChartMode?.syncFromMap?.("uk", { preserveChartMode: true, dataStatus: "failed" });
          return;
        }
        if (!cacheSessionUrl) {
          chartDataStatus = "failed";
          if (errorEl) {
            errorEl.textContent = "Missing cache session URL. Provide ?cache_session_url=... if needed.";
            errorEl.hidden = false;
          }
          setStatus("Error");
          setMapLoading(false);
          window.hexChartMode?.syncFromMap?.("uk", { preserveChartMode: true, dataStatus: "failed" });
          return;
        }
        try {
          await fetchNetworkCatalog();
          if (isStale()) {
            return;
          }
          const pconUrl = new URL(REST_URL);
          if (activePconVersion) {
            pconUrl.searchParams.set("pcon_version", activePconVersion);
          }
          const pconCacheKey = pconUrl.toString();
          const pconSince = normalizeIsoTimestamp(pconSinceByKey.get(pconCacheKey));
          if (pconSince) {
            pconUrl.searchParams.set("since", pconSince);
          }
          const pconEtag = pconEtagByKey.get(pconCacheKey) || null;
          const pconHeaders = {};
          if (pconEtag) {
            pconHeaders["If-None-Match"] = pconEtag;
          }
          const latestUrl = new URL(resolveLatestUrl(currentWindow));
          const latestCacheKey = getLatestCacheKey(requestPollutant, requestWindow);
          const latestCursorEnabled = !latestUrl.pathname.endsWith("/latest-snapshot");
          const latestSince = latestCursorEnabled
            ? (latestSinceByKey.get(latestCacheKey) || null)
            : null;
          const latestSinceId = latestCursorEnabled
            ? normalizeCursorId(latestSinceIdByKey.get(latestCacheKey))
            : null;
          const latestEtag = latestEtagByKey.get(latestCacheKey) || null;
          latestUrl.searchParams.set("pollutant", activePollutant);
          latestUrl.searchParams.set("window", currentWindow);
          latestUrl.searchParams.set("scope", "all");
          latestUrl.searchParams.set("limit", "10000");
          latestUrl.searchParams.set("caller", "hex_map");
          if (latestCursorEnabled && latestSince) {
            latestUrl.searchParams.set("since", latestSince);
            if (latestSinceId !== null) {
              latestUrl.searchParams.set("since_id", String(latestSinceId));
            }
          }
          const latestHeaders = {};
          if (latestEtag) {
            latestHeaders["If-None-Match"] = latestEtag;
          }
          // const populationUrl = POPULATION_URL ? new URL(POPULATION_URL) : null;
          // if (populationUrl) {
          //   populationUrl.searchParams.set("geo_type", "PCON");
          //   if (mapDateKey) {
          //     populationUrl.searchParams.set("reference_date", mapDateKey);
          //   }
          //   populationUrl.searchParams.set("limit", "2000");
          // }
          const hexRequest = fetch(HEX_DATA_URL);
          const pconRequest = fetchCacheApi(pconUrl.toString(), {
            headers: pconHeaders,
          });
          const latestRequest = fetchCacheApi(latestUrl.toString(), {
            headers: latestHeaders,
          }).catch(() => null);
          const latestAllCacheKey = getLatestCacheKey(requestPollutant, "all");
          let latestAllRequest = Promise.resolve(null);
          if (requestWindow !== "all") {
            const latestAllUrl = new URL(resolveLatestUrl("all"));
            latestAllUrl.searchParams.set("pollutant", activePollutant);
            latestAllUrl.searchParams.set("window", "all");
            latestAllUrl.searchParams.set("scope", "all");
            latestAllUrl.searchParams.set("limit", "10000");
            latestAllUrl.searchParams.set("caller", "hex_map");
            const latestAllEtag = latestEtagByKey.get(latestAllCacheKey) || null;
            const latestAllHeaders = {};
            if (latestAllEtag) {
              latestAllHeaders["If-None-Match"] = latestAllEtag;
            }
            latestAllRequest = fetchCacheApi(latestAllUrl.toString(), {
              headers: latestAllHeaders,
            }).catch(() => null);
          }
          // const populationRequest = populationUrl
          //   ? fetch(populationUrl.toString(), {
          //     headers: {
          //       Authorization: `Bearer ${anonKey}`,
          //       apikey: anonKey,
          //     },
          //   }).catch(() => null)
          //   : Promise.resolve(null);
          const populationRequest = Promise.resolve(null);
          const hexResponse = await hexRequest;
          if (isStale()) {
            return;
          }
          if (!hexResponse.ok) {
            throw new Error(`Hex data request failed: ${hexResponse.status}`);
          }
          hexData = await hexResponse.json();
          areaRegionLookup = hexData?.type === "FeatureCollection"
            ? buildAreaRegionLookupFromGeojson(hexData)
            : new Map();
          prepareHexGrid();
          renderMapIfReady();
          markHexMapTiming(timingId, "geometry-ready");
          measureHexMapTiming(timingId, "load-to-geometry-ready", "load:start", "geometry-ready");
          requestAnimationFrame(() => {
            if (!isStale()) {
              renderMapIfReady();
            }
          });
          const [pconResponse, latestResponse, latestAllResponse, populationResponse] = await Promise.all([
            pconRequest,
            latestRequest,
            latestAllRequest,
            populationRequest,
          ]);
          if (isStale()) {
            return;
          }
          if (!pconResponse.ok && pconResponse.status !== 304) {
            throw new Error(`Constituency request failed: ${pconResponse.status}`);
          }
          const pconResponseEtag = pconResponse.headers.get("ETag");
          if (pconResponseEtag) {
            pconEtagByKey.set(pconCacheKey, pconResponseEtag);
          }
          if (pconResponse.status === 304) {
            pconRows = basePconRows;
            pconLookup = new Map(pconRows.map((row) => [row.pcon_code, row]));
          } else {
            const payload = await pconResponse.json();
            const incomingRows = payload?.data || [];
            const mergedRows = pconSince
              ? mergePconRows(basePconRows, incomingRows)
              : incomingRows;
            basePconRows = mergedRows;
            basePconLookup = new Map(basePconRows.map((row) => [row.pcon_code, row]));
            pconRows = basePconRows;
            pconLookup = new Map(pconRows.map((row) => [row.pcon_code, row]));
            const nextSince = normalizeIsoTimestamp(payload?.next_since) || pconSince;
            if (nextSince) {
              pconSinceByKey.set(pconCacheKey, nextSince);
            } else {
              pconSinceByKey.delete(pconCacheKey);
            }
            if (lastUpdated) {
              if (payload?.last_updated) {
                lastUpdated.textContent = `Latest data ${formatTimestamp(payload.last_updated)}`;
              } else {
                lastUpdated.textContent = "Latest data unavailable";
              }
            }
          }
          pconCodes = new Set(hexCells.map((cell) => cell.pcon_code).filter(Boolean));
          if (latestResponse) {
            const responseEtag = latestResponse.headers.get("ETag");
            if (responseEtag) {
              latestEtagByKey.set(latestCacheKey, responseEtag);
            }
          }
          if (latestAllResponse) {
            const responseEtag = latestAllResponse.headers.get("ETag");
            if (responseEtag) {
              latestEtagByKey.set(latestAllCacheKey, responseEtag);
            }
          }
            if (latestResponse && latestResponse.status === 304) {
              const cachedLatest = pollutantCache.get(latestCacheKey);
              if (cachedLatest) {
                baseLatestRows = cachedLatest.latestRows || [];
                latestPollutant = cachedLatest.latestPollutant || requestPollutant;
                const cachedSince = normalizeIsoTimestamp(cachedLatest.nextSince) || latestSince;
                const cachedSinceId = normalizeCursorId(cachedLatest.nextSinceId)
                  ?? latestSinceId
                  ?? 0;
                if (cachedSince) {
                  latestSinceByKey.set(latestCacheKey, cachedSince);
                  latestSinceIdByKey.set(latestCacheKey, cachedSinceId);
                }
              } else {
                baseLatestRows = [];
                latestPollutant = requestPollutant;
              }
            } else if (latestResponse && latestResponse.ok) {
              const latestPayload = await latestResponse.json();
              const latestRaw = latestPayload?.data || [];
              const cleanedLatest = latestRaw.filter((row) => Number.isFinite(resolveLatestValue(row)));
              const responsePollutant = normalizePollutantKey(latestPayload?.pollutant) || requestPollutant;
              const nextSince = latestCursorEnabled
                ? (normalizeIsoTimestamp(latestPayload?.next_since) || latestSince)
                : null;
              const nextSinceId = latestCursorEnabled
                ? (normalizeCursorId(latestPayload?.next_since_id)
                  ?? latestSinceId
                  ?? 0)
                : 0;
              const existingLatest = (latestCursorEnabled && latestSince)
                ? (pollutantCache.get(latestCacheKey)?.latestRows || baseLatestRows)
                : [];
              const mergedLatest = (latestCursorEnabled && latestSince)
                ? mergeLatestRows(existingLatest, cleanedLatest)
                : cleanedLatest;
            if (!isStale()) {
              baseLatestRows = mergedLatest;
              latestPollutant = responsePollutant;
              if (requestWindow === "all") {
                networkController.updatePollutantCapability(requestPollutant, cleanedLatest);
              }
              pollutantCache.set(latestCacheKey, {
                timestamp: Date.now(),
                latestRows: mergedLatest,
                latestPollutant,
                nextSince,
                nextSinceId,
              });
              if (latestCursorEnabled && nextSince) {
                latestSinceByKey.set(latestCacheKey, nextSince);
                latestSinceIdByKey.set(latestCacheKey, nextSinceId);
              } else {
                latestSinceByKey.delete(latestCacheKey);
                latestSinceIdByKey.delete(latestCacheKey);
              }
            }
          } else if (!isStale()) {
            baseLatestRows = [];
            latestPollutant = null;
          }
          if (latestAllResponse && latestAllResponse.status === 304) {
            const cachedLatestAll = pollutantCache.get(latestAllCacheKey);
            if (cachedLatestAll) {
              baseLatestRowsAllWindow = cachedLatestAll.latestRows || [];
            } else {
              baseLatestRowsAllWindow = baseLatestRows;
            }
          } else if (latestAllResponse && latestAllResponse.ok) {
            const latestAllPayload = await latestAllResponse.json();
            const latestAllRaw = latestAllPayload?.data || [];
            const cleanedLatestAll = latestAllRaw.filter((row) => Number.isFinite(resolveLatestValue(row)));
            networkController.updatePollutantCapability(requestPollutant, cleanedLatestAll);
            baseLatestRowsAllWindow = cleanedLatestAll;
            pollutantCache.set(latestAllCacheKey, {
              timestamp: Date.now(),
              latestRows: cleanedLatestAll,
              latestPollutant: normalizePollutantKey(latestAllPayload?.pollutant) || requestPollutant,
              nextSince: null,
              nextSinceId: 0,
            });
            latestSinceByKey.delete(latestAllCacheKey);
            latestSinceIdByKey.delete(latestAllCacheKey);
          } else {
            baseLatestRowsAllWindow = baseLatestRows;
          }
          if (isStale()) {
            return;
          }
          const networkRowsForWindow = getNetworkRowsForWindow();
          const windowNetworkDefs = buildNetworkDefs(networkRowsForWindow);
          const coverageByCode = buildNetworkCoverageByCode(networkRowsForWindow);
          renderNetworkFiltersIfNeeded(
            windowNetworkDefs,
            coverageByCode,
            TOTAL_PCON_COUNT,
            "constituencies",
          );
          if (populationResponse && populationResponse.ok) {
            const populationPayload = await populationResponse.json();
            const populationRows = Array.isArray(populationPayload)
              ? populationPayload
              : populationPayload?.data || [];
            const lookup = new Map();
            populationRows.forEach((row) => {
              const code = row?.geo_code;
              if (!code || lookup.has(code)) {
                return;
              }
              lookup.set(code, row);
            });
            populationLookup = lookup;
          } else {
            populationLookup = new Map();
          }
          chartDataStatus = latestPollutant === requestPollutant ? "ready" : "failed";
          applyNetworkFilters();
          markHexMapTiming(timingId, "colored-ready");
          measureHexMapTiming(timingId, "load-to-colored-ready", "load:start", "colored-ready");
          setStatus("Live");
          markHexMapTiming(timingId, "load-complete");
          measureHexMapTiming(timingId, "load-total", "load:start", "load-complete");
        } catch (error) {
          if (isStale()) {
            return;
          }
          chartDataStatus = "failed";
          window.hexChartMode?.syncFromMap?.("uk", { preserveChartMode: true, dataStatus: "failed" });
          if (maybeRedirectToAccessLogin(error)) {
            if (errorEl) {
              errorEl.textContent = "Cloudflare Access login required. Redirecting...";
              errorEl.hidden = false;
            }
            setStatus("Error");
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          console.error("uk_aq UK map load error", error);
          if (errorEl) {
            errorEl.textContent = message;
            errorEl.hidden = false;
          }
          setStatus("Error");
        } finally {
          if (!isStale()) {
            setMapLoading(false);
          }
        }
      }

      metricInputs.forEach((input) => {
        input.addEventListener("change", () => {
          if (!input.checked) {
            return;
          }
          const metric = input.value;
          if (!metric) {
            return;
          }
          setMetric(metric);
        });
      });

      colorScaleInputs.forEach((input) => {
        input.addEventListener("change", () => {
          if (input.checked) {
            setColorScale(input.value);
          }
        });
      });

      windowInputs.forEach((input) => {
        input.addEventListener("change", () => {
          if (!input.checked) {
            return;
          }
          setWindow(input.value);
        });
      });

      if (colorScaleToggle) {
        colorScaleToggle.addEventListener("click", (event) => {
          event.preventDefault();
          const nextScale = currentColorScale === "power" ? "linear" : "power";
          setColorScale(nextScale);
          const nextInput = colorScaleInputs.find((input) => input.value === nextScale);
          if (nextInput) {
            nextInput.focus();
          }
        });
      }

      if (metricToggle) {
        metricToggle.addEventListener("click", (event) => {
          event.preventDefault();
          const nextMetric = currentMetric === "mean" ? "median" : "mean";
          setMetric(nextMetric);
          const nextInput = metricInputs.find((input) => input.value === nextMetric);
          if (nextInput) {
            nextInput.focus();
          }
        });
      }

      if (colorScaleGroup) {
        colorScaleGroup.addEventListener("keydown", (event) => {
          if (event.key !== " " && event.key !== "Spacebar") {
            return;
          }
          const activeElement = document.activeElement;
          if (!activeElement || !colorScaleInputs.includes(activeElement)) {
            return;
          }
          event.preventDefault();
          const nextScale = currentColorScale === "power" ? "linear" : "power";
          setColorScale(nextScale);
          const nextInput = colorScaleInputs.find((input) => input.value === nextScale);
          if (nextInput) {
            nextInput.focus();
          }
        });
      }

      if (metricGroup) {
        metricGroup.addEventListener("keydown", (event) => {
          if (event.key !== " " && event.key !== "Spacebar") {
            return;
          }
          const activeElement = document.activeElement;
          if (!activeElement || !metricInputs.includes(activeElement)) {
            return;
          }
          event.preventDefault();
          const nextMetric = currentMetric === "mean" ? "median" : "mean";
          setMetric(nextMetric);
          const nextInput = metricInputs.find((input) => input.value === nextMetric);
          if (nextInput) {
            nextInput.focus();
          }
        });
      }

      if (mapSettingsButton) {
        mapSettingsButton.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleSettingsPanel();
        });
      }

      if (mapSettingsClose) {
        mapSettingsClose.addEventListener("click", (event) => {
          event.stopPropagation();
          closeSettingsPanel();
        });
      }

      document.addEventListener("click", (event) => {
        if (!mapSettingsPanel || !mapSettingsPanel.classList.contains("open")) {
          return;
        }
        const target = event.target;
        if (mapSettingsPanel.contains(target) || (mapSettingsButton && mapSettingsButton.contains(target))) {
          return;
        }
        closeSettingsPanel();
      });

      window.addEventListener("hexchartselectionchange", (event) => {
        const detail = event.detail || {};
        if (detail.mapKey && detail.mapKey !== "uk") {
          return;
        }
        syncInlinePanelTitleInteractivity();
        if (detail.isChartMode) {
          return;
        }
        updateDetailsPanel();
      });

      document.addEventListener("click", (event) => {
        if (!selectedPconCode) {
          return;
        }
        const target = event.target;
        const targetElement = target instanceof Element ? target : target?.parentElement;
        if (!targetElement || !mapCanvasWrap || !mapCanvasWrap.contains(targetElement)) {
          return;
        }
        if (targetElement && typeof targetElement.closest === "function" && targetElement.closest("polygon.hex")) {
          return;
        }
        if (targetElement && typeof targetElement.closest === "function" && targetElement.closest(".map-inline-sensor-panel, .map-settings-panel, .map-settings, .map-zoom-controls, .map-topbar, .mobile-map-controls, .networks-pill-anchor, .networks-pill, .hex-chart-mode-panel")) {
          return;
        }
        setSelectedCell(null);
      });

      pollutantButtons.forEach((button) => {
        button.addEventListener("click", () => {
          setActivePollutant(button.dataset.pollutant);
        });
      });
      if (pollutantSelector) {
        pollutantSelector.addEventListener("keydown", handlePollutantKeydown);
      }

      sortHeaderButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const nextKey = button.dataset.sortKey;
          if (!nextKey) {
            return;
          }
          if (sortKey === nextKey) {
            sortDir = sortDir === "asc" ? "desc" : "asc";
          } else {
            sortKey = nextKey;
            sortDir = getDefaultSortDir(nextKey);
          }
          syncSortHeaders();
          updateDetailsPanel();
        });
      });
      syncSortHeaders();

      const sensorShareBars = SensorShareBars(sensorShareList, []);
      const networkSummaryCardsComponent = NetworkSummaryCards({
        coverageEl: networkSummaryCoverage,
        sensorsEl: networkSummarySensors,
        freshnessEl: networkSummaryFreshness,
      }, {
        pconCovered: 0,
        pconTotal: pconCodes.size || TOTAL_PCON_COUNT,
        totalSensors: 0,
        avgSensorsPerPcon: null,
        newestReadingISO: null,
        oldestReadingISO: null,
        shareData: [],
      });

      document.getElementById("refresh").addEventListener("click", () => {
        if (window.hexChartMode?.isActive?.("uk")) {
          window.hexChartMode.refresh?.();
          return;
        }
        loadMapData();
      });
      document.addEventListener("visibilitychange", syncUkPollingOnVisibility);
      if (ukRoot && typeof MutationObserver !== "undefined") {
        const ukVisibilityObserver = new MutationObserver(syncUkPollingOnVisibility);
        ukVisibilityObserver.observe(ukRoot, { attributes: true, attributeFilter: ["hidden"] });
      }
      window.addEventListener("resize", () => {
        if (statusEl.textContent === "Live") {
          renderMap();
        }
        syncSettingsPanelWidth();
        if (mapSettingsPanel?.classList.contains("open")) {
          positionSettingsPanel();
        }
      });
      applyMetricState();
      syncPollutantButtons();
      updatePollutantLabels();
      currentWindow = normalizeWindowKey(coordinator.getMapSettings().window || currentWindow);
      syncWindowInputs();
      syncSettingsPanelWidth();
      syncColorScaleInputs();
      updateLegendScaleDescription();
      syncUkPollingOnVisibility();

      function buildConstituencySearchRecords() {
        const records = [];
        const seenCodes = new Set();
        hexCells.forEach((cell) => {
          const rawCode = typeof cell?.pcon_code === "string" ? cell.pcon_code.trim() : "";
          if (!rawCode) {
            return;
          }
          const code = rawCode.toUpperCase();
          if (seenCodes.has(code)) {
            return;
          }
          seenCodes.add(code);
          const row = pconLookup.get(rawCode) || pconLookup.get(code) || null;
          const name = cell?.pcon_name || row?.pcon_name || rawCode;
          const region = cell?.region_name || row?.region_name || "";
          records.push({
            code,
            name,
            region,
          });
        });
        return records;
      }

      function buildSensorSearchRecords() {
        const rowsForSearch = scopedLatestRowsAllWindow.length
          ? scopedLatestRowsAllWindow
          : (scopedLatestRows.length ? scopedLatestRows : baseLatestRowsAllWindow.length ? baseLatestRowsAllWindow : baseLatestRows);
        const recordsByKey = new Map();
        rowsForSearch.forEach((row, index) => {
          const stationId = String(resolveStationKey(row) || `uk:${index}`);
          const stationName = resolveStationName(row);
          const networkName = resolvePrimaryNetworkLabel(row) || null;
          const pconRaw = resolvePconCode(row);
          const laRaw = resolveLaCode(row);
          const pconCode = typeof pconRaw === "string" ? pconRaw.trim().toUpperCase() : null;
          const laCode = typeof laRaw === "string" ? laRaw.trim().toUpperCase() : null;
          const { lat, lon } = resolveCoordinatePair(row);
          const key = `${stationId}::${networkName || ""}`;
          const existing = recordsByKey.get(key);
          if (existing) {
            if (!existing.pcon_code && pconCode) {
              existing.pcon_code = pconCode;
            }
            if (!existing.la_code && laCode) {
              existing.la_code = laCode;
            }
            if (!Number.isFinite(existing.lat) && Number.isFinite(lat)) {
              existing.lat = lat;
            }
            if (!Number.isFinite(existing.lon) && Number.isFinite(lon)) {
              existing.lon = lon;
            }
            return;
          }
          recordsByKey.set(key, {
            station_id: stationId,
            station_name: stationName,
            network_label: networkName,
            pcon_code: pconCode,
            la_code: laCode,
            lat,
            lon,
          });
        });
        return Array.from(recordsByKey.values());
      }

      function ensureUkSearchDataLoaded() {
        if (hexCells.length) {
          return Promise.resolve(true);
        }
        if (ukSearchPreloadPromise) {
          return ukSearchPreloadPromise;
        }
        ukSearchPreloadPromise = loadMapData({ force: true })
          .then(() => Boolean(hexCells.length))
          .catch((error) => {
            console.warn("uk_aq UK search preload failed", error);
            return false;
          })
          .finally(() => {
            ukSearchPreloadPromise = null;
        });
        return ukSearchPreloadPromise;
      }

      function normalizeTimeseriesId(value) {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const text = String(value).trim();
        return /^\d+$/.test(text) ? text : null;
      }

      function resolveTimeseriesId(row) {
        return normalizeTimeseriesId(row?.timeseries_id)
          ?? normalizeTimeseriesId(row?.time_series_id)
          ?? normalizeTimeseriesId(row?.timeseriesId)
          ?? normalizeTimeseriesId(row?.timeSeriesId)
          ?? normalizeTimeseriesId(row?.timeseries?.id)
          ?? normalizeTimeseriesId(row?.timeseries?.timeseries_id)
          ?? normalizeTimeseriesId(row?.offering?.timeseries_id)
          ?? normalizeTimeseriesId(row?.id)
          ?? normalizeTimeseriesId(row?.timeseries_ref);
      }

      function buildChartModeEntriesForSelectedArea() {
        if (!selectedPconCode) {
          return [];
        }
        const detailSourceRows = scopedLatestRowsAllWindow.length ? scopedLatestRowsAllWindow : scopedLatestRows;
        const scopedRows = getRowsForActivePollutant(detailSourceRows);
        const cutoff = getWindowCutoff();
        const entries = collectStationEntries(scopedRows, selectedPconCode).map((entry) => ({
          ...entry,
          inWindow: isTimestampInWindow(entry.timestamp, cutoff),
        }));
        sortDetailEntries(entries);
        return entries.map((entry) => {
          const stationName = resolveStationName(entry.row);
          const stationId = String(resolveStationKey(entry.row) || stationName || "");
          return {
            stationId,
            stationName,
            networkLabel: resolvePrimaryNetworkLabel(entry.row) || "Unknown network",
            timeseriesId: resolveTimeseriesId(entry.row),
            value: entry.value,
            updatedText: formatSummaryTimestamp(entry.timestamp),
            timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : null,
            pollutant: activePollutant,
            pollutantLabel: getPollutantLabel(activePollutant),
            units: getPollutantUnits(activePollutant),
            row: entry.row,
          };
        });
      }

      const ukController = Object.freeze({
        render: () => {
          if (statusEl.textContent === "Live") {
            requestAnimationFrame(() => {
              renderMap();
            });
          }
          syncSettingsPanelWidth();
        },
        renderLayout: () => {
          requestAnimationFrame(() => {
            renderMap();
          });
          syncSettingsPanelWidth();
        },
        restoreNetworks: () => {
          applyNetworkFilters();
        },
        markBootstrapReady: () => {
          ukBootstrapReady = true;
          syncUkPollingOnVisibility();
        },
        reapplyNetworkFilters: () => {
          applyNetworkFilters();
        },
        clearPinnedTooltip: () => {
          pinnedTooltipCell = null;
        },
        selectPconByCode: (code) => selectPconByCode(code),
        getActivePconCode: () => selectedPconCode,
        getChartModeContext: () => {
          const row = selectedPconCode ? pconLookup.get(selectedPconCode) : null;
          const areaName = selectedCell?.pcon_name || row?.pcon_name || selectedPconCode || "";
          const metricValue = getMetricValue(row);
          return {
            mapKey: "uk",
            areaCode: selectedPconCode,
            areaName,
            entries: buildChartModeEntriesForSelectedArea(),
            sortKey,
            sortDir,
            metricValue,
            metricColor: colorScale && Number.isFinite(metricValue) ? colorScale(metricValue) : "var(--no-data)",
            methodLabel: currentMetric === "median" ? "Typical (median)" : "Average (mean)",
            pollutant: activePollutant,
            loadedPollutant: latestPollutant,
            dataStatus: chartDataStatus,
            pollutantLabel: getPollutantLabel(activePollutant),
            units: getPollutantUnits(activePollutant),
          };
        },
        refreshForChartMode: () => loadMapData({ preserveChartMode: true }),
        ensureSearchDataLoaded: () => ensureUkSearchDataLoaded(),
        getConstituencySearchRecords: () => buildConstituencySearchRecords(),
        getSensorSearchRecords: () => buildSensorSearchRecords(),
        getPollutantLabel: () => getPollutantLabel(activePollutant),
        getColorForPconCode: (pconCode) => {
          if (!colorScale) return null;
          const row = pconLookup.get(pconCode);
          const value = getMetricValue(row);
          if (!Number.isFinite(value)) return null;
          return colorScale(value);
        },
        getPconMetricValue: (pconCode) => getMetricValue(basePconLookup.get(pconCode)),
        applyColorScale: (value) => colorScale ? colorScale(value) : null,
        getSensorCurrentColor: (stationId) => {
          if (!colorScale) return null;
          const allRows = scopedLatestRows.length ? scopedLatestRows : baseLatestRows;
          const pollutantRows = getRowsForActivePollutant(allRows);
          const targetStationId = String(stationId || "");
          const candidates = pollutantRows.filter((r) => String(resolveStationKey(r) || "") === targetStationId);
          if (!candidates.length) return null;
          candidates.sort((a, b) => {
            const ta = resolveLatestTimestamp(a);
            const tb = resolveLatestTimestamp(b);
            return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
          });
          const value = resolveLatestValue(candidates[0]);
          if (!Number.isFinite(value)) return null;
          return colorScale(value);
        },
      });
      root.ukMap = Object.freeze(Object.fromEntries(
        Object.keys(ukController)
          .filter((methodName) => methodName !== "clearPinnedTooltip")
          .map((methodName) => [
            methodName,
            (...args) => ukController[methodName](...args),
          ]),
      ));
      coordinator.registerMap("uk", {
        setPollutant: (pollutant) => setActivePollutant(pollutant, { coordinated: true }),
        setMapSettings: (settings) => {
          setMetric(settings.metric, { coordinated: true });
          setColorScale(settings.colorScale, { coordinated: true });
          setWindow(settings.window, { coordinated: true });
        },
        activate: () => {
          ukController.render();
          ukController.restoreNetworks();
          search?.preloadInactiveMap?.("uk");
          ukController.markBootstrapReady();
        },
      });
      networkController.registerScope("uk", () => applyNetworkFilters());
      return ukController;
}

const ukController = initHexMapUkController(globalThis);
export default ukController;
