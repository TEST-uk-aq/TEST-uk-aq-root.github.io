(function initHomepagePollutantMetadataCarousel() {
  "use strict";

  if (!document.body.classList.contains("home-page")) return;
  const circles = Array.from(document.querySelectorAll(".pollutant-circle"));
  if (!circles.length) return;

  const compactMedia = window.matchMedia("(max-width: 1079px)");
  const mobileMedia = window.matchMedia("(max-width: 767px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const HOLD_MS = 3200;
  const CLEANUP_MS = 320;
  const timers = new Map();
  const cleanupTimers = new Map();

  function metadataNodes(circle) {
    return Array.from(
      circle.querySelectorAll(".pollutant-observed, .pollutant-station, .pollutant-network"),
    );
  }

  function metadataLines(circle) {
    return metadataNodes(circle)
      .filter((line) => !line.hidden && line.textContent.trim());
  }

  function syncMetadataLineBoxes(circle) {
    const lineHeight = mobileMedia.matches ? "2.1em" : "2.25em";
    metadataNodes(circle).forEach((line) => {
      if (line.hidden) return;
      line.style.display = "flex";
      line.style.alignItems = "center";
      line.style.justifyContent = "center";
      line.style.minHeight = lineHeight;
      line.style.height = lineHeight;

      if (line.classList.contains("pollutant-observed")) {
        line.style.flexDirection = "column";
        const time = line.querySelector("time");
        if (time) {
          time.style.display = "block";
          time.style.whiteSpace = "nowrap";
        }
      }
    });
  }

  function clearMetadataLineBoxes(circle) {
    metadataNodes(circle).forEach((line) => {
      line.style.removeProperty("display");
      line.style.removeProperty("align-items");
      line.style.removeProperty("justify-content");
      line.style.removeProperty("min-height");
      line.style.removeProperty("height");
      line.style.removeProperty("flex-direction");

      if (line.classList.contains("pollutant-observed")) {
        const time = line.querySelector("time");
        if (time) {
          time.style.removeProperty("display");
          time.style.removeProperty("white-space");
        }
      }
    });
  }

  function clearLineClasses(circle) {
    metadataNodes(circle)
      .forEach((line) => line.classList.remove("is-meta-current", "is-meta-leaving"));
  }

  function clearCircleTimers(circle) {
    if (timers.has(circle)) {
      window.clearInterval(timers.get(circle));
      timers.delete(circle);
    }
    if (cleanupTimers.has(circle)) {
      window.clearTimeout(cleanupTimers.get(circle));
      cleanupTimers.delete(circle);
    }
  }

  function setDesktopState(circle) {
    clearCircleTimers(circle);
    clearLineClasses(circle);
    clearMetadataLineBoxes(circle);
    circle.classList.remove("pollutant-meta-cycle", "pollutant-meta-static");
  }

  function setStaticState(circle) {
    clearCircleTimers(circle);
    clearLineClasses(circle);
    clearMetadataLineBoxes(circle);
    circle.classList.remove("pollutant-meta-cycle");
    circle.classList.add("pollutant-meta-static");
  }

  function showFirstLine(circle) {
    syncMetadataLineBoxes(circle);
    clearLineClasses(circle);
    const lines = metadataLines(circle);
    if (!lines.length) return;
    lines[0].classList.add("is-meta-current");
  }

  function advanceCircle(circle) {
    if (!compactMedia.matches || document.hidden) return;
    syncMetadataLineBoxes(circle);
    const lines = metadataLines(circle);
    if (!lines.length) {
      clearLineClasses(circle);
      return;
    }

    let currentIndex = lines.findIndex((line) => line.classList.contains("is-meta-current"));
    if (currentIndex < 0) {
      showFirstLine(circle);
      return;
    }
    if (lines.length === 1) return;

    const current = lines[currentIndex];
    const next = lines[(currentIndex + 1) % lines.length];
    current.classList.remove("is-meta-current");
    current.classList.add("is-meta-leaving");
    next.classList.remove("is-meta-leaving");

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        next.classList.add("is-meta-current");
      });
    });

    if (cleanupTimers.has(circle)) window.clearTimeout(cleanupTimers.get(circle));
    cleanupTimers.set(circle, window.setTimeout(() => {
      current.classList.remove("is-meta-leaving");
      cleanupTimers.delete(circle);
    }, CLEANUP_MS));
  }

  function startCircle(circle) {
    clearCircleTimers(circle);
    if (!compactMedia.matches) {
      setDesktopState(circle);
      return;
    }
    if (reducedMotion.matches) {
      setStaticState(circle);
      return;
    }

    circle.classList.remove("pollutant-meta-static");
    circle.classList.add("pollutant-meta-cycle");
    syncMetadataLineBoxes(circle);
    showFirstLine(circle);
    timers.set(circle, window.setInterval(() => advanceCircle(circle), HOLD_MS));
  }

  function syncAll() {
    circles.forEach((circle) => {
      if (document.hidden) {
        clearCircleTimers(circle);
        return;
      }
      startCircle(circle);
    });
  }

  document.addEventListener("visibilitychange", syncAll);
  if (typeof compactMedia.addEventListener === "function") {
    compactMedia.addEventListener("change", syncAll);
    mobileMedia.addEventListener("change", syncAll);
    reducedMotion.addEventListener("change", syncAll);
  } else {
    compactMedia.addListener?.(syncAll);
    mobileMedia.addListener?.(syncAll);
    reducedMotion.addListener?.(syncAll);
  }

  syncAll();
})();
