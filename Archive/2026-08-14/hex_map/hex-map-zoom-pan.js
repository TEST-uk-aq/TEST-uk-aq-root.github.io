(function(root) {
  "use strict";

  const MIN_SCALE = 0.8;
  const MAX_SCALE = 3;
  const STEP = 1.15;

  function createHexMapZoomPanController() {
    const controls = Array.from(document.querySelectorAll("[data-map-zoom-controls]"));
    if (!controls.length) {
      return Object.freeze({});
    }

    const mapState = new Map();

    function getSvgElement(control) {
      const id = control.getAttribute("data-map-svg-id");
      if (!id) {
        return null;
      }
      return document.getElementById(id);
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function getState(svgId) {
      const state = mapState.get(svgId);
      if (state) {
        return state;
      }
      const initial = { scale: 1, tx: 0, ty: 0 };
      mapState.set(svgId, initial);
      return initial;
    }

    function clampPan(viewport, state) {
      const width = viewport.clientWidth || 0;
      const height = viewport.clientHeight || 0;
      const maxTx = Math.max(0, ((state.scale - 1) * width) / 2);
      const maxTy = Math.max(0, ((state.scale - 1) * height) / 2);
      return {
        scale: state.scale,
        tx: clamp(state.tx, -maxTx, maxTx),
        ty: clamp(state.ty, -maxTy, maxTy),
      };
    }

    function applyTransform(svg, viewport, nextState, animate = false) {
      const clampedScale = clamp(nextState.scale, MIN_SCALE, MAX_SCALE);
      const clampedState = clampPan(viewport, {
        scale: clampedScale,
        tx: nextState.tx,
        ty: nextState.ty,
      });
      mapState.set(svg.id, clampedState);
      svg.style.transformOrigin = "50% 50%";
      svg.style.transform = `translate(${clampedState.tx}px, ${clampedState.ty}px) scale(${clampedState.scale})`;
      svg.style.transition = animate ? "transform 0.18s ease" : "none";
    }

    function setScale(svg, viewport, nextScale, animate = true) {
      const current = getState(svg.id);
      applyTransform(svg, viewport, {
        scale: nextScale,
        tx: current.tx,
        ty: current.ty,
      }, animate);
    }

    function zoomAroundPoint(svg, viewport, factor, anchorX, anchorY, animate = false) {
      const current = getState(svg.id);
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      if (Math.abs(nextScale - current.scale) < 0.0001) {
        return;
      }
      const width = viewport.clientWidth || 0;
      const height = viewport.clientHeight || 0;
      const centerX = width / 2;
      const centerY = height / 2;
      const ratio = nextScale / current.scale;
      const nextTx = (current.tx * ratio) + ((anchorX - centerX) * (1 - ratio));
      const nextTy = (current.ty * ratio) + ((anchorY - centerY) * (1 - ratio));
      applyTransform(svg, viewport, {
        scale: nextScale,
        tx: nextTx,
        ty: nextTy,
      }, animate);
    }

    function resetView(svg, viewport) {
      applyTransform(svg, viewport, { scale: 1, tx: 0, ty: 0 }, true);
    }

    controls.forEach((control) => {
      const svg = getSvgElement(control);
      if (!svg || !svg.id) {
        return;
      }
      const canvasWrap = control.closest(".map-canvas-wrap");
      const viewport = canvasWrap ? canvasWrap.querySelector(".map-svg-viewport") : null;
      if (!viewport) {
        return;
      }
      resetView(svg, viewport);

      let drag = null;
      let suppressClickUntil = 0;

      control.addEventListener("click", (event) => {
        const button = event.target instanceof Element
          ? event.target.closest("[data-zoom-action]")
          : null;
        if (!button) {
          return;
        }
        const action = button.getAttribute("data-zoom-action");
        const current = getState(svg.id).scale;
        if (action === "in") {
          setScale(svg, viewport, current * STEP, true);
          return;
        }
        if (action === "out") {
          setScale(svg, viewport, current / STEP, true);
          return;
        }
        if (action === "reset") {
          resetView(svg, viewport);
        }
      });

      viewport.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        const current = getState(svg.id);
        if (current.scale <= 1.001) {
          return;
        }
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startTx: current.tx,
          startTy: current.ty,
          moved: false,
        };
        viewport.classList.add("is-dragging");
      });

      viewport.addEventListener("wheel", (event) => {
        if (!(event.ctrlKey || event.metaKey)) {
          return;
        }
        const rect = viewport.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          return;
        }
        const anchorX = event.clientX - rect.left;
        const anchorY = event.clientY - rect.top;
        const speed = 0.006;
        const factor = Math.exp(-event.deltaY * speed);
        zoomAroundPoint(svg, viewport, factor, anchorX, anchorY, false);
        event.preventDefault();
      }, { passive: false });

      let gestureStartScale = 1;
      viewport.addEventListener("gesturestart", (event) => {
        gestureStartScale = getState(svg.id).scale;
        event.preventDefault();
      }, { passive: false });

      viewport.addEventListener("gesturechange", (event) => {
        const rect = viewport.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          return;
        }
        const anchorX = event.clientX - rect.left;
        const anchorY = event.clientY - rect.top;
        const targetScale = clamp(gestureStartScale * event.scale, MIN_SCALE, MAX_SCALE);
        const current = getState(svg.id);
        const factor = targetScale / current.scale;
        zoomAroundPoint(svg, viewport, factor, anchorX, anchorY, false);
        event.preventDefault();
      }, { passive: false });

      window.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) {
          return;
        }
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) > 3) {
          drag.moved = true;
        }
        if (!drag.moved) {
          return;
        }
        applyTransform(svg, viewport, {
          scale: getState(svg.id).scale,
          tx: drag.startTx + dx,
          ty: drag.startTy + dy,
        }, false);
        event.preventDefault();
      }, { passive: false });

      function endDrag(event) {
        if (!drag || event.pointerId !== drag.pointerId) {
          return;
        }
        if (drag.moved) {
          suppressClickUntil = performance.now() + 220;
        }
        drag = null;
        viewport.classList.remove("is-dragging");
      }

      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);

      viewport.addEventListener("click", (event) => {
        if (performance.now() < suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);

      window.addEventListener("resize", () => {
        applyTransform(svg, viewport, getState(svg.id), false);
      });
    });

    return Object.freeze({});
  }

  // The Hex Map page mounts once; this controller and its listeners live for the document lifetime.
  let controller = null;

  root.UkAqHexMapZoomPan = Object.freeze({
    mount() {
      if (!controller) {
        controller = createHexMapZoomPanController();
      }
      return controller;
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
