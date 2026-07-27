#!/usr/bin/env node
/* global console */
/* global process */
// Flags package.json "overrides" entries that have become redundant: an override exists to
// force a patched version past a vulnerable range still declared by a direct/transitive
// dependency. Once that dependency bumps its own declared range past the patched version,
// the override can be removed. See docs/DEPENDENCIES.md for the rationale behind each entry.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import semver from "semver";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const overrides = pkg.overrides || {};

function readManifest(dirPath) {
  const manifestPath = path.join(dirPath, "package.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function findGlobalConsumers(pkgName) {
  const consumers = [];
  // Recurse into nested node_modules too: npm doesn't always hoist every copy of a
  // transitive dependency to the top level, so a consumer can be shadowed several
  // levels deep (e.g. node_modules/table/node_modules/ajv) and invisible to a
  // top-level-only scan.
  function walk(nmDir) {
    let entries;
    try {
      entries = readdirSync(nmDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dir of entries) {
      if (!dir.isDirectory() || dir.name === ".bin") continue;
      const dirPath = path.join(nmDir, dir.name);
      if (dir.name.startsWith("@")) {
        let subEntries;
        try {
          subEntries = readdirSync(dirPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue;
          check(path.join(dirPath, sub.name), `${dir.name}/${sub.name}`);
        }
      } else {
        check(dirPath, dir.name);
      }
    }
  }
  function check(pkgDir, name) {
    const manifest = readManifest(pkgDir);
    const range = manifest?.dependencies?.[pkgName];
    if (range) consumers.push({ consumer: name, range });
    walk(path.join(pkgDir, "node_modules"));
  }
  walk("node_modules");
  return consumers;
}

function findScopedConsumer(parent, pkgName) {
  const manifest = readManifest(path.join("node_modules", ...parent.split("/")));
  const range = manifest?.dependencies?.[pkgName];
  return range ? [{ consumer: parent, range }] : [];
}

const entries = [];
for (const [key, value] of Object.entries(overrides)) {
  if (typeof value === "string") {
    entries.push({ pkgName: key, safeRange: value, parent: null });
  } else if (value && typeof value === "object") {
    for (const [subName, subRange] of Object.entries(value)) {
      entries.push({ pkgName: subName, safeRange: subRange, parent: key });
    }
  }
}

let anyRemovable = false;

for (const { pkgName, safeRange, parent } of entries) {
  const label = parent ? `${parent} -> ${pkgName}` : pkgName;
  const safeMin = semver.minVersion(safeRange);
  const consumers = parent ? findScopedConsumer(parent, pkgName) : findGlobalConsumers(pkgName);

  if (consumers.length === 0) {
    console.log(`[REMOVABLE] ${label} (forced ${safeRange}): no consumer found in node_modules.`);
    anyRemovable = true;
    continue;
  }

  const unsafe = consumers.filter((c) => {
    const consumerMin = semver.minVersion(c.range);
    return !consumerMin || semver.lt(consumerMin, safeMin);
  });

  if (unsafe.length === 0) {
    console.log(
      `[REMOVABLE] ${label} (forced ${safeRange}): every consumer's own range is already >= ${safeMin}.`
    );
    for (const c of consumers) console.log(`  - ${c.consumer} wants ${c.range}`);
    anyRemovable = true;
  } else {
    console.log(`[still needed] ${label} (forced ${safeRange})`);
    for (const c of unsafe)
      console.log(`  - ${c.consumer} wants ${c.range} (would allow < ${safeMin})`);
  }
}

if (anyRemovable) {
  console.error(
    "\nOne or more overrides in package.json look redundant. Remove them and re-run `npm install`, then update docs/DEPENDENCIES.md."
  );
  process.exit(1);
}

console.log("\nAll overrides are still required.");
