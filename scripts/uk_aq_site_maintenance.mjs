import fs from "node:fs";
import path from "node:path";

const STATUS_FILE = "uk-aq-site-mode.json";
const MAINTENANCE_MARKER = '<meta name="uk-aq-site-maintenance" content="on">';
const MAINTENANCE_IMAGE = "images/UK-AQ-Maintenance-NoDate.png";
const NORMAL_PATHS = Object.freeze([
  "/",
  "/hex_map/",
  "/about/",
  "/dev-blog/",
  "/resources/",
  "/sensor_map/",
  "/sensors/",
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/uk_aq_site_maintenance.mjs build --mode on|off --source-root <path> --output-root <path> --deployment-id <id> --artifact-built-at <ISO UTC>",
    "  node scripts/uk_aq_site_maintenance.mjs resolve --base-url <url>",
    "  node scripts/uk_aq_site_maintenance.mjs verify --base-url <url> --expected on|off|auto [--deployment-id <id>] [--minimum-stable-seconds <n>] [--attempts <n>] [--delay-seconds <n>]",
  ].join("\n");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument: ${flag || "<missing>"}\n${usage()}`);
    }
    args[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return args;
}

function required(args, name) {
  const value = String(args[name] || "").trim();
  if (!value) throw new Error(`Missing --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  return value;
}

function positiveInteger(value, name, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return number;
}

function normalizeMode(value, { allowAuto = false } = {}) {
  const mode = String(value || "").trim().toLowerCase();
  const supported = allowAuto ? new Set(["on", "off", "auto"]) : new Set(["on", "off"]);
  if (!supported.has(mode)) {
    throw new Error(`Unsupported site mode: ${JSON.stringify(value)}`);
  }
  return mode;
}

function exactIsoUtc(value) {
  const text = String(value || "").trim();
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new Error("--artifact-built-at must be an exact ISO UTC timestamp");
  }
  return text;
}

function writeStatus(outputRoot, { mode, deploymentId, artifactBuiltAt }) {
  const payload = {
    schema_version: 1,
    mode,
    deployment_id: deploymentId,
    artifact_built_at_utc: artifactBuiltAt,
  };
  fs.writeFileSync(
    path.join(outputRoot, STATUS_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function build(args) {
  const mode = normalizeMode(required(args, "mode"));
  const sourceRoot = path.resolve(required(args, "sourceRoot"));
  const outputRoot = path.resolve(required(args, "outputRoot"));
  const deploymentId = required(args, "deploymentId");
  const artifactBuiltAt = exactIsoUtc(required(args, "artifactBuiltAt"));

  if (mode === "on") {
    if (fs.existsSync(outputRoot)) {
      throw new Error(`Maintenance output already exists: ${outputRoot}`);
    }
    fs.mkdirSync(outputRoot, { recursive: false });
    const sourcePage = path.join(sourceRoot, "maintenance", "index.html");
    const page = fs.readFileSync(sourcePage, "utf8");
    if (!page.includes(MAINTENANCE_MARKER)) {
      throw new Error("Maintenance source page lacks the required mode marker");
    }
    fs.writeFileSync(path.join(outputRoot, "index.html"), page);
    fs.writeFileSync(path.join(outputRoot, "404.html"), page);
    fs.mkdirSync(path.join(outputRoot, "images"));
    fs.copyFileSync(
      path.join(sourceRoot, MAINTENANCE_IMAGE),
      path.join(outputRoot, MAINTENANCE_IMAGE),
    );
    fs.copyFileSync(path.join(sourceRoot, "CNAME"), path.join(outputRoot, "CNAME"));
    fs.writeFileSync(path.join(outputRoot, ".nojekyll"), "");
  } else {
    for (const relativePath of ["index.html", "hex_map/index.html", "CNAME"]) {
      if (!fs.statSync(path.join(outputRoot, relativePath)).isFile()) {
        throw new Error(`Normal Pages artifact is incomplete: ${relativePath}`);
      }
    }
    const rootPage = fs.readFileSync(path.join(outputRoot, "index.html"), "utf8");
    if (rootPage.includes(MAINTENANCE_MARKER)) {
      throw new Error("Normal Pages artifact contains the maintenance marker");
    }
  }

  writeStatus(outputRoot, { mode, deploymentId, artifactBuiltAt });
  process.stdout.write(`${JSON.stringify({ mode, output_root: outputRoot, deployment_id: deploymentId })}\n`);
}

function requestUrl(baseUrl, relativePath) {
  const url = new URL(relativePath, baseUrl);
  url.searchParams.set("uk_aq_site_mode_check", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return url;
}

async function fetchResponse(baseUrl, relativePath) {
  return fetch(requestUrl(baseUrl, relativePath), {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "cache-control": "no-cache, no-store",
      pragma: "no-cache",
    },
  });
}

function validateStatusPayload(payload) {
  if (
    !payload ||
    payload.schema_version !== 1 ||
    !new Set(["on", "off"]).has(payload.mode) ||
    typeof payload.deployment_id !== "string" ||
    !payload.deployment_id.trim() ||
    typeof payload.artifact_built_at_utc !== "string" ||
    Number.isNaN(Date.parse(payload.artifact_built_at_utc))
  ) {
    throw new Error("Public site-mode status payload is malformed");
  }
  return payload;
}

async function readStatus(baseUrl, { allowLegacyMissing = false } = {}) {
  const response = await fetchResponse(baseUrl, `/${STATUS_FILE}`);
  if (allowLegacyMissing && response.status === 404) {
    return {
      schema_version: 0,
      mode: "off",
      deployment_id: "legacy-normal-site-without-mode-marker",
      artifact_built_at_utc: null,
    };
  }
  if (!response.ok) {
    throw new Error(`Public site-mode status returned HTTP ${response.status}`);
  }
  return validateStatusPayload(await response.json());
}

async function resolve(args) {
  const baseUrl = required(args, "baseUrl");
  const result = await verifyOnce({
    baseUrl,
    expected: "auto",
    deploymentId: "",
  });
  process.stdout.write(`${result.mode}\n`);
}

async function verifyOnce({ baseUrl, expected, deploymentId }) {
  const status = await readStatus(baseUrl, { allowLegacyMissing: expected === "auto" });
  const mode = expected === "auto" ? status.mode : expected;
  if (status.mode !== mode) {
    throw new Error(`Expected maintenance ${mode}, found ${status.mode}`);
  }
  if (deploymentId && status.deployment_id !== deploymentId) {
    throw new Error(
      `Expected deployment ${deploymentId}, found ${status.deployment_id}`,
    );
  }
  const artifactBuiltAtMs = status.artifact_built_at_utc
    ? Date.parse(status.artifact_built_at_utc)
    : null;
  const artifactAgeSeconds = artifactBuiltAtMs === null
    ? null
    : Math.max(0, Math.floor((Date.now() - artifactBuiltAtMs) / 1000));

  const pathEvidence = [];
  for (const relativePath of NORMAL_PATHS) {
    const response = await fetchResponse(baseUrl, relativePath);
    const body = await response.text();
    const hasMaintenanceMarker = body.includes(MAINTENANCE_MARKER);
    if (mode === "on" && !hasMaintenanceMarker) {
      throw new Error(`Maintenance marker is absent from ${relativePath} (HTTP ${response.status})`);
    }
    if (mode === "off" && hasMaintenanceMarker) {
      throw new Error(`Maintenance marker remains on ${relativePath} (HTTP ${response.status})`);
    }
    pathEvidence.push({ path: relativePath, status: response.status, maintenance: hasMaintenanceMarker });
  }

  if (mode === "off") {
    const root = pathEvidence.find((entry) => entry.path === "/");
    const hexMap = pathEvidence.find((entry) => entry.path === "/hex_map/");
    if (root?.status !== 200 || hexMap?.status !== 200) {
      throw new Error("Normal root or Hex Map route is not available");
    }
  }

  return {
    mode,
    deployment_id: status.deployment_id,
    artifact_built_at_utc: status.artifact_built_at_utc,
    artifact_age_seconds: artifactAgeSeconds,
    paths: pathEvidence,
  };
}

async function verify(args) {
  const baseUrl = required(args, "baseUrl");
  const expected = normalizeMode(required(args, "expected"), { allowAuto: true });
  const deploymentId = String(args.deploymentId || "").trim();
  const minimumStableSeconds = positiveInteger(
    args.minimumStableSeconds ?? 0,
    "minimum-stable-seconds",
    { allowZero: true },
  );
  const attempts = positiveInteger(args.attempts ?? 1, "attempts");
  const delaySeconds = positiveInteger(args.delaySeconds ?? 10, "delay-seconds");
  let lastError = null;
  let stableSinceMs = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let modeVerified = false;
    try {
      const result = await verifyOnce({
        baseUrl,
        expected,
        deploymentId,
      });
      modeVerified = true;
      const nowMs = Date.now();
      stableSinceMs ??= nowMs;
      const stableSeconds = Math.floor((nowMs - stableSinceMs) / 1000);
      if (stableSeconds < minimumStableSeconds) {
        throw new Error(
          `Public ${result.mode} deployment has been positively verified for ` +
          `${stableSeconds} seconds; ${minimumStableSeconds} seconds are required ` +
          "for prior browser-cache expiry",
        );
      }
      result.verified_stable_seconds = stableSeconds;
      result.prior_browser_cache_expired = minimumStableSeconds >= 610;
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    } catch (error) {
      lastError = error;
      if (!modeVerified) {
        stableSinceMs = null;
      }
      if (attempt < attempts) {
        process.stderr.write(`Site-mode verification attempt ${attempt}/${attempts} failed: ${error.message}\n`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delaySeconds * 1000));
      }
    }
  }
  throw lastError;
}

const args = parseArgs(process.argv.slice(2));
if (args.command === "build") build(args);
else if (args.command === "resolve") await resolve(args);
else if (args.command === "verify") await verify(args);
else throw new Error(usage());
