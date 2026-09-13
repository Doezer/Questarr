#!/usr/bin/env node
/* global console */
/* global process */
/* global fetch */
// Reports which CWEs (Common Weakness Enumerations) were addressed in each release by
// diffing package-lock.json's resolved versions (direct + transitive) across git tag
// boundaries and checking OSV.dev for vulnerabilities present in the old version(s) but
// absent from the new version(s) of each changed package. Each advisory is then mapped to
// its CWE IDs (e.g. CWE-79 XSS, CWE-89 SQL Injection) extracted from the OSV response's
// database_specific.cwes field, giving a weakness-category view of what was fixed.
import { execSync } from "node:child_process";
import semver from "semver";

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns/";
const ECOSYSTEM = "npm";

function git(args) {
  return execSync(`git ${args}`, { encoding: "utf8" }).trim();
}

function readLockfile(ref) {
  try {
    return JSON.parse(execSync(`git show ${ref}:package-lock.json`, { encoding: "utf8" }));
  } catch {
    return null;
  }
}

// lock.packages is keyed by path, e.g. "node_modules/@radix-ui/react-tabs" or
// "node_modules/foo/node_modules/bar" for a deduped nested copy - the bare package name
// is always the segment after the last "node_modules/". A package can resolve to
// multiple nested/deduped paths; it's classified as dev only if every occurrence is
// dev-only, and as prod if any occurrence is reachable from a non-dev path.
function resolvedVersions(lockfile) {
  const versions = new Map();
  if (!lockfile?.packages) return versions;
  for (const [key, entry] of Object.entries(lockfile.packages)) {
    if (key === "" || !entry.version) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    const info = versions.get(name) ?? { versions: new Set(), isDev: true };
    info.versions.add(entry.version);
    if (!entry.dev) info.isDev = false;
    versions.set(name, info);
  }
  return versions;
}

function changedPackages(oldVersions, newVersions) {
  const names = new Set([...oldVersions.keys(), ...newVersions.keys()]);
  const changed = [];
  for (const name of names) {
    const oldInfo = oldVersions.get(name);
    const newInfo = newVersions.get(name);
    const oldSet = oldInfo?.versions ?? new Set();
    const newSet = newInfo?.versions ?? new Set();
    const same = oldSet.size === newSet.size && [...oldSet].every((version) => newSet.has(version));
    if (!same) {
      changed.push({
        name,
        oldVersions: [...oldSet],
        newVersions: [...newSet],
        isDev: newInfo ? newInfo.isDev : oldInfo.isDev,
      });
    }
  }
  return changed.sort((a, b) => a.name.localeCompare(b.name));
}

async function osvQueryBatch(queries) {
  if (queries.length === 0) return [];
  const response = await fetch(OSV_BATCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries }),
  });
  if (!response.ok) {
    throw new Error(`OSV.dev querybatch failed: ${response.status} ${response.statusText}`);
  }
  const { results } = await response.json();
  return results.map((result) => (result.vulns ?? []).map((vuln) => vuln.id));
}

async function osvVulnDetails(id, cache) {
  if (cache.has(id)) return cache.get(id);
  const response = await fetch(`${OSV_VULN_URL}${id}`);
  if (!response.ok) {
    const fallback = { id, cves: [id], summary: "(details unavailable)", cwes: [] };
    cache.set(id, fallback);
    return fallback;
  }
  const vuln = await response.json();
  const cves = (vuln.aliases ?? []).filter((alias) => alias.startsWith("CVE-"));
  if (cves.length === 0) cves.push(vuln.id);

  // CWE IDs appear in database_specific.cwes as [{cwe_id: "CWE-79", name: "..."}, ...]
  // Some advisories (e.g. older GHSA records) use a plain string array instead.
  const rawCwes = vuln.database_specific?.cwes ?? [];
  const cwes = rawCwes.map((entry) =>
    typeof entry === "string" ? { id: entry, name: "" } : { id: entry.cwe_id, name: entry.name ?? "" }
  );

  const detail = { id: vuln.id, cves, summary: vuln.summary ?? "(no summary)", cwes };
  cache.set(id, detail);
  return detail;
}

async function fixedVulnsForBoundary(changed) {
  // One deduplicated batch query across every (name, version) touched in this boundary.
  const queryKeys = [];
  for (const { name, oldVersions, newVersions } of changed) {
    for (const version of new Set([...oldVersions, ...newVersions])) {
      queryKeys.push({ name, version });
    }
  }
  const queries = queryKeys.map(({ name, version }) => ({
    package: { name, ecosystem: ECOSYSTEM },
    version,
  }));
  const results = await osvQueryBatch(queries);
  const vulnIdsByKey = new Map();
  queryKeys.forEach(({ name, version }, i) => {
    vulnIdsByKey.set(`${name}@${version}`, new Set(results[i]));
  });

  const perPackageFixes = [];
  for (const pkg of changed) {
    const oldVulnIds = new Set();
    for (const version of pkg.oldVersions) {
      for (const id of vulnIdsByKey.get(`${pkg.name}@${version}`) ?? []) oldVulnIds.add(id);
    }
    const newVulnIds = new Set();
    for (const version of pkg.newVersions) {
      for (const id of vulnIdsByKey.get(`${pkg.name}@${version}`) ?? []) newVulnIds.add(id);
    }
    const fixedIds = [...oldVulnIds].filter((id) => !newVulnIds.has(id));
    if (fixedIds.length > 0) perPackageFixes.push({ ...pkg, fixedIds });
  }
  return perPackageFixes;
}

async function reportBoundary(oldRef, newRef, label, vulnCache) {
  const oldLock = readLockfile(oldRef);
  const newLock = readLockfile(newRef);
  if (!oldLock || !newLock) {
    console.log(`## ${label}\n\n(skipped - package-lock.json not found at one of these refs)\n`);
    return;
  }

  const changed = changedPackages(resolvedVersions(oldLock), resolvedVersions(newLock));
  if (changed.length === 0) {
    console.log(`## ${label}\n\nNo dependency version changes.\n`);
    return;
  }

  const fixes = await fixedVulnsForBoundary(changed);
  console.log(`## ${label}\n`);
  if (fixes.length === 0) {
    console.log(
      `No known CWE fixes (${changed.length} package${changed.length === 1 ? "" : "s"} bumped, none matched a patched OSV.dev advisory).\n`
    );
    return;
  }

  // Aggregate: map CWE ID → list of fix-line strings, split by prod/dev scope.
  // Advisories with no CWE data are collected under a synthetic "(No CWE)" bucket.
  const NO_CWE = "(No CWE data in advisory)";
  const cweMap = { prod: new Map(), dev: new Map() };

  for (const { name, oldVersions, newVersions, fixedIds, isDev } of fixes) {
    const details = await Promise.all(fixedIds.map((id) => osvVulnDetails(id, vulnCache)));
    const oldLabel = oldVersions.join("/") || "(absent)";
    const newLabel = newVersions.join("/") || "(removed)";
    const scopeMap = isDev ? cweMap.dev : cweMap.prod;

    for (const { cves, summary, cwes } of details) {
      const cveStr = cves.join(", ");
      if (cwes.length === 0) {
        const bucket = scopeMap.get(NO_CWE) ?? [];
        bucket.push(`- **${name}** ${oldLabel} → ${newLabel} — fixes ${cveStr}: ${summary}`);
        scopeMap.set(NO_CWE, bucket);
      } else {
        for (const { id: cweId, name: cweName } of cwes) {
          const key = cweName ? `${cweId}: ${cweName}` : cweId;
          const bucket = scopeMap.get(key) ?? [];
          bucket.push(`- **${name}** ${oldLabel} → ${newLabel} — fixes ${cveStr}: ${summary}`);
          scopeMap.set(key, bucket);
        }
      }
    }
  }

  for (const [scopeLabel, scopeMap] of [
    ["Production dependencies", cweMap.prod],
    ["Development dependencies", cweMap.dev],
  ]) {
    if (scopeMap.size === 0) continue;
    console.log(`### ${scopeLabel}\n`);
    // Sort CWE entries: numeric CWE-NNN first by number, then the no-data bucket last.
    const sortedKeys = [...scopeMap.keys()].sort((a, b) => {
      const aNum = parseInt(a.replace(/^CWE-/, ""), 10);
      const bNum = parseInt(b.replace(/^CWE-/, ""), 10);
      if (a === NO_CWE) return 1;
      if (b === NO_CWE) return -1;
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    });
    for (const key of sortedKeys) {
      const lines = scopeMap.get(key);
      console.log(`#### ${key}\n`);
      for (const line of lines) console.log(line);
      console.log("");
    }
  }

  const noFixCount = changed.length - fixes.length;
  if (noFixCount > 0) {
    console.log(
      `${noFixCount} other package${noFixCount === 1 ? "" : "s"} bumped in this range with no known CWE fix.`
    );
  }
  console.log("");
}

function sortedVersionTags() {
  const tags = git("tag --list")
    .split("\n")
    .filter((tag) => tag.startsWith("v") && semver.valid(tag.replace(/^v/, "")));
  return tags.sort((a, b) => semver.compare(a.replace(/^v/, ""), b.replace(/^v/, "")));
}

async function main() {
  const [fromRef, toRef] = process.argv.slice(2);
  const vulnCache = new Map();

  if (fromRef && toRef) {
    await reportBoundary(fromRef, toRef, `${fromRef} → ${toRef}`, vulnCache);
    return;
  }

  const tags = sortedVersionTags();
  if (tags.length === 0) {
    console.error("No version tags (v*) found.");
    process.exit(1);
  }

  for (let i = 0; i < tags.length - 1; i++) {
    await reportBoundary(tags[i], tags[i + 1], `${tags[i]} → ${tags[i + 1]}`, vulnCache);
  }

  const latestTag = tags[tags.length - 1];
  const headLock = readLockfile("HEAD");
  const latestLock = readLockfile(latestTag);
  const headDiffers =
    headLock &&
    latestLock &&
    JSON.stringify(headLock.packages) !== JSON.stringify(latestLock.packages);
  if (headDiffers) {
    await reportBoundary(latestTag, "HEAD", `${latestTag} → HEAD (unreleased)`, vulnCache);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
