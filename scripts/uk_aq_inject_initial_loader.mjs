#!/usr/bin/env node
// Inject the shared first-paint loading overlay into every active HTML entry point.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const nodeProcess = globalThis.process;
const STAGING_DIRECTORY_NAME = ".pages-site";
const ARCHIVE_DIRECTORY_NAME = "Archive";
const LOADER_IMAGE_PATH = "images/UKAQ-Loading-O.svg";
const INJECT_MARKER = "data-ukaq-initial-loader";
const HASH_LENGTH = 12;

async function main() {
  const args = nodeProcess.argv.slice(2);
  if (args.length !== 1 || !String(args[0] || "").trim()) {
    throw new Error(`Usage: node scripts/uk_aq_inject_initial_loader.mjs <path>/${STAGING_DIRECTORY_NAME}`);
  }

  const targetRoot = path.resolve(nodeProcess.cwd(), args[0]);
  await validateTargetRoot(targetRoot);

  const loaderBytes = await fs.readFile(path.join(targetRoot, LOADER_IMAGE_PATH));
  const loaderHash = crypto.createHash("sha256").update(loaderBytes).digest("hex").slice(0, HASH_LENGTH);
  const loaderUrl = `/${LOADER_IMAGE_PATH}?v=${loaderHash}`;
  const htmlPaths = await collectActiveHtmlPaths(targetRoot);

  let injectedCount = 0;
  for (const htmlPath of htmlPaths) {
    const absolutePath = path.join(targetRoot, htmlPath);
    const html = await fs.readFile(absolutePath, "utf8");
    if (html.includes(INJECT_MARKER)) {
      throw new Error(`Initial loader marker already present in active document: ${htmlPath}`);
    }

    const headCloseCount = (html.match(/<\/head\s*>/gi) || []).length;
    const bodyOpenMatches = [...html.matchAll(/<body\b[^>]*>/gi)];
    if (headCloseCount !== 1 || bodyOpenMatches.length !== 1) {
      throw new Error(
        `Expected exactly one </head> and one <body> in ${htmlPath}; found head=${headCloseCount} body=${bodyOpenMatches.length}`,
      );
    }

    const expectsSidebar = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*sidebar\.js(?:\?[^"']*)?["'][^>]*>/i.test(html);
    const headBlock = buildHeadBlock({ expectsSidebar, loaderUrl });
    const bodyBlock = buildBodyBlock(loaderUrl);

    let updated = html.replace(/<\/head\s*>/i, `${headBlock}\n</head>`);
    const bodyIndex = updated.search(/<body\b[^>]*>/i);
    if (bodyIndex < 0) throw new Error(`Body marker disappeared while injecting ${htmlPath}`);
    const bodyTag = updated.match(/<body\b[^>]*>/i)?.[0];
    if (!bodyTag) throw new Error(`Unable to resolve body tag while injecting ${htmlPath}`);
    const insertAt = bodyIndex + bodyTag.length;
    updated = `${updated.slice(0, insertAt)}\n${bodyBlock}${updated.slice(insertAt)}`;

    await fs.writeFile(absolutePath, updated, "utf8");
    injectedCount += 1;
  }

  console.log(`Injected UK AQ initial loader into ${injectedCount} active HTML files.`);
}

async function validateTargetRoot(targetRoot) {
  if (path.basename(targetRoot) !== STAGING_DIRECTORY_NAME) {
    throw new Error(`Unsafe target: staging directory must be named ${STAGING_DIRECTORY_NAME}`);
  }
  const stat = await fs.lstat(targetRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe target: staging target must be a real directory: ${targetRoot}`);
  }
  const loaderStat = await fs.lstat(path.join(targetRoot, LOADER_IMAGE_PATH));
  if (!loaderStat.isFile() || loaderStat.isSymbolicLink()) {
    throw new Error(`Loader image must be a real file: ${LOADER_IMAGE_PATH}`);
  }
}

async function collectActiveHtmlPaths(targetRoot) {
  const results = [];

  async function visit(relativeDirectory) {
    const absoluteDirectory = path.join(targetRoot, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join("/"), entry.name);
      if (!relativeDirectory && entry.name === ARCHIVE_DIRECTORY_NAME) continue;
      if (entry.isSymbolicLink()) {
        throw new Error(`Unsupported symbolic link in active staging tree: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(path.join(relativeDirectory, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        results.push(relativePath);
      }
    }
  }

  await visit("");
  return results.sort();
}

function buildHeadBlock({ expectsSidebar, loaderUrl }) {
  return `  <style ${INJECT_MARKER}>
    html.ukaq-initial-loading { background: #FBFAF7; }
    #ukaq-initial-loader {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: none;
      place-items: center;
      box-sizing: border-box;
      background: #FBFAF7;
      opacity: 1;
      pointer-events: auto;
      transition: opacity 180ms ease;
    }
    html.ukaq-initial-loading #ukaq-initial-loader { display: grid; }
    #ukaq-initial-loader img {
      display: block;
      width: clamp(112px, 18vw, 180px);
      height: auto;
      animation: ukaqInitialLoaderSpin 1s linear infinite;
      transform-origin: 50% 50%;
    }
    html.ukaq-who-bars-waiting .who-bar-fill {
      width: 0 !important;
      transition: none !important;
    }
    @keyframes ukaqInitialLoaderSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      #ukaq-initial-loader { transition: none; }
      #ukaq-initial-loader img { animation: none; }
    }
  </style>
  <script ${INJECT_MARKER}>
    (() => {
      const SESSION_KEY = "uk_aq_initial_visual_loaded_v1";
      const EXPECTS_SIDEBAR = ${expectsSidebar ? "true" : "false"};
      const navigation = performance.getEntriesByType?.("navigation")?.[0];
      const navigationType = navigation?.type || "navigate";
      let seenInTab = false;
      try { seenInTab = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (_) {}
      const active = navigationType === "reload" || !seenInTab;
      window.__UKAQ_INITIAL_LOAD_ACTIVE__ = active;

      if (active) document.documentElement.classList.add("ukaq-initial-loading");
      document.documentElement.classList.add("ukaq-who-bars-waiting");

      let windowLoaded = document.readyState === "complete";
      let sidebarReady = !EXPECTS_SIDEBAR;
      let revealed = false;
      let fallbackTimer = 0;

      const dispatchRevealed = () => {
        if (window.__UKAQ_INITIAL_VISUAL_REVEALED__) return;
        window.__UKAQ_INITIAL_VISUAL_REVEALED__ = true;
        window.dispatchEvent(new CustomEvent("ukaq:initial-visual-revealed"));
      };

      const prepareWhoBars = () => Array.from(document.querySelectorAll("[data-who-bar-fill]"))
        .map((fill) => {
          const target = String(fill.style.getPropertyValue("--pct") || "").trim();
          if (!target) return null;
          fill.style.transition = "none";
          fill.style.width = "0%";
          return { fill, target };
        })
        .filter(Boolean);

      const animateWhoBars = (bars) => {
        if (!bars.length) return;
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduced) {
          bars.forEach(({ fill }) => {
            fill.style.removeProperty("width");
            fill.style.removeProperty("transition");
          });
          return;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          bars.forEach(({ fill, target }) => {
            fill.style.transition = "width 850ms cubic-bezier(0.22, 1, 0.36, 1)";
            fill.style.width = target;
          });
          window.setTimeout(() => {
            bars.forEach(({ fill }) => {
              fill.style.removeProperty("width");
              fill.style.removeProperty("transition");
            });
          }, 950);
        }));
      };

      const revealVisualPage = (loader, bars) => {
        document.documentElement.classList.remove("ukaq-initial-loading", "ukaq-who-bars-waiting");
        loader?.remove();
        dispatchRevealed();
        animateWhoBars(bars);
      };

      const reveal = () => {
        if (revealed) return;
        revealed = true;
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (_) {}

        const loader = document.getElementById("ukaq-initial-loader");
        const bars = prepareWhoBars();
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        if (!active) {
          requestAnimationFrame(() => requestAnimationFrame(() => revealVisualPage(loader, bars)));
          return;
        }

        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          revealVisualPage(loader, bars);
        };

        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!loader || reduced) {
            finish();
            return;
          }
          const onEnd = (event) => {
            if (event.target === loader && event.propertyName === "opacity") finish();
          };
          loader.addEventListener("transitionend", onEnd, { once: true });
          loader.style.opacity = "0";
          window.setTimeout(finish, 350);
        }));
      };

      const maybeReveal = () => {
        if (!windowLoaded || !sidebarReady) return;
        reveal();
      };

      window.addEventListener("load", () => {
        windowLoaded = true;
        maybeReveal();
        if (!revealed) {
          fallbackTimer = window.setTimeout(reveal, 1500);
        }
      }, { once: true });

      window.addEventListener("ukaq:sidebar-ready", () => {
        sidebarReady = true;
        maybeReveal();
      }, { once: true });

      if (windowLoaded) {
        maybeReveal();
        if (!revealed) fallbackTimer = window.setTimeout(reveal, 1500);
      }
    })();
  </script>
  <link rel="preload" as="image" href="${loaderUrl}" ${INJECT_MARKER}>`;
}

function buildBodyBlock(loaderUrl) {
  return `  <div id="ukaq-initial-loader" ${INJECT_MARKER} aria-hidden="true">
    <img src="${loaderUrl}" alt="">
  </div>`;
}

main().catch((error) => {
  console.error(error?.stack || error);
  nodeProcess.exitCode = 1;
});
