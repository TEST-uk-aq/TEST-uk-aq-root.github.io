// Shared authentication for protected /api/aq requests.
// Users may land directly on any page, so callers must not depend on another
// page (such as Hex Map) having already created the cache session.
(() => {
  "use strict";

  if (window.ukAqSharedAuth?.fetchCacheApi) {
    window.ukAqFetchCacheApi = window.ukAqSharedAuth.fetchCacheApi;
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  const params = new URLSearchParams(window.location.search);
  const explicitBase = String(params.get("cache_base") || "").trim();
  const cacheBaseUrl = explicitBase
    ? explicitBase.replace(/\/+$/, "")
    : `${window.location.origin.replace(/\/$/, "")}/api/aq`;
  const cacheOrigin = new URL(cacheBaseUrl, window.location.href).origin;
  const cacheSessionUrl = String(params.get("cache_session_url") || "").trim()
    || `${cacheOrigin}/api/aq/session/start`;
  const hintKey = `uk_aq_cache_session_hint_v1:${cacheOrigin || "default"}:shared`;
  const skewMs = 10000;
  let sessionUntil = 0;
  let sessionInflight = null;
  let scriptInflight = null;
  let tokenInflight = null;
  let widgetId = null;
  let resolveToken = null;
  let rejectToken = null;

  function debug(event, details = {}) {
    if (params.get("turnstile_debug") === "1") {
      console.debug(`[UK AQ Turnstile] ${event}`, details);
    }
  }

  function configuredSiteKey() {
    const queryKey = String(params.get("turnstile_site_key") || "").trim();
    if (queryKey) return queryKey;
    try {
      if (typeof TURNSTILE_SITE_KEY_PLACEHOLDER === "string"
          && !TURNSTILE_SITE_KEY_PLACEHOLDER.includes("__UK_AQ_TURNSTILE_SITE_KEY__")) {
        return TURNSTILE_SITE_KEY_PLACEHOLDER.trim();
      }
    } catch (_error) {
      // A page may provide the value as a window property instead.
    }
    return String(window.TURNSTILE_SITE_KEY_PLACEHOLDER || "").trim();
  }

  function readHint() {
    try {
      const value = Number(localStorage.getItem(hintKey));
      return Number.isFinite(value) ? value : 0;
    } catch (_error) {
      return 0;
    }
  }

  function writeHint(value) {
    try {
      if (value > 0) localStorage.setItem(hintKey, String(Math.floor(value)));
      else localStorage.removeItem(hintKey);
    } catch (_error) {
      // Storage may be unavailable; the cookie session still works.
    }
  }

  function hasFreshSession() {
    sessionUntil = Math.max(sessionUntil, readHint());
    return Date.now() < sessionUntil - skewMs;
  }

  function clearCacheAuthToken(clearHint = true) {
    sessionUntil = 0;
    if (clearHint) writeHint(0);
  }

  function ensureTurnstileContainer() {
    let container = document.getElementById("uk-aq-turnstile-widget-shared");
    if (!container) {
      container = document.createElement("div");
      container.id = "uk-aq-turnstile-widget-shared";
      document.body.appendChild(container);
    }
    Object.assign(container.style, {
      position: "fixed", right: "16px", bottom: "16px", width: "300px",
      minHeight: "65px", zIndex: "2147483647", background: "transparent",
      display: "none", pointerEvents: "none",
    });
    return container;
  }

  function hideTurnstileContainer() {
    const container = document.getElementById("uk-aq-turnstile-widget-shared");
    if (container) {
      container.style.display = "none";
      container.style.pointerEvents = "none";
    }
  }

  function showTurnstileContainer() {
    const container = ensureTurnstileContainer();
    container.style.display = "";
    container.style.pointerEvents = "";
    return container;
  }

  async function ensureTurnstileScript() {
    if (window.turnstile?.render) return;
    if (!scriptInflight) {
      scriptInflight = new Promise((resolve, reject) => {
        const existing = document.getElementById("uk-aq-turnstile-script");
        if (existing) {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }
        const script = document.createElement("script");
        script.id = "uk-aq-turnstile-script";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Turnstile script."));
        document.head.appendChild(script);
      });
    }
    await scriptInflight;
  }

  async function ensureTurnstileWidget() {
    const siteKey = configuredSiteKey();
    if (!siteKey) throw new Error("Missing Turnstile site key.");
    await ensureTurnstileScript();
    if (widgetId !== null) return widgetId;
    widgetId = window.turnstile.render(ensureTurnstileContainer(), {
      sitekey: siteKey,
      appearance: "interaction-only",
      execution: "execute",
      theme: "auto",
      "before-interactive-callback": showTurnstileContainer,
      callback: (token) => {
        const resolve = resolveToken;
        resolveToken = null;
        rejectToken = null;
        hideTurnstileContainer();
        if (resolve) resolve(token);
      },
      "error-callback": (code) => {
        const reject = rejectToken;
        resolveToken = null;
        rejectToken = null;
        if (reject) reject(new Error(`Turnstile failed: ${code || "unknown error"}`));
      },
    });
    return widgetId;
  }

  async function getTurnstileToken() {
    if (!tokenInflight) {
      tokenInflight = (async () => {
        const id = await ensureTurnstileWidget();
        const promise = new Promise((resolve, reject) => {
          resolveToken = resolve;
          rejectToken = reject;
          setTimeout(() => {
            if (rejectToken === reject) {
              resolveToken = null;
              rejectToken = null;
              reject(new Error("Turnstile token timed out."));
            }
          }, 30000);
        });
        window.turnstile.execute(id);
        return promise;
      })().finally(() => { tokenInflight = null; });
    }
    return tokenInflight;
  }

  async function getCacheAuthToken(forceRefresh = false) {
    if (!forceRefresh && hasFreshSession()) return "session";
    if (!sessionInflight) {
      sessionInflight = (async () => {
        const token = await getTurnstileToken();
        const response = await nativeFetch(cacheSessionUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "X-UK-AQ-Session-Init": "1",
            "CF-Turnstile-Token": token,
          },
          credentials: "include",
        });
        if (!response.ok) throw new Error(`Session start failed: ${response.status}`);
        const payload = await response.json().catch(() => ({}));
        const seconds = Number(payload?.session_expires_in);
        sessionUntil = Date.now() + Math.max(30000, (Number.isFinite(seconds) ? seconds : 300) * 1000);
        writeHint(sessionUntil);
        debug("session-started");
        return "session";
      })().finally(() => { sessionInflight = null; });
    }
    return sessionInflight;
  }

  async function fetchCacheApi(input, init = {}, retryOnAuthFailure = true) {
    if (retryOnAuthFailure && !hasFreshSession()) await getCacheAuthToken(false);
    let response = await nativeFetch(input, { ...init, credentials: "include" });
    if (response.status === 401 && retryOnAuthFailure) {
      clearCacheAuthToken(false);
      await getCacheAuthToken(false);
      response = await nativeFetch(input, { ...init, credentials: "include" });
      if (response.status === 401) {
        clearCacheAuthToken();
        await getCacheAuthToken(true);
        response = await nativeFetch(input, { ...init, credentials: "include" });
      }
    }
    return response;
  }

  window.addEventListener("storage", (event) => {
    if (event.key === hintKey) sessionUntil = Math.max(sessionUntil, readHint());
  });

  window.ukAqSharedAuth = {
    cacheBaseUrl,
    cacheSessionUrl,
    clearCacheAuthToken,
    ensureTurnstileContainer,
    ensureTurnstileScript,
    ensureTurnstileWidget,
    hideTurnstileContainer,
    showTurnstileContainer,
    getTurnstileToken,
    getCacheAuthToken,
    fetchCacheApi,
  };
  window.ukAqFetchCacheApi = fetchCacheApi;
})();
