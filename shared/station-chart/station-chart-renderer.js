// Shared D3 renderer for station observation lines and AQI bands.
(function (root, factory) {
  const api = factory(root.d3, root.ChartCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UkAqStationChartRenderer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (d3Global, chartCoreGlobal) {
  "use strict";

  const DAQI_COLORS = Object.freeze({
    1: "#1DB100", 2: "#61D836", 3: "#34FF00", 4: "#FFFB00", 5: "#FFCE04",
    6: "#FF9300", 7: "#FF6464", 8: "#FF2600", 9: "#A50026", 10: "#672C7F",
  });
  const EAQI_COLORS = Object.freeze({
    Good: "#1DB100", Fair: "#FFFB00", Moderate: "#FF9300", Poor: "#FF2600",
    "Very poor": "#A50026", "Extremely poor": "#672C7F",
    1: "#1DB100", 2: "#FFFB00", 3: "#FF9300", 4: "#FF2600", 5: "#A50026", 6: "#672C7F",
  });
  const SERIES_COLOUR = "#3C78AC";
  const HOUR_MS = 60 * 60 * 1000;

  function nodeValue(value) {
    if (!value) return null;
    if (typeof value.node === "function") return value.node();
    return value;
  }

  function formatTime(date) {
    return date instanceof Date && Number.isFinite(date.getTime())
      ? date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
      : "";
  }

  function buildXAxis(d3, scale, rangeMs) {
    const dayMs = 24 * HOUR_MS;
    const tickCount = rangeMs <= dayMs ? 8 : rangeMs <= 7 * dayMs ? 7 : 6;
    const format = rangeMs <= dayMs
      ? d3.timeFormat("%H:%M")
      : rangeMs <= 7 * dayMs ? d3.timeFormat("%a %H:%M") : d3.timeFormat("%d %b");
    return d3.axisBottom(scale).ticks(tickCount).tickFormat(format).tickSizeOuter(0);
  }

  function createStationChartRenderer(options = {}) {
    const d3 = options.d3 || d3Global;
    const ChartCore = options.chartCore || chartCoreGlobal;
    if (!d3 || !ChartCore) throw new Error("station_chart_renderer_dependencies_missing");
    let refs = null;
    let frame = null;
    let lastState = null;
    let resizeObserver = null;
    let progressBar = null;
    let animationFrameId = null;
    let animationGeneration = 0;
    let activeDomainAnimation = null;
    let pendingDomainState = null;

    function dimensions(value = {}) {
      const svgEl = refs?.svgEl;
      return {
        width: Math.max(320, Number(value.width) || svgEl?.clientWidth || 960),
        height: Math.max(300, Number(value.height) || svgEl?.clientHeight || 390),
      };
    }

    function createFrame(state, requestedDimensions) {
      const size = dimensions(requestedDimensions);
      const marginTop = Math.max(52, Math.round(size.height * 0.12));
      const margin = { top: marginTop, right: 24, bottom: 44, left: 72 };
      const svg = refs.svg;
      progressBar = null;
      svg.selectAll("*").remove();
      svg.attr("viewBox", `0 0 ${size.width} ${size.height}`);
      const clipId = `${options.clipIdPrefix || "station-chart"}-${Math.random().toString(36).slice(2)}`;
      svg.append("defs").append("clipPath").attr("id", clipId).append("rect")
        .attr("x", margin.left).attr("y", margin.top)
        .attr("width", Math.max(0, size.width - margin.left - margin.right))
        .attr("height", Math.max(0, size.height - margin.top - margin.bottom));
      const xScale = d3.scaleTime()
        .domain([state.range.startDate, state.range.endDate])
        .range([margin.left, size.width - margin.right]);
      const yScale = d3.scaleLinear().domain([0, 1]).range([size.height - margin.bottom, margin.top]);
      const aqi = svg.append("g").attr("class", "aqi-bands");
      const xAxis = svg.append("g").attr("class", "chart-axis")
        .attr("transform", `translate(0, ${size.height - margin.bottom})`);
      const yAxis = svg.append("g").attr("class", "chart-axis")
        .attr("transform", `translate(${margin.left}, 0)`);
      const yLabel = svg.append("text").attr("class", "chart-y-axis-label").attr("text-anchor", "middle");
      const guideline = svg.append("line").attr("class", "chart-guideline").style("opacity", 0);
      const guidelineLabel = svg.append("text").attr("class", "chart-guideline-label")
        .attr("text-anchor", "end").style("opacity", 0);
      const series = svg.append("g").attr("class", "chart-series-layers").attr("clip-path", `url(#${clipId})`);
      const symbols = svg.append("g").attr("class", "chart-series-symbols").attr("clip-path", `url(#${clipId})`);
      const empty = svg.append("g").attr("class", "chart-empty-state");
      const overlay = svg.append("rect").attr("class", "chart-overlay")
        .attr("fill", "transparent").style("pointer-events", "all");
      frame = { ...size, margin, clipId, svg, xScale, yScale, aqi, xAxis, yAxis, yLabel, guideline, guidelineLabel, series, symbols, empty, overlay };
      layoutFrame(state);
      installTooltip();
      return frame;
    }

    function layoutFrame(state) {
      if (!frame) return;
      const { width, height, margin } = frame;
      frame.svg.select(`#${frame.clipId} rect`)
        .attr("x", margin.left).attr("y", margin.top)
        .attr("width", Math.max(0, width - margin.left - margin.right))
        .attr("height", Math.max(0, height - margin.top - margin.bottom));
      frame.xScale.range([margin.left, width - margin.right]);
      frame.yScale.range([height - margin.bottom, margin.top]);
      frame.xAxis.attr("transform", `translate(0, ${height - margin.bottom})`);
      frame.yAxis.attr("transform", `translate(${margin.left}, 0)`);
      const labelX = Math.max(12, margin.left - 44);
      const labelY = (margin.top + height - margin.bottom) / 2;
      frame.yLabel.attr("x", labelX).attr("y", labelY)
        .attr("transform", `rotate(-90, ${labelX}, ${labelY})`)
        .text(state?.selection?.[0]?.units || state?.selection?.[0]?.unit || "µg/m³");
      frame.overlay.attr("x", margin.left).attr("y", margin.top)
        .attr("width", Math.max(0, width - margin.left - margin.right))
        .attr("height", Math.max(0, height - margin.top - margin.bottom));
    }

    function initialise(config = {}) {
      const svgEl = nodeValue(config.svg || options.svg);
      if (!svgEl) throw new Error("station_chart_svg_missing");
      refs = {
        svgEl,
        svg: d3.select(svgEl),
        tooltip: nodeValue(config.tooltip || options.tooltip),
        wrap: nodeValue(config.wrap || options.wrap) || svgEl.parentElement,
      };
      if (options.observeResize !== false && typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(function () {
          if (lastState) resize({}, lastState);
        });
        resizeObserver.observe(refs.wrap || svgEl);
      }
      return true;
    }

    function ensureFrame(state) {
      if (!refs || !state?.range) return null;
      if (!frame) return createFrame(state);
      layoutFrame(state);
      return frame;
    }

    function cancelDomainAnimation() {
      animationGeneration += 1;
      if (animationFrameId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = null;
      activeDomainAnimation = null;
      pendingDomainState = null;
    }

    function invalidatePollutantContext() {
      if (!activeDomainAnimation) return;
      const retained = retainNewestState(activeDomainAnimation.state, pendingDomainState) || lastState;
      cancelDomainAnimation();
      if (!frame || !retained?.range) return;
      lastState = retained;
      frame.xScale.domain([retained.range.startDate, retained.range.endDate]);
      frame.yScale.domain(observationDomain(retained));
      drawAxes(retained, false);
      drawObservations(retained, true);
      drawAqi(retained);
    }

    function retainNewestState(current, candidate) {
      if (!candidate) return current;
      if (!current) return candidate;
      return Number(candidate.revision) >= Number(current.revision) ? candidate : current;
    }

    function observationExtent(state) {
      const values = [];
      state?.observations?.forEach(function (points) {
        points.forEach(function (point) {
          if (Number.isFinite(Number(point?.value))) values.push(Number(point.value));
        });
      });
      const guideline = Number(state?.guideline?.limit_value);
      if (Number.isFinite(guideline)) values.push(guideline);
      if (!values.length) return [0, 1];
      const min = Math.min(0, ...values);
      const max = Math.max(1, ...values);
      return min === max ? [min, min + 1] : [min, max];
    }

    function observationDomain(state) {
      return d3.scaleLinear().domain(observationExtent(state)).nice(5).domain();
    }

    function drawAxes(state, updateDomains) {
      const current = frame;
      if (!current) return;
      if (updateDomains !== false) {
        current.xScale.domain([state.range.startDate, state.range.endDate]);
        current.yScale.domain(observationDomain(state));
      }
      current.xAxis.call(buildXAxis(d3, current.xScale, state.range.endMs - state.range.startMs));
      current.yAxis.call(d3.axisLeft(current.yScale).ticks(5).tickSizeOuter(0));
      const guideline = Number(state.guideline?.limit_value);
      if (Number.isFinite(guideline)) {
        const y = current.yScale(guideline);
        current.guideline.attr("x1", current.margin.left).attr("x2", current.width - current.margin.right)
          .attr("y1", y).attr("y2", y).style("opacity", 1);
        current.guidelineLabel.attr("x", current.width - current.margin.right)
          .attr("y", Math.max(current.margin.top + 12, y - 6))
          .text(state.guideline?.label || state.guideline?.short_name || "Guideline")
          .style("opacity", 1);
      } else {
        current.guideline.style("opacity", 0);
        current.guidelineLabel.style("opacity", 0);
      }
    }

    function renderAxes(state) {
      lastState = state;
      if (activeDomainAnimation) {
        pendingDomainState = retainNewestState(pendingDomainState, state);
        return;
      }
      const current = ensureFrame(state);
      if (!current) return;
      drawAxes(state, true);
    }

    function drawObservations(state, includeSymbols) {
      const current = frame;
      if (!current) return;
      const line = d3.line().defined(function (point) { return Number.isFinite(Number(point?.value)); })
        .x(function (point) { return current.xScale(point.date); })
        .y(function (point) { return current.yScale(point.value); });
      const entries = state.selection || [];
      const paths = current.series.selectAll("path.chart-line").data(entries, function (entry) { return entry.station_id; });
      paths.exit().remove();
      paths.enter().append("path").attr("class", "chart-line").merge(paths)
        .attr("data-station-id", function (entry) { return entry.station_id; })
        .attr("d", function (entry) {
          const points = state.observations.get(entry.station_id) || [];
          return ChartCore.buildSegments(points).map(function (segment) { return line(segment); }).filter(Boolean).join(" ") || null;
        });
      const pointCount = Array.from(state.observations.values()).reduce(function (count, points) { return count + points.length; }, 0);
      current.empty.selectAll("*").remove();
      if (!pointCount && !state.loading) renderEmpty(options.noHistoryMessage || "No chart data is available in the selected range");
      if (includeSymbols === false) {
        current.symbols.style("opacity", 0);
        return;
      }
      current.symbols.style("opacity", 1).selectAll("*").remove();
      entries.forEach(function (entry, index) {
        const points = state.observations.get(entry.station_id) || [];
        const segments = ChartCore.buildSegments(points);
        const positions = ChartCore.getSymbolPositions(points, segments, ChartCore.getSymbolIntervalMs(options.getWindowLabel?.() || "24h"));
        const path = ChartCore.getSymbolPathData(index, 72);
        positions.forEach(function (pointIndex) {
          const point = points[pointIndex];
          if (!point || !Number.isFinite(point.value)) return;
          current.symbols.append("path").attr("class", "chart-series-symbol")
            .attr("data-station-id", entry.station_id).attr("d", path)
            .attr("transform", `translate(${current.xScale(point.date)},${current.yScale(point.value)})`)
            .attr("fill", SERIES_COLOUR).attr("stroke", "#fff").attr("stroke-width", 1.5);
        });
      });
    }

    function renderObservations(state) {
      lastState = state;
      if (activeDomainAnimation) {
        pendingDomainState = retainNewestState(pendingDomainState, state);
        return;
      }
      const current = ensureFrame(state);
      if (!current) return;
      drawObservations(state, true);
    }

    function drawBand(label, key, colours, y, state) {
      const current = frame;
      const bandHeight = 22;
      const group = current.aqi.append("g").attr("class", `aqi-band aqi-band--${key}`)
        .attr("transform", `translate(0, ${y})`);
      group.append("text").attr("class", "aqi-band-label")
        .attr("x", current.margin.left - 8).attr("y", bandHeight / 2).attr("dy", "0.32em")
        .attr("text-anchor", "end").text(label);
      (state.aqi || []).forEach(function (point) {
        const endpointMs = point?.periodEnd?.getTime?.() ?? point?.date?.getTime?.();
        const startMs = point?.periodStart?.getTime?.() ?? endpointMs - HOUR_MS;
        const colour = colours[point?.[key]];
        if (!Number.isFinite(endpointMs) || !Number.isFinite(startMs) || !colour) return;
        const clippedStart = Math.max(state.range.startMs, startMs);
        const clippedEnd = Math.min(state.range.endMs, endpointMs);
        if (clippedEnd <= clippedStart) return;
        const x = current.xScale(new Date(clippedStart));
        const endX = current.xScale(new Date(clippedEnd));
        group.append("rect").attr("class", "aqi-band-segment")
          .attr("x", x).attr("y", 0).attr("width", Math.max(0, endX - x)).attr("height", bandHeight)
          .attr("fill", colour);
      });
    }

    function drawAqi(state) {
      const current = frame;
      if (!current) return;
      current.aqi.selectAll("*").remove();
      current.aqi.classed("is-loading", state.aqi_loading === true);
      drawBand("DAQI", "daqi", DAQI_COLORS, 1, state);
      drawBand("EAQI", "eaqi", EAQI_COLORS, 27, state);
      const sourceIndex = (state.selection || []).findIndex(function (entry) {
        return entry.station_id === state.aqi_source_id;
      });
      const symbol = sourceIndex >= 0 ? ChartCore.getSymbolPathData(sourceIndex, 130) : null;
      if (symbol) current.aqi.append("path").attr("class", "aqi-band-source-symbol")
        .attr("d", symbol).attr("transform", `translate(${current.margin.left - 62},24)`)
        .attr("fill", SERIES_COLOUR).attr("stroke", "#fff").attr("stroke-width", 1.35);
    }

    function renderAqi(state) {
      lastState = state;
      if (activeDomainAnimation) {
        if (state.aqi_only === true) {
          activeDomainAnimation.aqiMode = "state";
          activeDomainAnimation.aqiState = retainNewestState(activeDomainAnimation.aqiState, state);
          drawAqi(activeDomainAnimation.aqiState);
        } else {
          pendingDomainState = retainNewestState(pendingDomainState, state);
        }
        return;
      }
      const current = ensureFrame(state);
      if (!current) return;
      drawAqi(state);
    }

    function replacePollutantContext(state) {
      lastState = state;
      if (!refs || !state?.range) return;
      cancelDomainAnimation();
      if (refs.tooltip) refs.tooltip.style.opacity = "0";
      frame = null;
      const current = createFrame(state);
      if (!current) return;
      drawAxes(state, true);
      drawObservations(state, true);
      drawAqi(state);
    }

    function animateDomains(state) {
      lastState = state;
      const current = ensureFrame(state);
      if (!current) return;
      if (typeof requestAnimationFrame !== "function") {
        renderAxes(state);
        renderObservations(state);
        renderAqi(state);
        return;
      }
      cancelDomainAnimation();
      const generation = animationGeneration;
      const startX = current.xScale.domain().map(function (value) { return value.getTime(); });
      const endX = [state.range.startMs, state.range.endMs];
      const startY = current.yScale.domain().slice();
      const endY = observationDomain(state);
      const xUnchanged = startX.every(function (value, index) { return value === endX[index]; });
      const yUnchanged = startY.every(function (value, index) { return value === endY[index]; });
      if (!startX.every(Number.isFinite) || (xUnchanged && yUnchanged)) {
        current.xScale.domain([state.range.startDate, state.range.endDate]);
        current.yScale.domain(endY);
        drawAxes(state, false);
        drawObservations(state, true);
        drawAqi(state);
        return;
      }
      const startedAt = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
      const durationMs = Math.max(1, Number(options.domainAnimationMs) || 240);
      current.symbols.style("opacity", 0);
      const animation = {
        generation,
        state,
        aqiMode: "state",
        aqiState: state,
        endX,
        endY,
      };
      activeDomainAnimation = animation;
      const step = function (nowValue) {
        if (generation !== animationGeneration || activeDomainAnimation !== animation || !frame) return;
        const now = Number.isFinite(nowValue) ? nowValue : Date.now();
        const raw = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
        const eased = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw;
        current.xScale.domain([
          new Date(startX[0] + (endX[0] - startX[0]) * eased),
          new Date(startX[1] + (endX[1] - startX[1]) * eased),
        ]);
        current.yScale.domain([
          startY[0] + (endY[0] - startY[0]) * eased,
          startY[1] + (endY[1] - startY[1]) * eased,
        ]);
        drawAxes(state, false);
        drawObservations(state, false);
        if (animation.aqiMode === "state") drawAqi(animation.aqiState || state);
        if (raw < 1) {
          animationFrameId = requestAnimationFrame(step);
        } else {
          animationFrameId = null;
          activeDomainAnimation = null;
          current.xScale.domain([state.range.startDate, state.range.endDate]);
          current.yScale.domain(endY);
          const pending = pendingDomainState;
          pendingDomainState = null;
          if (pending) {
            lastState = pending;
            current.xScale.domain([pending.range.startDate, pending.range.endDate]);
            current.yScale.domain(observationDomain(pending));
            drawAxes(pending, false);
            drawObservations(pending, true);
            if (animation.aqiMode === "state") {
              drawAqi(retainNewestState(pending, animation.aqiState));
            }
          } else {
            drawAxes(state, false);
            drawObservations(state, true);
            if (animation.aqiMode === "state") drawAqi(animation.aqiState || state);
          }
        }
      };
      animationFrameId = requestAnimationFrame(step);
    }

    function updateProgress(settled, total) {
      const totalCount = Math.max(0, Math.floor(Number(total) || 0));
      if (!totalCount || !frame || !refs?.svgEl) {
        if (!totalCount) clearProgress();
        return;
      }
      if (!progressBar) {
        progressBar = ChartCore.renderProgressBar(refs.svgEl, {
          margin: frame.margin,
          width: frame.width,
          height: frame.height,
        });
      }
      progressBar.update(Math.max(0, Number(settled) || 0) / totalCount);
    }

    function clearProgress() {
      progressBar?.remove?.();
      progressBar = null;
    }

    function clearAqi() {
      if (activeDomainAnimation) activeDomainAnimation.aqiMode = "cleared";
      frame?.aqi?.selectAll("*").remove();
    }

    function renderAqiUnavailable() {
      if (!frame) return;
      if (activeDomainAnimation) activeDomainAnimation.aqiMode = "unavailable";
      frame.aqi.selectAll("*").remove();
      frame.aqi.append("text").attr("class", "aqi-band-label aqi-band-unavailable")
        .attr("x", frame.margin.left).attr("y", 28).text("AQI unavailable for this range");
    }

    function renderEmpty(message) {
      if (!frame && refs && lastState?.range) createFrame(lastState);
      if (!frame) return;
      frame.empty.selectAll("*").remove();
      frame.empty.append("text").attr("x", (frame.margin.left + frame.width - frame.margin.right) / 2)
        .attr("y", (frame.margin.top + frame.height - frame.margin.bottom) / 2)
        .attr("text-anchor", "middle").attr("fill", "rgba(20, 34, 37, 0.65)")
        .style("font-size", "1rem").style("font-weight", 700).text(String(message || ""));
    }

    function renderError(error) {
      renderEmpty(options.errorMessage || error?.message || "Chart data could not be loaded.");
    }

    function installTooltip() {
      if (!frame?.overlay || !refs?.tooltip) return;
      frame.overlay.on("mousemove", function (event) {
        if (!lastState?.observations) return;
        const [mouseX, mouseY] = d3.pointer(event);
        const targetDate = frame.xScale.invert(mouseX);
        let closest = null;
        lastState.selection.forEach(function (entry, index) {
          (lastState.observations.get(entry.station_id) || []).forEach(function (point) {
            const dx = Math.abs(point.date.getTime() - targetDate.getTime());
            if (!closest || dx < closest.dx) closest = { entry, point, index, dx };
          });
        });
        if (!closest) return;
        refs.tooltip.innerHTML = `<strong>${String(closest.entry.station_name || closest.entry.stationName || closest.entry.name || "Sensor")}</strong><br>${formatTime(closest.point.date)}<br>${Number(closest.point.value).toFixed(1)} ${String(closest.entry.units || closest.entry.unit || "µg/m³")}`;
        refs.tooltip.style.opacity = "1";
        refs.tooltip.style.left = `${Math.min(frame.width - 180, Math.max(8, mouseX + 12))}px`;
        refs.tooltip.style.top = `${Math.max(8, mouseY - 18)}px`;
      }).on("mouseleave", function () {
        refs.tooltip.style.opacity = "0";
      });
    }

    function setLoading(value) {
      refs?.wrap?.classList?.toggle("is-loading", Boolean(value));
      if (lastState) lastState = { ...lastState, loading: Boolean(value) };
    }

    function resize(value = {}, state = lastState) {
      if (!refs || !state?.range) return;
      cancelDomainAnimation();
      const size = dimensions(value);
      if (!frame) {
        createFrame(state, size);
      } else if (frame.width !== size.width || frame.height !== size.height) {
        frame = null;
        createFrame(state, size);
      }
      renderAxes(state);
      renderObservations(state);
      renderAqi(state);
    }

    function destroy() {
      cancelDomainAnimation();
      resizeObserver?.disconnect?.();
      resizeObserver = null;
      refs?.svg?.selectAll("*").remove();
      if (refs?.tooltip) refs.tooltip.style.opacity = "0";
      refs = null;
      frame = null;
      lastState = null;
      progressBar = null;
    }

    return Object.freeze({
      initialise,
      invalidatePollutantContext,
      replacePollutantContext,
      renderObservations,
      renderAqi,
      clearAqi,
      renderAxes,
      renderEmpty,
      renderError,
      renderAqiUnavailable,
      animateDomains,
      updateProgress,
      clearProgress,
      setLoading,
      resize,
      destroy,
      get frame() { return frame; },
    });
  }

  return { createStationChartRenderer, DAQI_COLORS, EAQI_COLORS };
});
