from pathlib import Path

path = Path("hex_map/index.html")
text = path.read_text(encoding="utf-8")

if "function resizeChartFrame(dom, width, height)" in text:
    raise SystemExit("resizeChartFrame already exists; refusing to apply the one-off patch twice")

replacements = [
    (
        "  function ensureChartFrame(dom, frame) {",
        '''  function resizeChartFrame(dom, width, height) {
    const cf = dom?.chartFrame;
    if (!cf || !dom?.svg?.node()) return false;

    const nextWidth = Number.isFinite(Number(width)) && Number(width) > 0
      ? Number(width)
      : cf.width;
    const nextHeight = Math.max(
      Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : cf.height,
      300,
    );
    if (cf.width === nextWidth && cf.height === nextHeight) return false;

    const marginTop = Math.max(52, Math.round(nextHeight * 0.12));
    const margin = { top: marginTop, right: 24, bottom: 44, left: 72 };
    const rangeMs = Math.max(1, Number(cf.frame?.endMs) - Number(cf.frame?.startMs));

    cf.width = nextWidth;
    cf.height = nextHeight;
    cf.margin = margin;
    cf.frame.width = nextWidth;
    cf.frame.height = nextHeight;
    cf.frame.margin = margin;

    dom.svg.attr("viewBox", `0 0 ${nextWidth} ${nextHeight}`);
    dom.svg.select(`#${cf.clipPathId} rect`)
      .attr("x", margin.left)
      .attr("y", 0)
      .attr("width", Math.max(0, nextWidth - margin.left - margin.right))
      .attr("height", Math.max(0, nextHeight - margin.bottom));

    cf.xScale.range([margin.left, nextWidth - margin.right]);
    cf.yScale.range([nextHeight - margin.bottom, margin.top]);
    cf.xAxisGroup
      .attr("transform", `translate(0, ${nextHeight - margin.bottom})`)
      .call(buildChartXAxis(cf.xScale, rangeMs));
    cf.yAxisGroup
      .attr("transform", `translate(${margin.left}, 0)`)
      .call(d3.axisLeft(cf.yScale).ticks(5).tickSizeOuter(0));

    const yLabelX = Math.max(12, margin.left - 44);
    const yLabelY = (margin.top + (nextHeight - margin.bottom)) / 2;
    cf.yAxisLabelEl
      ?.attr("x", yLabelX)
      .attr("y", yLabelY)
      .attr("transform", `rotate(-90, ${yLabelX}, ${yLabelY})`);

    cf.overlay
      ?.attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", Math.max(0, nextWidth - margin.left - margin.right))
      .attr("height", Math.max(0, nextHeight - margin.top - margin.bottom));
    cf.guidelineEl
      ?.attr("x1", margin.left)
      .attr("x2", nextWidth - margin.right);
    cf.dot?.style("opacity", 0);

    // AQI bands are a separate background layer, so resize only that layer here.
    // Observation paths and symbols remain attached and are updated in place by
    // the next updateChart call.
    syncAqiBands(cf, {
      aqiCacheKey: cf.currentAqiKey,
      aqiLoading: cf.currentAqiLoading,
      aqiSourceSymbolIndex: cf.currentAqiSourceSymbolIndex,
    });
    return true;
  }

  function ensureChartFrame(dom, frame) {''',
    ),
    (
        '''      // Check whether the existing frame can be reused.
      const svgWidth = svgEl.clientWidth || 960;
      const svgHeight = svgEl.clientHeight || 390;
      const cf = dom.chartFrame;
      const frameValid = !!(cf
        && cf.areaCode === state.chartModeAreaCode
        && cf.sessionIdentity === state.chartModeSessionIdentity
        && cf.mapKey === state.mapKey
        && cf.width === svgWidth
        && cf.height === svgHeight);''',
        '''      // Reuse the chart frame whenever its area/session identity is unchanged.
      // Sensor chips can wrap onto another row and change the SVG's available
      // height. That is a layout resize, not a reason to clear every series.
      const svgWidth = svgEl.clientWidth || 960;
      const svgHeight = Math.max(svgEl.clientHeight || 0, 300);
      const cf = dom.chartFrame;
      const frameIdentityValid = !!(cf
        && cf.areaCode === state.chartModeAreaCode
        && cf.sessionIdentity === state.chartModeSessionIdentity
        && cf.mapKey === state.mapKey);
      const frameSizeChanged = !!(frameIdentityValid
        && (cf.width !== svgWidth || cf.height !== svgHeight));
      const frameValid = frameIdentityValid;
      if (frameSizeChanged) resizeChartFrame(dom, svgWidth, svgHeight);''',
    ),
    (
        '''      const svg = dom.svg.node();
      const existing = dom.chartFrame;
      const frameValid = Boolean(existing && existing.areaCode === state.chartModeAreaCode && existing.sessionIdentity === state.chartModeSessionIdentity && existing.mapKey === state.mapKey && existing.width === (svg.clientWidth || 960) && existing.height === (svg.clientHeight || 390));
      const windowValue = normalizeChartRangeValue(state.chartModeTimeRange);''',
        '''      const svg = dom.svg.node();
      const existing = dom.chartFrame;
      const svgWidth = svg.clientWidth || 960;
      const svgHeight = Math.max(svg.clientHeight || 0, 300);
      const frameIdentityValid = Boolean(existing
        && existing.areaCode === state.chartModeAreaCode
        && existing.sessionIdentity === state.chartModeSessionIdentity
        && existing.mapKey === state.mapKey);
      const frameSizeChanged = Boolean(frameIdentityValid
        && (existing.width !== svgWidth || existing.height !== svgHeight));
      const frameValid = frameIdentityValid;
      const windowValue = normalizeChartRangeValue(state.chartModeTimeRange);''',
    ),
    (
        '''      recordWebsiteDebugEvent("station_history_load_started", {
        route: "chart",
        loader: "station_history",
        selected_series_count: entries.length,
      });
      if (!frameValid) initChartFrame(dom, range, MAX_SELECTED_SENSORS);''',
        '''      recordWebsiteDebugEvent("station_history_load_started", {
        route: "chart",
        loader: "station_history",
        selected_series_count: entries.length,
      });
      if (frameSizeChanged) resizeChartFrame(dom, svgWidth, svgHeight);
      if (!frameValid) initChartFrame(dom, range, MAX_SELECTED_SENSORS);''',
    ),
    (
        '''          selectionDiff,
          selectionChangeOnly: true,
          changedStationIds,
          skipAqiRepaint: !aqiSourceChanged,''',
        '''          selectionDiff,
          selectionChangeOnly: true,
          changedStationIds,
          layoutChanged: frameSizeChanged,
          skipAqiRepaint: !aqiSourceChanged,''',
    ),
    (
        '''    const updateStationIds = (xChanged || yChanged || renderOptions.selectionChangeOnly !== true || !explicitlyChanged)
      ? allStationIds
      : new Set(Array.from(explicitlyChanged).filter((stationId) => allStationIds.has(stationId)));''',
        '''    const updateStationIds = (renderOptions.layoutChanged === true
      || xChanged
      || yChanged
      || renderOptions.selectionChangeOnly !== true
      || !explicitlyChanged)
      ? allStationIds
      : new Set(Array.from(explicitlyChanged).filter((stationId) => allStationIds.has(stationId)));''',
    ),
    (
        '''        incremental: renderOptions.selectionChangeOnly === true,
        changed_station_ids: Array.from(updateStationIds),
        x_changed: xChanged,''',
        '''        incremental: renderOptions.selectionChangeOnly === true,
        changed_station_ids: Array.from(updateStationIds),
        layout_changed: renderOptions.layoutChanged === true,
        x_changed: xChanged,''',
    ),
]

for index, (old, new) in enumerate(replacements, start=1):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"replacement {index} expected one match, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("Applied final Hex Map chart resize patch")
