// Hex Map-owned presentation for the UK and CR top summary cards.
(function (root) {
  "use strict";

  function formatTimestamp(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  function updateSummary(data, idPrefix) {
    const prefix = idPrefix || "top";
    const element = (name) => root.document.getElementById(`${prefix}-${name}`);

    const sensorsElement = element("total-sensors");
    if (sensorsElement) {
      sensorsElement.textContent = Number.isFinite(data.totalSensors)
        ? data.totalSensors.toLocaleString()
        : "—";
    }

    const coveragePercent = element("coverage-percent");
    const coverageDetail = element("coverage-detail");
    const coverageBar = element("coverage-bar");
    const coverageFill = element("coverage-fill");
    if (coveragePercent && coverageDetail) {
      const covered = data.pconCovered ?? 0;
      const total = data.pconTotal ?? 0;
      const ratio = total ? covered / total : 0;
      const percent = total ? Math.round(ratio * 100) : 0;
      coveragePercent.textContent = total ? `${percent}%` : "—";
      const label = data.areaLabel || "constituencies";
      coverageDetail.textContent = total
        ? `${covered.toLocaleString()} / ${total.toLocaleString()} ${label}`
        : "—";
      if (coverageFill) {
        const safePercent = total ? Math.max(0, Math.min(100, ratio * 100)) : 0;
        coverageFill.style.width = `${safePercent}%`;
      }
      if (coverageBar) {
        coverageBar.setAttribute("aria-valuenow", String(percent));
        coverageBar.setAttribute(
          "aria-valuetext",
          total ? `${percent}% coverage (${covered} of ${total})` : "No coverage data",
        );
      }
    }

    const highestLabel = element("highest-label");
    const highestHex = element("highest-hex");
    const highestValue = element("highest-value");
    const highestSensor = element("highest-sensor");
    const highestNetwork = element("highest-network");
    if (highestLabel) {
      highestLabel.textContent = `Highest ${data.pollutantLabel || "PM2.5"}`;
    }
    if (highestValue) {
      highestValue.textContent = Number.isFinite(data.highestValue)
        ? `${data.highestValue.toFixed(1)} ${data.pollutantUnits || ""}`
        : "—";
    }
    if (highestHex) {
      highestHex.style.background = data.highestColor || "";
    }
    if (highestSensor) {
      highestSensor.textContent = data.highestSensor || "—";
    }
    if (highestNetwork) {
      highestNetwork.textContent = data.highestNetwork || "—";
    }

    const latestElement = element("latest-update");
    const oldestElement = element("oldest-update");
    if (latestElement) latestElement.textContent = formatTimestamp(data.newestReadingISO);
    if (oldestElement) oldestElement.textContent = formatTimestamp(data.oldestReadingISO);
  }

  root.UkAqHexMapSummary = Object.freeze({ updateSummary });
})(typeof globalThis !== "undefined" ? globalThis : this);
