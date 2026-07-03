# Security Assessment

This is a technical risk assessment of Questarr's most likely and impactful
potential security problems. It is distinct from two other documents that
cover adjacent ground and are linked rather than duplicated here:

- [`.github/SECURITY.md`](../.github/SECURITY.md) — vulnerability reporting
  process, deployment hardening checklist, and the collaborator access/
  escalation policy.
- [`docs/SECRETS.md`](SECRETS.md) — a full inventory of every secret/
  credential in the system, how each is stored, and how it's rotated.
- [`docs/VEX.md`](VEX.md) — exploitability assessments for known
  vulnerabilities (CVE/GHSA) reported against third-party components
  Questarr ships. This document covers first-party design risk; VEX covers
  third-party component vulnerabilities.

Read those first for the complete credential, access-control, and
component-vulnerability picture; this document analyzes _risk_, not
inventory.

**Update policy:** revisit this register whenever a PR touches
authentication, SSRF protections, credential storage, rate limiting, or adds
a new external integration/actor (see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
for the actor list).

## Methodology

Each row below is a specific, source-verified risk area rated by likelihood
and impact given Questarr's threat model — a self-hosted, typically
single-or-few-user application, often run behind a home network or reverse
proxy rather than exposed as a multi-tenant public service. Full STRIDE-style
modeling was judged to be more process than a small project can keep current;
this lighter table format matches the pragmatic tone of the rest of `docs/`.

## Risk register

| Risk area                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Likelihood      | Impact     | Mitigation / status                                                                                                                                                                                                                                                                     | Reference                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Session revocation                              | JWTs are valid for 7 days (`server/auth.ts:79-82`) with no server-side revocation list or logout endpoint. A stolen token remains usable for up to a week.                                                                                                                                                                                                                                                                                                     | Low–Medium      | Medium     | Accepted risk for the self-hosted, single-tenant use case; no fix planned. Operators concerned about this can shorten the effective window by rotating `JWT_SECRET`, which invalidates all sessions immediately.                                                                        | `server/auth.ts:77-82`                                   |
| JWT secret storage                              | The signing secret resolves env var → DB → auto-generated via `crypto.randomBytes(64)` (`server/auth.ts:23-67`). When auto-generated, it is persisted in the same SQLite database as application data — a DB compromise yields both data and the means to forge sessions.                                                                                                                                                                                      | Low             | Medium     | Mitigated by operator action: set `JWT_SECRET` explicitly in production (documented in `docs/SECRETS.md` §2 and `.github/SECURITY.md`).                                                                                                                                                 | `server/auth.ts:23-67`, `server/config.ts:18-24`         |
| SSRF / DNS rebinding window                     | `safeFetch` resolves a hostname once and validates every returned IP, then pins HTTP requests to that IP. HTTPS requests cannot be IP-pinned (TLS SNI/certificate validation requires the original hostname), leaving a narrow window where a DNS record could change between the safety check and the actual connection.                                                                                                                                      | Low             | Medium     | Partially mitigated — the window is narrow (single resolution immediately before the request) and the attack requires the operator to point an indexer/downloader/service URL at an attacker-controlled domain in the first place. Documented as a known limitation, not fixed further. | `server/ssrf.ts:172-249`                                 |
| Private-network access allowed by design        | `isSafeUrl`/`isSafeIp`/`safeFetch` default `allowPrivate: true`, so RFC1918 and loopback targets are reachable.                                                                                                                                                                                                                                                                                                                                                | N/A (by design) | N/A        | Accepted, intentional: indexers and download clients commonly run on the same LAN or even the same host as Questarr in a self-hosted deployment. Cloud-metadata and link-local ranges remain blocked unconditionally regardless of this setting.                                        | `server/ssrf.ts:4-18,19-22,86-170`                       |
| Inconsistent input validation on auth endpoints | `/api/auth/setup` and `/api/auth/login` validate `username`/`password` with manual `typeof` checks instead of the `express-validator`/Zod pattern used consistently elsewhere in `routes.ts`.                                                                                                                                                                                                                                                                  | Low             | Low–Medium | Functionally adequate today (rejects non-string input, and `login` sits behind `authRateLimiter`), but inconsistent with the rest of the codebase and easier to get wrong on future edits. Tracked as a follow-up to migrate to the standard validator pattern.                         | `server/routes.ts:282-299,361-368`                       |
| Legacy plaintext credentials                    | Indexer `apiKey` and downloader `username`/`password` values written before AES-256-GCM encryption was introduced remain plaintext indefinitely — `decryptCredential()` detects the missing `enc:v1:` prefix and returns them unchanged, with no forced migration.                                                                                                                                                                                             | Low             | Medium     | Re-saving a credential (e.g. via `PATCH /api/indexers/:id`) re-encrypts it going forward. No background migration exists; operators with credentials configured before this feature shipped should re-save them once to force encryption.                                               | `server/credential-crypto.ts:98-108`                     |
| Rate-limiting gaps                              | RSS feed creation has no limiter beyond the general 100 req/min-per-IP fallback. (`POST /api/auth/setup` was previously unlimited too — **fixed**: it now sits behind `authRateLimiter`, the same limiter as `/api/auth/login`.)                                                                                                                                                                                                                               | Low             | Low        | RSS creation is a low-value target for abuse; monitor for abuse reports rather than pre-emptively hardening further. `/api/auth/setup` no longer needs a mitigation note — it's rate-limited like `/api/auth/login`.                                                                    | `server/routes.ts:282-359`, `server/middleware.ts:33-57` |
| Download path handling                          | `downloadPath` fields reject values containing `..` (`server/middleware.ts:293-301,366-374,420-428`) but do not otherwise normalize or allow-list paths — absolute paths, symlink traversal, null bytes, and Windows-style separators are not explicitly handled.                                                                                                                                                                                              | Low–Medium      | Medium     | Partial mitigation via the `..` substring check. Full path normalization/allow-listing is tracked as a hardening follow-up.                                                                                                                                                             | `server/middleware.ts:293-301,366-374,420-428`           |
| Supply-chain patch lag                          | `package-lock.json` is committed and Dependabot runs weekly for both npm and GitHub Actions. Major-version bumps were previously excluded from auto-PRs, which meant a security patch shipping only in a new major version wouldn't be proposed automatically. **Fixed:** the exclusion has been removed — Dependabot now opens PRs for major-version bumps too (as individual, ungrouped PRs so they still get dedicated review), see `docs/DEPENDENCIES.md`. | Low             | Low        | Resolved by removing the `ignore` rule in `.github/dependabot.yml`. Residual: major-version PRs still require manual review/merge, so a patch can sit open until reviewed — recommend periodic triage of open Dependabot PRs rather than letting them accumulate.                       | `.github/dependabot.yml`                                 |
| CORS/CSP/HSTS posture                           | CORS is restricted to `config.server.allowedOrigins` with `credentials: true` (`server/index.ts:24-29`). Helmet's CSP allows `'unsafe-inline'`/`'unsafe-eval'` in `script-src` only outside production (`server/routes.ts:236-239`). HSTS is enabled only when SSL is configured (`server/routes.ts:262`).                                                                                                                                                     | Low             | Medium     | Standard hardening already in place. Ensure `ALLOWED_ORIGINS` is set correctly and SSL is enabled in any production deployment so HSTS actually applies.                                                                                                                                | `server/index.ts:24-29`, `server/routes.ts:230-265`      |

## Out of scope / already covered elsewhere

- Full credential inventory, rotation procedures, and per-secret storage
  detail: [`docs/SECRETS.md`](SECRETS.md).
- Vulnerability disclosure process and repository/infrastructure access
  escalation policy: [`.github/SECURITY.md`](../.github/SECURITY.md).
- Exploitability assessments for known vulnerabilities in third-party
  dependencies and the container base image (satisfies OSPS-VM-04.02):
  [`docs/VEX.md`](VEX.md) and the feed itself at
  [`security/vex/questarr.openvex.json`](../security/vex/questarr.openvex.json).
- System actors and data-flow diagrams referenced throughout this register:
  [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
- Formal attack-surface analysis (trust boundaries, high-risk data flows,
  per-integration trust table, unauthenticated-route inventory):
  [`docs/THREAT_MODEL.md`](THREAT_MODEL.md), which satisfies the related
  OSPS-SA-03.02 requirement. This document (`SECURITY_ASSESSMENT.md`)
  satisfies OSPS-SA-03.01 and takes a risk-register view rather than
  duplicating that analysis.
