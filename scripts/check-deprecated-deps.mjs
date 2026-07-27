#!/usr/bin/env node
/* global console */
/* global process */
// Flags dependencies (direct or transitive) that npm has marked deprecated in the registry.
// package-lock.json already records each resolved package's "deprecated" field at lockfile-generation
// time, so detection needs no network access - but that also means this only ever inspects packages
// already known to be deprecated in the committed lockfile. It cannot detect a currently-clean package
// becoming newly deprecated upstream (that only shows up once the lockfile is regenerated). What it does
// catch: a package that's been stuck deprecated becoming fixable, because a single `npm view` per package
// checks whether the latest published version has actually resolved the deprecation.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// npm package names are restricted to lowercase letters, digits, and - . _ ~ with an optional
// @scope/ prefix, so double-quoting is sufficient to pass them through a shell safely.
function assertSafePackageName(name) {
  if (!/^(@[a-z0-9-~][a-z0-9._~-]*\/)?[a-z0-9-~][a-z0-9._~-]*$/.test(name)) {
    throw new Error(`Refusing to shell out for suspicious package name: ${name}`);
  }
}

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const directDeps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
]);

const byName = new Map();
for (const [key, lockEntry] of Object.entries(lock.packages)) {
  if (key === "" || !lockEntry.deprecated) continue;
  const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
  const entry = byName.get(name) ?? { name, versions: new Set(), message: lockEntry.deprecated };
  entry.versions.add(lockEntry.version);
  byName.set(name, entry);
}

if (byName.size === 0) {
  console.log("No deprecated dependencies found in package-lock.json.");
  process.exit(0);
}

const opts = { encoding: "utf8" };

function npmViewLatest(name) {
  assertSafePackageName(name);
  const raw = execSync(`npm view "${name}" --json`, opts);
  const info = JSON.parse(raw);
  return { version: info.version, deprecated: info.deprecated || null };
}

function consumerChain(name) {
  assertSafePackageName(name);
  try {
    return execSync(`npm ls "${name}" --all`, opts).trim();
  } catch (err) {
    // npm ls exits non-zero on unrelated tree issues (peer conflicts, etc.) but still prints stdout.
    return (err.stdout || "").toString().trim();
  }
}

let anyActionable = false;

for (const { name, versions, message } of byName.values()) {
  const resolvedVersions = [...versions].sort((a, b) => a.localeCompare(b));
  let latest;
  try {
    latest = npmViewLatest(name);
  } catch (err) {
    console.log(`[unknown] ${name}@${resolvedVersions.join(", ")}: failed to query npm registry.`);
    console.log(`  ${err.message.split("\n")[0]}`);
    continue;
  }

  const alreadyOnLatest = resolvedVersions.includes(latest.version);

  if (!latest.deprecated && !alreadyOnLatest) {
    anyActionable = true;
    const fix = directDeps.has(name)
      ? `bump "${name}" in package.json to ^${latest.version}`
      : `bump the parent that pulls in "${name}" (see consumer chain below), or add a package.json "overrides" entry pinning it to ${latest.version} - see docs/DEPENDENCIES.md`;
    console.log(
      `[ACTIONABLE] ${name}@${resolvedVersions.join(", ")} -> ${latest.version} resolves the deprecation.`
    );
    console.log(`  Deprecation message: ${message}`);
    console.log(`  Fix: ${fix}`);
    console.log(`  Consumer chain:\n${consumerChain(name).replace(/^/gm, "    ")}`);
  } else if (latest.deprecated) {
    console.log(
      `[blocked] ${name}@${resolvedVersions.join(", ")}: still deprecated at latest (${latest.version}).`
    );
    console.log(`  ${message}`);
  } else {
    console.log(
      `[blocked] ${name}@${resolvedVersions.join(", ")}: already at latest, no fix published.`
    );
    console.log(`  ${message}`);
  }
}

if (anyActionable) {
  console.error(
    "\nOne or more deprecated dependencies have a non-deprecated newer version available. See the [ACTIONABLE] entries above for how to fix each one, then re-run `npm install`."
  );
  process.exit(1);
}

console.log("\nAll remaining deprecated dependencies are pinned upstream; no action possible yet.");
