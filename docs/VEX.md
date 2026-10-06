# VEX Feed

This document describes Questarr's Vulnerability Exploitability eXchange (VEX)
feed: how known vulnerabilities in third-party components are tracked,
assessed for exploitability in the context of this project, and published.
It satisfies [OpenSSF Baseline OSPS-VM-04.02](https://baseline.openssf.org/):
any vulnerability reported against a component Questarr ships that does not
actually affect the project must be recorded here with a justification,
rather than silently ignored.

This is distinct from two adjacent documents:

- [`docs/SBOM.md`](./SBOM.md) — the inventory of components (what's shipped).
  The VEX feed makes exploitability statements _about_ entries in that
  inventory.
- [`docs/SECURITY_ASSESSMENT.md`](./SECURITY_ASSESSMENT.md) — a risk register
  of Questarr's _own_ architectural/design risks (e.g. session handling,
  SSRF surface). VEX only covers vulnerabilities in third-party
  dependencies (npm packages and the `node:22-alpine` base image), identified
  by CVE/GHSA ID, not first-party design tradeoffs.

## Format

The feed is a single [OpenVEX](https://github.com/openvex/spec) v0.2.0 JSON
document:

```
security/vex/questarr.openvex.json
```

Each entry is a `statement` scoped to a `vulnerability` (CVE/GHSA ID) and a
`product` (a package URL identifying the affected component and version, or
the published container image), with a `status` of one of:

- `not_affected` — the vulnerable code path is present but not reachable or
  not exploitable in how Questarr uses the component. Requires a
  `justification` (OpenVEX's fixed enum, e.g.
  `vulnerable_code_not_in_execute_path`,
  `vulnerable_code_not_present`,
  `component_not_present`) plus a free-text `impact_statement` explaining
  the specific reasoning.
- `affected` — exploitable; tracked until a fix is available. Should include
  `action_statement` describing the mitigation or remediation plan.
- `fixed` — resolved in the version currently shipped.
- `under_investigation` — triage in progress; a temporary state, not a
  resting one.

## Current statements

| Advisory                                                                 | Component          | Status                                                 | Why                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | `node-forge@1.4.0` | `not_affected` (`vulnerable_code_not_in_execute_path`) | The flaw is in RSA signature verification. `server/ssl.ts` only generates a self-signed certificate and parses PEM files with `certificateFromPem`, which verifies no signature; TLS itself runs on Node's `tls`. No patched release exists yet (2026-10-04). |

## How the feed gates CI

`npm audit` has no ignore list, so the build gates run
[`scripts/audit-prod.mjs`](https://github.com/Doezer/Questarr/blob/main/scripts/audit-prod.mjs) (`npm run audit:prod`)
instead of calling `npm audit` directly. It runs `npm audit --omit=dev --json`,
drops an advisory only when a `not_affected` or `fixed` statement in this feed
names its GHSA ID and covers the installed package version (`products` purl;
a purl without a version covers every version), and fails if anything at or above `--audit-level` remains. The
`sca-scan` job (`ci.yml`) and the release gate (`deploy.yml`) use
`--audit-level=high`; the scheduled `vulnerability-scan.yml` uses `low`.
Adding a statement here is therefore the only way to unblock a build on an
unfixed advisory, and it goes through PR review like any other change.

## How the feed is generated and kept current

1. **Scanning** — [`.github/workflows/vulnerability-scan.yml`](https://github.com/Doezer/Questarr/blob/main/.github/workflows/vulnerability-scan.yml)
   runs on every push to `main`, on a weekly schedule, and on demand. It:
   - Runs `npm audit --omit=dev --json` against the committed
     `package-lock.json`.
   - Builds the production Docker image and scans it with
     [Trivy](https://github.com/aquasecurity/trivy), which covers both the
     npm dependency tree and OS packages in the `node:22-alpine` base image
     (a common source of "known but unreachable" findings, since Questarr
     never invokes most Alpine base-image tooling at runtime).
   - Passes `security/vex/questarr.openvex.json` to Trivy via `--vex` so
     previously-assessed `not_affected`/`fixed` findings are suppressed from
     the report instead of re-flagging on every run.
   - Uploads the raw scan results (SARIF) to GitHub code scanning and as a
     workflow artifact for maintainer review.
2. **Triage** — when the scan surfaces a new CVE/GHSA not already covered by
   a statement, a maintainer assesses it:
   - If Questarr's usage of the component doesn't exercise the vulnerable
     code (e.g. a CLI-only flag never invoked, a dev-only tool that never
     ships to production, an Alpine package present in the base image but
     never executed by the app), add a `not_affected` statement with a
     specific `impact_statement` — not a generic "doesn't apply".
     Speculative or unverified reasoning is not accepted; the justification
     must reference the actual code path (or its absence) in this
     repository.
   - If it's exploitable, add an `affected` statement describing the
     mitigation in place (if partial) and open a tracking issue; resolving
     it (upgrading/patching) later flips the statement to `fixed`.
   - Statements are appended to `security/vex/questarr.openvex.json` in a
     PR, reviewed like any other change, and the document's top-level
     `version` is incremented and `timestamp` updated on every change.
3. **Publishing** — the feed is committed to the repository (so it's
   versioned alongside the code it describes) and, like the SBOM, attached
   as a workflow artifact on each scan run so external consumers (e.g.
   Dependency-Track, or anyone running Trivy/Grype against a Questarr image
   themselves) can pull it in with `--vex`.

## Consuming the feed

To apply Questarr's exploitability assessments when scanning a Questarr
image yourself:

```bash
trivy image --vex security/vex/questarr.openvex.json ghcr.io/doezer/questarr:latest
```

## Update policy

Revisit this document, and add/update statements in the feed, whenever:

- The vulnerability-scan workflow flags a new CVE/GHSA not yet covered.
- A dependency named in an existing `not_affected`/`affected` statement is
  upgraded, removed, or its usage in Questarr changes such that the
  justification no longer holds (re-verify or flip the statement to
  `fixed`).
- The base image (`node:22-alpine`) digest pinned in
  [`Dockerfile`](https://github.com/Doezer/Questarr/blob/main/Dockerfile) is bumped.
