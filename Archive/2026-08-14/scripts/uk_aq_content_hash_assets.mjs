#!/usr/bin/env node
// @ts-nocheck: Node ESM helper script; this repository does not install Node typings.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nodeProcess = globalThis.process;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const STAGING_DIRECTORY_NAME = ".pages-site";
const ARCHIVE_DIRECTORY_NAME = "Archive";
const HASH_LENGTH = 12;
const LOCAL_ORIGIN = "https://uk-aq-build.invalid";
const HTML_TAG_PATTERN = /<(script|link)\b[^>]*>/gi;
const SIDEBAR_PATH = "sidebar.js";
const SITE_FOOTER_PATH = "site-footer.css";
const SIDEBAR_FOOTER_PATTERN = /(\blink\.href\s*=\s*`\$\{location\.origin\})(\/site-footer\.css(?:\?[^`#]*)?(?:#[^`]*)?)(`)/g;

async function main() {
  const args = nodeProcess.argv.slice(2);
  if (args.length !== 1 || !String(args[0] || "").trim()) {
    throw new Error(`Usage: node scripts/uk_aq_content_hash_assets.mjs <path>/${STAGING_DIRECTORY_NAME}`);
  }

  const targetRoot = path.resolve(nodeProcess.cwd(), args[0]);
  await validateTargetRoot(targetRoot);

  const htmlPaths = await collectActiveHtmlPaths(targetRoot);
  if (!htmlPaths.includes("index.html")) {
    throw new Error(`Staging root is missing required active document: index.html`);
  }

  const assets = new Map();
  for (const htmlPath of htmlPaths) {
    const html = await readUtf8File(targetRoot, htmlPath);
    const references = await discoverHtmlAssetReferences(targetRoot, htmlPath, html);
    for (const reference of references) {
      registerAsset(assets, reference);
    }
  }

  if (!assets.size) {
    throw new Error("No active first-party JavaScript or CSS references were discovered");
  }

  await addRuntimeDependencies(targetRoot, assets);
  await finaliseAssets(targetRoot, assets);

  let rewrittenReferenceCount = 0;
  for (const htmlPath of htmlPaths) {
    const html = await readUtf8File(targetRoot, htmlPath);
    const result = await rewriteHtmlAssetReferences(targetRoot, htmlPath, html, assets);
    if (result.text !== html) {
      await fs.writeFile(path.join(targetRoot, htmlPath), result.text, "utf8");
    }
    rewrittenReferenceCount += result.rewrittenCount;
  }

  console.log(
    `Content-hashed ${assets.size} active first-party assets across ${htmlPaths.length} HTML files; rewrote ${rewrittenReferenceCount} HTML references.`,
  );
}

async function validateTargetRoot(targetRoot) {
  if (path.basename(targetRoot) !== STAGING_DIRECTORY_NAME) {
    throw new Error(`Unsafe target: staging directory must be named ${STAGING_DIRECTORY_NAME}`);
  }

  const targetStat = await fs.lstat(targetRoot).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`Staging target does not exist: ${targetRoot}`);
    }
    throw error;
  });
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error(`Unsafe target: staging target must be a real directory: ${targetRoot}`);
  }

  const realTargetRoot = await fs.realpath(targetRoot);
  const realRepoRoot = await fs.realpath(REPO_ROOT);
  if (realTargetRoot === realRepoRoot) {
    throw new Error("Unsafe target: refusing to rewrite the tracked repository root");
  }

  if (isPathWithin(realTargetRoot, realRepoRoot)) {
    const relativeTarget = toPublicPath(path.relative(realRepoRoot, realTargetRoot));
    if (relativeTarget !== STAGING_DIRECTORY_NAME) {
      throw new Error(`Unsafe target inside repository: ${relativeTarget}`);
    }
  }
}

async function collectActiveHtmlPaths(targetRoot) {
  const results = [];

  async function visit(relativeDirectory) {
    const absoluteDirectory = path.join(targetRoot, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = toPublicPath(path.join(relativeDirectory, entry.name));
      if (!relativeDirectory && entry.name === ARCHIVE_DIRECTORY_NAME) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`Unsupported symbolic link in active staging tree: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        results.push(relativePath);
      }
    }
  }

  await visit("");
  return results.sort();
}

async function discoverHtmlAssetReferences(targetRoot, htmlPath, html) {
  const references = [];
  for (const match of html.matchAll(new RegExp(HTML_TAG_PATTERN.source, HTML_TAG_PATTERN.flags))) {
    const tag = match[0];
    const tagName = String(match[1] || "").toLowerCase();
    if (tagName === "script") {
      const source = getQuotedAttribute(tag, "src");
      if (!source) continue;
      const reference = await resolveHtmlAssetReference(targetRoot, htmlPath, source.value, "js");
      if (reference) references.push(reference);
      continue;
    }

    const rel = getQuotedAttribute(tag, "rel");
    const href = getQuotedAttribute(tag, "href");
    if (!rel || !href) continue;
    const relTokens = rel.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (relTokens.includes("stylesheet")) {
      const reference = await resolveHtmlAssetReference(targetRoot, htmlPath, href.value, "css");
      if (reference) references.push(reference);
      continue;
    }

    const candidate = classifyUrl(href.value, htmlPath);
    if (candidate?.local && /\.(?:js|css)$/i.test(candidate.pathname)) {
      throw new Error(`Unsupported active JS/CSS link relation in ${htmlPath}: ${tag}`);
    }
  }
  return references;
}

async function resolveHtmlAssetReference(targetRoot, documentPath, rawUrl, type) {
  const classified = classifyUrl(rawUrl, documentPath);
  if (!classified.local) return null;

  const expectedExtension = type === "js" ? ".js" : ".css";
  if (!classified.pathname.toLowerCase().endsWith(expectedExtension)) {
    throw new Error(`Active ${type.toUpperCase()} reference has an unsupported path in ${documentPath}: ${rawUrl}`);
  }

  const assetPath = await resolvePublicFile(targetRoot, classified.pathname);
  if (assetPath === ARCHIVE_DIRECTORY_NAME || assetPath.startsWith(`${ARCHIVE_DIRECTORY_NAME}/`)) {
    throw new Error(`Active document ${documentPath} must not load build-exempt Archive asset: ${rawUrl}`);
  }

  return { path: assetPath, type };
}

function classifyUrl(rawUrl, documentPath) {
  const raw = String(rawUrl || "").trim();
  if (!raw) {
    throw new Error(`Empty active asset URL in ${documentPath}`);
  }

  const baseUrl = new URL(encodeURI(documentPath), `${LOCAL_ORIGIN}/`);
  let resolved;
  try {
    resolved = new URL(raw, baseUrl);
  } catch {
    throw new Error(`Invalid asset URL in ${documentPath}: ${rawUrl}`);
  }

  if (resolved.origin !== LOCAL_ORIGIN) {
    return { local: false };
  }
  return { local: true, pathname: resolved.pathname };
}

async function resolvePublicFile(targetRoot, publicPathname) {
  const segments = publicPathname.split("/").filter(Boolean).map((segment) => {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`Invalid percent-encoding in public path: ${publicPathname}`);
    }
    if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error(`Ambiguous public path segment in: ${publicPathname}`);
    }
    return decoded;
  });
  if (!segments.length) {
    throw new Error(`Asset URL does not resolve to a file: ${publicPathname}`);
  }

  let currentPath = targetRoot;
  for (const segment of segments) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") {
        throw new Error(`Active first-party asset is missing: ${publicPathname}`);
      }
      throw error;
    });
    const exactEntry = entries.find((entry) => entry.name === segment);
    if (!exactEntry) {
      throw new Error(`Active first-party asset is missing or has incorrect path casing: ${publicPathname}`);
    }
    if (exactEntry.isSymbolicLink()) {
      throw new Error(`Active first-party asset must not be a symbolic link: ${publicPathname}`);
    }
    currentPath = path.join(currentPath, segment);
  }

  const stat = await fs.stat(currentPath);
  if (!stat.isFile()) {
    throw new Error(`Active first-party asset is not a file: ${publicPathname}`);
  }
  const realTargetRoot = await fs.realpath(targetRoot);
  const realAssetPath = await fs.realpath(currentPath);
  if (!isPathWithin(realAssetPath, realTargetRoot)) {
    throw new Error(`Active first-party asset escapes staging root: ${publicPathname}`);
  }
  return toPublicPath(path.relative(targetRoot, currentPath));
}

function registerAsset(assets, reference) {
  const existing = assets.get(reference.path);
  if (existing && existing.type !== reference.type) {
    throw new Error(`Canonical public asset has conflicting types: ${reference.path}`);
  }
  if (!existing) {
    assets.set(reference.path, {
      path: reference.path,
      type: reference.type,
      dependencies: new Set(),
      runtimeRules: [],
      hash: null,
    });
  }
}

async function addRuntimeDependencies(targetRoot, assets) {
  const sidebar = assets.get(SIDEBAR_PATH);
  if (!sidebar) return;

  const sidebarSource = await readUtf8File(targetRoot, SIDEBAR_PATH);
  const matches = [...sidebarSource.matchAll(new RegExp(SIDEBAR_FOOTER_PATTERN.source, SIDEBAR_FOOTER_PATTERN.flags))];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one sidebar.js -> /site-footer.css runtime dependency; found ${matches.length}`);
  }

  const rawChildUrl = matches[0][2];
  const childReference = await resolveHtmlAssetReference(targetRoot, SIDEBAR_PATH, rawChildUrl, "css");
  if (!childReference || childReference.path !== SITE_FOOTER_PATH) {
    throw new Error(`Unexpected sidebar runtime stylesheet dependency: ${rawChildUrl}`);
  }
  registerAsset(assets, childReference);
  sidebar.dependencies.add(childReference.path);
  sidebar.runtimeRules.push({
    childPath: childReference.path,
    pattern: SIDEBAR_FOOTER_PATTERN,
  });
}

async function finaliseAssets(targetRoot, assets) {
  const visiting = new Set();
  const complete = new Set();

  async function finalise(assetPath) {
    if (complete.has(assetPath)) return;
    if (visiting.has(assetPath)) {
      throw new Error(`Content-hash dependency cycle detected at: ${assetPath}`);
    }
    const asset = assets.get(assetPath);
    if (!asset) {
      throw new Error(`Unknown content-hash dependency: ${assetPath}`);
    }

    visiting.add(assetPath);
    for (const dependencyPath of [...asset.dependencies].sort()) {
      await finalise(dependencyPath);
    }

    const absolutePath = path.join(targetRoot, asset.path);
    let bytes = await fs.readFile(absolutePath);
    if (asset.runtimeRules.length) {
      let source = bytes.toString("utf8");
      for (const rule of asset.runtimeRules) {
        const child = assets.get(rule.childPath);
        if (!child?.hash) {
          throw new Error(`Runtime dependency was not hashed before parent: ${rule.childPath}`);
        }
        let replacementCount = 0;
        source = source.replace(
          new RegExp(rule.pattern.source, rule.pattern.flags),
          (_match, prefix, rawUrl, suffix) => {
            replacementCount += 1;
            return `${prefix}${withContentHash(rawUrl, child.hash)}${suffix}`;
          },
        );
        if (replacementCount !== 1) {
          throw new Error(`Runtime dependency rewrite count changed for ${asset.path}: ${replacementCount}`);
        }
      }
      const updatedBytes = Buffer.from(source, "utf8");
      if (!updatedBytes.equals(bytes)) {
        await fs.writeFile(absolutePath, updatedBytes);
      }
      bytes = updatedBytes;
    }

    asset.hash = contentHash(bytes);
    visiting.delete(assetPath);
    complete.add(assetPath);
  }

  for (const assetPath of [...assets.keys()].sort()) {
    await finalise(assetPath);
  }
}

async function rewriteHtmlAssetReferences(targetRoot, htmlPath, html, assets) {
  let cursor = 0;
  let text = "";
  let rewrittenCount = 0;

  for (const match of html.matchAll(new RegExp(HTML_TAG_PATTERN.source, HTML_TAG_PATTERN.flags))) {
    const tag = match[0];
    const tagName = String(match[1] || "").toLowerCase();
    let attributeName = null;
    if (tagName === "script" && getQuotedAttribute(tag, "src")) {
      attributeName = "src";
    } else if (tagName === "link") {
      const rel = getQuotedAttribute(tag, "rel");
      if (rel?.value.toLowerCase().split(/\s+/).includes("stylesheet")) {
        attributeName = "href";
      }
    }

    let rewrittenTag = tag;
    if (attributeName) {
      const attribute = getQuotedAttribute(tag, attributeName);
      const type = tagName === "script" ? "js" : "css";
      const reference = await resolveHtmlAssetReference(targetRoot, htmlPath, attribute.value, type);
      if (reference) {
        const asset = assets.get(reference.path);
        if (!asset?.hash) {
          throw new Error(`Active asset was not finalised: ${reference.path}`);
        }
        const versionedUrl = withContentHash(attribute.value, asset.hash);
        rewrittenTag = `${tag.slice(0, attribute.valueStart)}${versionedUrl}${tag.slice(attribute.valueEnd)}`;
        rewrittenCount += 1;
      }
    }

    text += html.slice(cursor, match.index) + rewrittenTag;
    cursor = match.index + tag.length;
  }
  text += html.slice(cursor);
  return { text, rewrittenCount };
}

function getQuotedAttribute(tag, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\s${escapedName}\\s*=\\s*([\"'])(.*?)\\1`, "i");
  const match = pattern.exec(tag);
  if (!match) {
    if (new RegExp(`\\s${escapedName}\\s*=`, "i").test(tag)) {
      throw new Error(`Unsupported unquoted ${attributeName} attribute: ${tag}`);
    }
    return null;
  }
  const valueOffset = match[0].indexOf(match[2], match[0].indexOf(match[1]) + 1);
  const valueStart = match.index + valueOffset;
  return {
    value: match[2],
    valueStart,
    valueEnd: valueStart + match[2].length,
  };
}

function withContentHash(rawUrl, hash) {
  const fragmentIndex = rawUrl.indexOf("#");
  const beforeFragment = fragmentIndex === -1 ? rawUrl : rawUrl.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? "" : rawUrl.slice(fragmentIndex);
  const queryIndex = beforeFragment.indexOf("?");
  const pathname = queryIndex === -1 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  const query = queryIndex === -1 ? null : beforeFragment.slice(queryIndex + 1);

  let versionCount = 0;
  let updatedQuery;
  if (query === null || query === "") {
    updatedQuery = `v=${hash}`;
  } else {
    const parts = query.split("&");
    for (let index = 0; index < parts.length; index += 1) {
      const separatorIndex = parts[index].indexOf("=");
      const rawName = separatorIndex === -1 ? parts[index] : parts[index].slice(0, separatorIndex);
      let decodedName;
      try {
        decodedName = decodeURIComponent(rawName.replace(/\+/g, " "));
      } catch {
        throw new Error(`Invalid query parameter encoding in asset URL: ${rawUrl}`);
      }
      if (decodedName === "v") {
        versionCount += 1;
        parts[index] = `v=${hash}`;
      }
    }
    if (versionCount > 1) {
      throw new Error(`Asset URL contains multiple v parameters: ${rawUrl}`);
    }
    updatedQuery = versionCount === 1 ? parts.join("&") : `${query}&v=${hash}`;
  }

  return `${pathname}?${updatedQuery}${fragment}`;
}

function contentHash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LENGTH);
}

async function readUtf8File(targetRoot, relativePath) {
  return fs.readFile(path.join(targetRoot, relativePath), "utf8");
}

function isPathWithin(candidatePath, parentPath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPublicPath(filePath) {
  return filePath.split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  nodeProcess.exit(1);
});
