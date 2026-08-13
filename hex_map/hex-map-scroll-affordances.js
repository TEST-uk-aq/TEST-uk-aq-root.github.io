(function(root) {
  "use strict";

  const attachedSensorTables = new WeakMap();

  function attachPersistentScrollbar(scrollEl, options = {}) {
    if (!scrollEl) return null;
    const threshold = Number.isFinite(options.threshold) ? options.threshold : 2;
    const trackOffsetTop = Number.isFinite(options.trackOffsetTop) ? Math.max(0, options.trackOffsetTop) : 0;
    const host = options.host || scrollEl.parentElement;
    if (!host) return null;
    if (root.getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }

    let rail = host.querySelector(":scope > .sensor-scrollbar-rail");
    if (!rail) {
      rail = document.createElement("div");
      rail.className = "sensor-scrollbar-rail";
      rail.hidden = true;
      rail.setAttribute("aria-hidden", "true");
      const thumb = document.createElement("span");
      thumb.className = "sensor-scrollbar-thumb";
      rail.appendChild(thumb);
      host.appendChild(rail);
    }
    if (trackOffsetTop > 0) {
      rail.style.setProperty("--sensor-scrollbar-rail-top", `${trackOffsetTop}px`);
    } else {
      rail.style.removeProperty("--sensor-scrollbar-rail-top");
    }
    const thumbEl = rail.querySelector(".sensor-scrollbar-thumb");
    let rafId = 0;
    const isForceHidden = () => options.isHidden ? !!options.isHidden() : false;

    const measureGeometry = () => {
      const trackHeight = rail.clientHeight || 0;
      const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
      const scrollTrackHeight = Math.max(0, scrollEl.scrollHeight - trackOffsetTop);
      const visibleTrackHeight = Math.max(0, scrollEl.clientHeight - trackOffsetTop);
      const visibleRatio = scrollTrackHeight > 0
        ? Math.max(0.18, Math.min(1, visibleTrackHeight / scrollTrackHeight))
        : 1;
      const thumbHeight = Math.max(42, trackHeight * visibleRatio);
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      return { trackHeight, scrollable, thumbHeight, maxThumbTop };
    };

    let dragPointerId = null;
    let dragStartPointerY = 0;
    let dragStartScrollTop = 0;

    const onThumbPointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (isForceHidden() || rail.hidden) return;
      const { scrollable, maxThumbTop } = measureGeometry();
      if (scrollable <= 0 || maxThumbTop <= 0) return;
      dragPointerId = event.pointerId;
      dragStartPointerY = event.clientY;
      dragStartScrollTop = scrollEl.scrollTop;
      rail.classList.add("is-dragging");
      try { thumbEl.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      event.stopPropagation();
    };

    const onThumbPointerMove = (event) => {
      if (dragPointerId === null || event.pointerId !== dragPointerId) return;
      const { scrollable, maxThumbTop } = measureGeometry();
      if (scrollable <= 0 || maxThumbTop <= 0) return;
      const deltaY = event.clientY - dragStartPointerY;
      const ratio = deltaY / maxThumbTop;
      const next = dragStartScrollTop + ratio * scrollable;
      scrollEl.scrollTop = Math.max(0, Math.min(scrollable, next));
      event.preventDefault();
    };

    const endDrag = (event) => {
      if (dragPointerId === null) return;
      if (event && event.pointerId !== dragPointerId) return;
      try { thumbEl.releasePointerCapture(dragPointerId); } catch (_) {}
      dragPointerId = null;
      rail.classList.remove("is-dragging");
    };

    thumbEl?.addEventListener("pointerdown", onThumbPointerDown);
    thumbEl?.addEventListener("pointermove", onThumbPointerMove);
    thumbEl?.addEventListener("pointerup", endDrag);
    thumbEl?.addEventListener("pointercancel", endDrag);

    const onRailPointerDown = (event) => {
      if (event.target === thumbEl) return;
      if (event.button !== undefined && event.button !== 0) return;
      if (isForceHidden() || rail.hidden) return;
      const { trackHeight, scrollable, thumbHeight, maxThumbTop } = measureGeometry();
      if (scrollable <= 0 || trackHeight <= 0) return;
      const railRect = rail.getBoundingClientRect();
      const clickY = event.clientY - railRect.top;
      const targetThumbTop = Math.max(0, Math.min(maxThumbTop, clickY - thumbHeight / 2));
      const ratio = maxThumbTop > 0 ? targetThumbTop / maxThumbTop : 0;
      scrollEl.scrollTop = ratio * scrollable;
      event.preventDefault();
    };

    rail.addEventListener("pointerdown", onRailPointerDown);

    const update = () => {
      rafId = 0;
      if (isForceHidden()) {
        rail.hidden = true;
        return;
      }
      const canScroll = scrollEl.scrollHeight > scrollEl.clientHeight + threshold;
      rail.hidden = !canScroll;
      if (!canScroll || !thumbEl) return;
      const { trackHeight, scrollable, thumbHeight, maxThumbTop } = measureGeometry();
      if (trackHeight <= 0 || scrollable <= 0) return;
      const top = maxThumbTop * (scrollEl.scrollTop / scrollable);
      rail.style.setProperty("--sensor-scroll-thumb-height", `${thumbHeight.toFixed(1)}px`);
      rail.style.setProperty("--sensor-scroll-thumb-top", `${top.toFixed(1)}px`);
    };

    const schedule = () => {
      if (rafId) return;
      rafId = root.requestAnimationFrame(update);
    };

    scrollEl.addEventListener("scroll", schedule, { passive: true });
    root.addEventListener("resize", schedule);

    const resizeObserver = "ResizeObserver" in root
      ? new ResizeObserver(schedule)
      : null;
    resizeObserver?.observe(scrollEl);
    if (scrollEl.firstElementChild) resizeObserver?.observe(scrollEl.firstElementChild);

    const mutationObserver = "MutationObserver" in root
      ? new MutationObserver(schedule)
      : null;
    mutationObserver?.observe(scrollEl, { childList: true, subtree: true, attributes: true });

    schedule();

    return {
      update: schedule,
      destroy() {
        if (rafId) root.cancelAnimationFrame(rafId);
        scrollEl.removeEventListener("scroll", schedule);
        root.removeEventListener("resize", schedule);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        thumbEl?.removeEventListener("pointerdown", onThumbPointerDown);
        thumbEl?.removeEventListener("pointermove", onThumbPointerMove);
        thumbEl?.removeEventListener("pointerup", endDrag);
        thumbEl?.removeEventListener("pointercancel", endDrag);
        rail.removeEventListener("pointerdown", onRailPointerDown);
        rail.remove();
      },
    };
  }

  function attachScrollIndicators(scrollEl, options = {}) {
    if (!scrollEl) return null;

    const threshold = Number.isFinite(options.threshold) ? options.threshold : 2;
    const hostClass = options.hostClass || "sensor-scroll-indicator-shell";
    let host = options.host || scrollEl.parentElement;
    if (!host || !host.classList?.contains(hostClass)) {
      host = document.createElement("div");
      host.className = hostClass;
      scrollEl.parentNode?.insertBefore(host, scrollEl);
      host.appendChild(scrollEl);
    } else {
      host.classList.add(hostClass);
    }

    const makeIndicator = (position) => {
      const indicator = document.createElement("div");
      indicator.className = `sensor-scroll-indicator sensor-scroll-indicator--${position}`;
      indicator.setAttribute("aria-hidden", "true");
      indicator.hidden = true;
      const chevron = document.createElement("span");
      chevron.className = "sensor-scroll-indicator__chevron";
      indicator.appendChild(chevron);
      host.appendChild(indicator);
      return indicator;
    };

    const topIndicator = makeIndicator("top");
    const bottomIndicator = makeIndicator("bottom");
    let rafId = 0;

    const update = () => {
      rafId = 0;
      const canScroll = scrollEl.scrollHeight > scrollEl.clientHeight + threshold;
      const atTop = scrollEl.scrollTop <= threshold;
      const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - threshold;
      topIndicator.hidden = !canScroll || atTop;
      bottomIndicator.hidden = !canScroll || atBottom;
    };

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = root.requestAnimationFrame(update);
    };

    scrollEl.addEventListener("scroll", scheduleUpdate, { passive: true });
    root.addEventListener("resize", scheduleUpdate);

    const resizeObserver = "ResizeObserver" in root
      ? new ResizeObserver(scheduleUpdate)
      : null;
    resizeObserver?.observe(scrollEl);
    if (scrollEl.firstElementChild) resizeObserver?.observe(scrollEl.firstElementChild);

    const mutationObserver = "MutationObserver" in root
      ? new MutationObserver(scheduleUpdate)
      : null;
    mutationObserver?.observe(scrollEl, { childList: true, subtree: true, attributes: true });

    scheduleUpdate();

    return {
      update: scheduleUpdate,
      destroy() {
        if (rafId) root.cancelAnimationFrame(rafId);
        scrollEl.removeEventListener("scroll", scheduleUpdate);
        root.removeEventListener("resize", scheduleUpdate);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        topIndicator.remove();
        bottomIndicator.remove();
      },
    };
  }

  function attachSensorTable(scrollEl, options = {}) {
    if (!scrollEl) return null;
    const existing = attachedSensorTables.get(scrollEl);
    if (existing) return existing;

    const indicators = attachScrollIndicators(scrollEl);
    const persistentScrollbar = attachPersistentScrollbar(scrollEl, {
      isHidden: options.isScrollbarHidden,
      trackOffsetTop: options.trackOffsetTop,
    });
    const contentEl = options.contentEl || null;
    let scrollContextKey = "";

    const onScroll = () => indicators?.update?.();
    const onWheel = (event) => {
      if (!scrollEl.classList.contains("is-scroll-forced")) {
        return;
      }
      event.stopPropagation();
      const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
      if (maxScrollTop <= 0 || !event.deltaY) {
        return;
      }
      const atTop = scrollEl.scrollTop <= 0;
      const atBottom = scrollEl.scrollTop >= maxScrollTop - 1;
      if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
        event.preventDefault();
      }
    };

    scrollEl.addEventListener("scroll", onScroll);
    scrollEl.addEventListener("wheel", onWheel, { passive: false });

    const controller = Object.freeze({
      update() {
        indicators?.update?.();
        persistentScrollbar?.update?.();
      },
      restorePosition(nextKey, previousScrollTop) {
        const normalizedKey = String(nextKey || "");
        const shouldPreserve = Boolean(
          normalizedKey
          && normalizedKey === scrollContextKey
          && contentEl?.childElementCount
        );
        scrollContextKey = normalizedKey;
        if (!shouldPreserve) {
          scrollEl.scrollTop = 0;
          return;
        }
        root.requestAnimationFrame(() => {
          if (scrollEl.hidden) return;
          const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
          scrollEl.scrollTop = Math.max(0, Math.min(previousScrollTop, maxScrollTop));
        });
      },
      destroy() {
        scrollEl.removeEventListener("scroll", onScroll);
        scrollEl.removeEventListener("wheel", onWheel);
        persistentScrollbar?.destroy?.();
        indicators?.destroy?.();
        if (attachedSensorTables.get(scrollEl) === controller) {
          attachedSensorTables.delete(scrollEl);
        }
      },
    });

    attachedSensorTables.set(scrollEl, controller);
    return controller;
  }

  // Each Hex sensor table attaches once and keeps its affordances for the document lifetime.
  root.UkAqHexMapScrollAffordances = Object.freeze({
    attachSensorTable,
  });
})(typeof window !== "undefined" ? window : globalThis);
