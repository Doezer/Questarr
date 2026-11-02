---
name: bump-questarr-version
description: Bump the Questarr version across package.json, lockfile, Docker, Home Assistant, Umbrel, CasaOS and Helm files for a release.
---

Use when preparing a Questarr release (e.g. 1.5.0 -> 1.6.0). Branch from a fresh `origin/main` (`git fetch origin main` first).

Files to update to the new version (OLD -> NEW):

1. `package.json` (`version`) and `package-lock.json` (run `npm install --package-lock-only --ignore-scripts`; only the two root `version` fields should change).
2. `Dockerfile`: `LABEL org.opencontainers.image.version="NEW"`.
3. Home Assistant add-on: `questarr/config.yaml` (`version`) and `questarr/Dockerfile` (`ARG QUESTARR_VERSION`).
4. Umbrel: `doezer-questarr/umbrel-app.yml` (`version`).
5. CasaOS: `casaos/docker-compose.yml` (`x-casaos.version`).
6. Helm: `charts/questarr/Chart.yaml` `appVersion` = NEW and chart `version` patch bump (0.1.x -> 0.1.x+1, required on every chart change); example tag in `charts/questarr/README.md` (`v` + NEW).
7. `docs/PRD.md`: the `**Version:**` line.

Check, don't blindly change:

- `docs/CHANGELOG.md` must have a `## [NEW] - date` section (release.yml and `scripts/extract-changelog.mjs` fail without it). It is normally supplied by the long-lived documentation PR.
- `cosmos/`, `doezer-questarr/docker-compose.yml` and `casaos/docker-compose.yml` images use `:latest`; leave them.
- Historical mentions ("since 1.5.0", v1.4.2 migration pins, CVE/CWE-by-release tables) are not bumped. Add a release row to `docs/CVE_FIXES_BY_RELEASE.md` / `docs/CWE_FIXES_BY_RELEASE.md` only if the release fixes any (use the cve-report / cwe-report skills).
- Finish with `grep -rIn "OLD" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude=package-lock.json --exclude=CHANGELOG.md .` to catch stragglers.

Run `npx prettier --check` on the touched files, commit ("Bump version to NEW ..."), open a PR. The tag `vNEW` is pushed from Vincent's PC (cloud sessions cannot push tags).
