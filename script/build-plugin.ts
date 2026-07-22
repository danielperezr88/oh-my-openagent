#!/usr/bin/env bun

/**
 * Build the main plugin bundle with auto-detected native addon externals.
 *
 * Scans the entire node_modules tree (including Bun's .bun/ cache) for .node
 * files, resolves which npm package each belongs to, and externalizes them all
 * so Bun's bundler never tries to inline native binaries.
 *
 * This replaces raw `bun build ... --external <pkg1> --external <pkg2> ...` so
 * that adding a new native dependency can never silently break the build.
 */

import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const NODE_MODULES = join(ROOT, "node_modules");

// Packages externalized for non-native reasons (peer deps, shared singletons,
// packages that bundle their own native addons and manage them via postinstall)
const STATIC_EXTERNALS = [
  "zod",
  "@huggingface/transformers",
] as const;

/**
 * Extract the npm package name from a path inside node_modules.
 *
 * Handles both layouts:
 *   node_modules/@scope/pkg/...           → @scope/pkg
 *   node_modules/pkg/...                  → pkg
 *   node_modules/.bun/<hash>/node_modules/@scope/pkg/...  → @scope/pkg
 */
function extractPackageName(relativePath: string): string | null {
  const parts = relativePath.split("/");

  // Find the last "node_modules" segment — the package name follows it
  const lastNmIndex = parts.lastIndexOf("node_modules");
  const startIdx =
    lastNmIndex !== -1
      ? lastNmIndex + 1
      : parts[0] === ".bun"
        ? -1
        : 0;

  if (startIdx === -1 || startIdx >= parts.length) return null;

  if (parts[startIdx].startsWith("@") && startIdx + 1 < parts.length) {
    return `${parts[startIdx]}/${parts[startIdx + 1]}`;
  }
  return parts[startIdx];
}

/** Recursively scan node_modules for .node files and return their owning package names. */
function findNativeAddonPackages(): Set<string> {
  if (!existsSync(NODE_MODULES)) return new Set();

  const packages = new Set<string>();
  const foundFiles: string[] = [];

  // Walk the entire tree — including .bun/ where Bun stores platform binaries.
  // Bun.Glob skips hidden directories on Windows, so we use readdirSync directly.
  function scan(dir: string, depth: number) {
    if (depth > 10) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.endsWith(".node")) {
        foundFiles.push(relative(NODE_MODULES, join(dir, entry.name)));
        continue;
      }

      // Skip .bin (symlink shims, not real packages)
      if (entry.name === ".bin") continue;

      if (entry.isDirectory()) {
        scan(join(dir, entry.name), depth + 1);
      }
    }
  }

  scan(NODE_MODULES, 0);

  for (const relativePath of foundFiles) {
    // Normalize Windows backslashes to forward slashes for consistent parsing
    const normalized = relativePath.replace(/\\/g, "/");
    const pkgName = extractPackageName(normalized);
    if (pkgName) packages.add(pkgName);
  }

  return packages;
}

/**
 * Map platform-specific binary packages (e.g. @ast-grep/napi-win32-x64-msvc)
 * back to their JS wrapper package (e.g. @ast-grep/napi) so the wrapper is
 * also externalized. Otherwise Bun bundles the wrapper JS, which then tries
 * to emit the .node asset.
 *
 * Strategy: for each detected package, check if a shorter-name "parent" package
 * exists in node_modules. E.g. if we found "@ast-grep/napi-win32-x64-msvc",
 * check if "@ast-grep/napi" exists as an installed package.
 */
function addWrapperPackages(nativePackages: Set<string>): Set<string> {
  const result = new Set(nativePackages);

  for (const pkg of nativePackages) {
    const lastSlash = pkg.lastIndexOf("/");
    if (lastSlash === -1) continue;

    const scope = pkg.slice(0, lastSlash);
    const nameParts = pkg.slice(lastSlash + 1).split("-");

    // Try progressively shorter names: napi-win32-x64-msvc → napi-win32-x64 → napi-win32 → napi
    for (let i = nameParts.length - 1; i >= 1; i--) {
      const candidate = `${scope}/${nameParts.slice(0, i).join("-")}`;
      const candidateDir = join(NODE_MODULES, ...candidate.split("/"));
      if (existsSync(join(candidateDir, "package.json"))) {
        result.add(candidate);
        break; // shortest match wins
      }
    }
  }

  return result;
}

async function main() {
  const nativePackages = addWrapperPackages(findNativeAddonPackages());
  const allExternals = [
    ...new Set([...STATIC_EXTERNALS, ...nativePackages]),
  ].sort();

  if (nativePackages.size > 0) {
    console.log(
      `Auto-detected ${nativePackages.size} native addon package(s) to externalize:`,
    );
    for (const pkg of allExternals) {
      if (nativePackages.has(pkg)) {
        console.log(`  - ${pkg}`);
      }
    }
  }

  const result = await Bun.build({
    entrypoints: [join(ROOT, "src", "index.ts")],
    outdir: join(ROOT, "dist"),
    target: "bun",
    format: "esm",
    external: allExternals,
  });

  if (!result.success) {
    for (const logEntry of result.logs) {
      console.error(logEntry);
    }
    process.exit(1);
  }

  for (const output of result.outputs) {
    const sizeKb = (output.size / 1024).toFixed(1);
    console.log(`  ${output.path}  ${sizeKb} KB`);
  }
}

main();
