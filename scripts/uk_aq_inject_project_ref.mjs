#!/usr/bin/env node
// @ts-nocheck: Node ESM helper script; local editor TypeScript defaults conflict with this runtime file.

// @ts-ignore Node built-in module types may be unavailable in this repo.
import fs from "node:fs/promises";
// @ts-ignore Node built-in module types may be unavailable in this repo.
import path from "node:path";

/**
 * Node process shim for JS type-checking when Node typings are not installed.
 * @type {{
 *   env: Record<string, string | undefined>,
 *   argv: string[],
 *   exit: (code?: number) => never,
 *   cwd: () => string
 * }}
 */
const nodeProcess = /** @type {any} */ (globalThis.process);

const scriptEntryPath = nodeProcess.argv[1]
  ? path.resolve(nodeProcess.argv[1])
  : path.join(nodeProcess.cwd(), "scripts", "uk_aq_inject_project_ref.mjs");
const SCRIPT_DIR = path.dirname(scriptEntryPath);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const DEFAULT_TARGETS = [
  { path: "hex_map/index.html", required: true },
  { path: "index.html", required: true },
  { path: "sensors/index.html", required: true },
  { path: "sensor_map/index.html", required: true },
];
const refPattern = /const PROJECT_REF_PLACEHOLDER = "([^"]*)";/g;
const anonPattern = /const ANON_KEY_PLACEHOLDER = "([^"]*)";/g;
const turnstilePattern = /const TURNSTILE_SITE_KEY_PLACEHOLDER = "([^"]*)";/g;
const aqiHistoryPattern = /const AQI_HISTORY_BASE_PLACEHOLDER = "([^"]*)";/g;
const websiteDebugLogPattern = /const WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER = "([^"]*)";/g;
const aqiMutableHoursPattern = /const AQI_MUTABLE_HOURS_PLACEHOLDER = "([^"]*)";/g;

async function main() {
  const envText = await readFileIfExists(ENV_PATH);
  if (envText) {
    loadEnvFromText(envText);
  }

  const projectRef = (nodeProcess.env.SUPABASE_PROJECT_REF || "").trim();
  const publishableKey = (nodeProcess.env.SB_PUBLISHABLE_DEFAULT_KEY || "").trim();
  const turnstileSiteKey = (nodeProcess.env.UK_AQ_TURNSTILE_SITE_KEY || "").trim();
  const aqiHistoryBaseUrl = (nodeProcess.env.UK_AQ_AQI_HISTORY_BASE_URL || "__UK_AQ_AQI_HISTORY_BASE_URL__").trim();
  const websiteDebugLogEnabled = (nodeProcess.env.UK_AQ_WEBSITE_DEBUG_LOG_ENABLED || "false").trim();
  // UK_AQ_AQI_MUTABLE_HOURS: backend mutable horizon in hours (default 120, range 1–720).
  // Passed through as a raw string; resolveAqiMutableHours() in the page validates it and falls back to 120 when invalid.
  const aqiMutableHours = (nodeProcess.env.UK_AQ_AQI_MUTABLE_HOURS || "__UK_AQ_AQI_MUTABLE_HOURS__").trim();

  if (!projectRef) {
    console.error("SUPABASE_PROJECT_REF is missing. Set it in .env or the environment.");
    nodeProcess.exit(1);
  }
  if (!publishableKey) {
    console.error("Publishable key is missing. Set SB_PUBLISHABLE_DEFAULT_KEY in .env or the environment.");
    nodeProcess.exit(1);
  }
  if (!turnstileSiteKey) {
    console.error("Turnstile site key is missing. Set UK_AQ_TURNSTILE_SITE_KEY in .env or the environment.");
    nodeProcess.exit(1);
  }

  const cliTargets = nodeProcess.argv.slice(2).filter(Boolean);
  const targets = (cliTargets.length ? cliTargets : DEFAULT_TARGETS)
    .map((target) => (typeof target === "string"
      ? { path: target, required: true }
      : target));

  for (const target of targets) {
    if (path.isAbsolute(target.path)) {
      throw new Error(`Target path must be relative to the repository: ${target.path}`);
    }
    const targetPath = path.join(REPO_ROOT, target.path);
    const html = await readFileIfExists(targetPath);
    if (html === null) {
      if (!target.required) {
        console.log(`Skipping ${target.path} (file not present).`);
        continue;
      }
      throw new Error(`Required file missing: ${target.path}`);
    }
    let updated = html;
    updated = replacePlaceholder(
      updated,
      refPattern,
      `const PROJECT_REF_PLACEHOLDER = "${projectRef}";`,
      "PROJECT_REF_PLACEHOLDER",
      targetPath,
    );
    updated = replacePlaceholder(
      updated,
      anonPattern,
      `const ANON_KEY_PLACEHOLDER = "${publishableKey}";`,
      "ANON_KEY_PLACEHOLDER",
      targetPath,
    );
    updated = replacePlaceholder(
      updated,
      turnstilePattern,
      `const TURNSTILE_SITE_KEY_PLACEHOLDER = "${turnstileSiteKey}";`,
      "TURNSTILE_SITE_KEY_PLACEHOLDER",
      targetPath,
    );
    updated = replacePlaceholder(
      updated,
      aqiHistoryPattern,
      `const AQI_HISTORY_BASE_PLACEHOLDER = "${aqiHistoryBaseUrl}";`,
      "AQI_HISTORY_BASE_PLACEHOLDER",
      targetPath,
      { required: false },
    );
    updated = replacePlaceholder(
      updated,
      websiteDebugLogPattern,
      `const WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER = "${websiteDebugLogEnabled}";`,
      "WEBSITE_DEBUG_LOG_ENABLED_PLACEHOLDER",
      targetPath,
      { required: false },
    );
    updated = replacePlaceholder(
      updated,
      aqiMutableHoursPattern,
      `const AQI_MUTABLE_HOURS_PLACEHOLDER = "${aqiMutableHours}";`,
      "AQI_MUTABLE_HOURS_PLACEHOLDER",
      targetPath,
      { required: false },
    );

    if (updated !== html) {
      await fs.writeFile(targetPath, updated);
      console.log(`Injected SUPABASE_PROJECT_REF, publishable key, Turnstile site key, AQI history base, website debug flag, and AQI mutable hours into ${path.relative(REPO_ROOT, targetPath)}`);
    } else {
      console.log(`${path.relative(REPO_ROOT, targetPath)} already uses the configured SUPABASE project ref, publishable key, Turnstile site key, AQI history base, website debug flag, and AQI mutable hours.`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  nodeProcess.exit(1);
});

/**
 * @param {string} text
 * @param {RegExp} pattern
 * @param {string} replacement
 * @param {string} label
 * @param {string} targetPath
 * @param {{ required?: boolean }} [options]
 * @returns {string}
 */
function replacePlaceholder(text, pattern, replacement, label, targetPath, options = {}) {
  const required = options.required !== false;
  const matches = text.match(pattern);
  if (!matches) {
    if (!required) {
      console.warn(`Skipping ${label} in ${path.relative(REPO_ROOT, targetPath)} (placeholder not present).`);
      return text;
    }
    console.error(`Could not find ${label} in ${path.relative(REPO_ROOT, targetPath)}`);
    nodeProcess.exit(1);
  }
  return text.replace(pattern, replacement);
}

/**
 * @param {string} text
 * @returns {void}
 */
function loadEnvFromText(text) {
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      return;
    }
    if ((value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(nodeProcess.env, key)) {
      nodeProcess.env[key] = value;
    }
  });
}

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
