(function initHomepageNetworkTableLayout() {
  "use strict";

  if (!document.body.classList.contains("home-page")) return;
  const table = document.querySelector(".dashboard-table--networks");
  const wrapper = table?.closest(".dashboard-table-wrap");
  if (!table || !wrapper) return;

  let frame = null;
  let observer = null;

  function observeBody() {
    observer?.observe(table.tBodies[0] || table, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function originalNetworkLabel(heading) {
    let original = heading.dataset.networkSummaryLabel;
    if (!original) {
      original = heading.getAttribute("aria-label") || heading.textContent.trim();
      heading.dataset.networkSummaryLabel = original;
    }
    return original;
  }

  function maySplitNetworkLabel(label) {
    return label.includes(".") && !/(^|\s)GOV\.UK(?:\s|$)/i.test(label);
  }

  function setNetworkNameSplit(enabled) {
    table.querySelectorAll('tbody tr:not([data-network="total"]) th[scope="row"]')
      .forEach((heading) => {
        const original = originalNetworkLabel(heading);
        const shouldSplit = enabled && maySplitNetworkLabel(original);
        const state = shouldSplit ? "true" : "false";
        if (heading.dataset.networkSummarySplit === state) return;

        if (shouldSplit) {
          const parts = original.split(".").map((part) => part.trim()).filter(Boolean);
          const nodes = [];
          parts.forEach((part, index) => {
            if (index > 0) nodes.push(document.createElement("br"));
            nodes.push(document.createTextNode(part));
          });
          heading.replaceChildren(...nodes);
        } else {
          heading.textContent = original;
        }

        heading.classList.toggle("network-summary-label-split", shouldSplit);
        if (original.includes(".")) heading.setAttribute("aria-label", original);
        heading.dataset.networkSummarySplit = state;
      });
  }

  function tableOverflows() {
    const requiredWidth = Math.max(table.offsetWidth, table.scrollWidth);
    return requiredWidth > wrapper.clientWidth + 1;
  }

  function syncLayout() {
    frame = null;
    observer?.disconnect();
    try {
      table.classList.remove("is-network-updated-hidden", "is-network-name-wrap");
      setNetworkNameSplit(false);
      table.getBoundingClientRect();
      if (!tableOverflows()) return;

      table.classList.add("is-network-updated-hidden");
      table.getBoundingClientRect();
      if (!tableOverflows()) return;

      table.classList.add("is-network-name-wrap");
      table.getBoundingClientRect();
      if (!tableOverflows()) return;

      setNetworkNameSplit(true);
      table.getBoundingClientRect();
    } finally {
      observeBody();
    }
  }

  function scheduleLayout() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(syncLayout);
  }

  observer = new MutationObserver(scheduleLayout);
  observeBody();

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(scheduleLayout);
    resizeObserver.observe(wrapper);
  } else {
    window.addEventListener("resize", scheduleLayout, { passive: true });
  }

  document.fonts?.ready?.then(scheduleLayout);
  scheduleLayout();
})();
