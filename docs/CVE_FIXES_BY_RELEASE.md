# Questarr — CVEs fixed per release (v1.2.0 → v1.4.0)

Method: diffed `package.json`/`package-lock.json` at each tag boundary, then cross-checked every bumped package through OSV.dev's `querybatch` endpoint (query old-version vs new-version, take the set difference of returned GHSA IDs) and confirmed exact `fixed` boundaries via per-GHSA `/v1/vulns/{id}` lookups. All headline findings below — including axios, node-forge, and socket.io-parser — were verified through the same batch-diff method, not just by trusting commit messages. Only entries with a confirmed OSV `fixed` event landing inside the bump range are listed as fixes.

Scope note: newly-_added_ dependencies (multer, passport, passport-steam, express-session, rss-parser, js-yaml, node-forge's initial introduction) were checked for CVEs open at their pinned version only where a later bump partially fixed them (multer). Packages that arrived once and were never re-bumped weren't separately audited for pre-existing CVEs unless flagged — this report covers _fixes_, not full current-exposure.

## v1.2.0 (from v1.1.0)

- **fast-xml-parser** 5.3.3 → 5.3.4 — fixes **CVE-2026-25128** (GHSA-37qj-frw5-hhjh, HIGH) — RangeError DoS via numeric entities.

## v1.2.1 (from v1.2.0)

- **fast-xml-parser** 5.3.4 → 5.3.5 — fixes **CVE-2026-25896** (GHSA-m7jm-9gc2-mpf2, CRITICAL) — entity-encoding bypass via regex injection in DOCTYPE entity names.

## v1.2.2 (from v1.2.1)

- **fast-xml-parser** 5.3.5 → 5.3.7 — fixes **CVE-2026-26278** (GHSA-jmr7-xgp7-cmfj, HIGH) — DoS via entity expansion in DOCTYPE (no expansion limit).

## v1.3.0 (from v1.2.2) — largest security-relevant release

- **fast-xml-parser** 5.3.7 → 5.7.1 — fixes 4 CVEs:
  - **CVE-2026-33036** (GHSA-8gc5-j5rx-235r, HIGH) — numeric entity expansion bypassing all expansion limits (incomplete fix for CVE-2026-26278)
  - **CVE-2026-27942** (GHSA-fj3w-jwp8-x2g3, LOW) — stack overflow in XMLBuilder with `preserveOrder`
  - **CVE-2026-41650** (GHSA-gh4j-gqv2-49f6, MODERATE) — XML Comment/CDATA injection via unescaped delimiters
  - **CVE-2026-33349** (GHSA-jp2q-39xq-3w4g, MODERATE) — entity expansion limit bypassed when set to `0` (JS falsy-evaluation bug)
- **node-forge** 1.3.3 → 1.4.0 — fixes 4 CVEs:
  - **CVE-2026-33896** (GHSA-2328-f5f3-gj25, HIGH) — `basicConstraints`/RFC 5280 cert-chain validation bypass
  - **CVE-2026-33891** (GHSA-5m6q-g25r-mvwx, HIGH) — DoS via `BigInteger.modInverse(0)` infinite loop
  - **CVE-2026-33894** (GHSA-ppp5-5v6c-4jwp, HIGH) — RSA-PKCS1 v1.5 signature forgery (Bleichenbacher-style)
  - **CVE-2026-33895** (GHSA-q67f-28xg-22rw, HIGH) — Ed25519 signature malleability (missing canonical-scalar check)
- **socket.io-parser** (npm `overrides` pin) 4.2.5 → 4.2.6 — fixes **CVE-2026-33151** (GHSA-677m-j7p3-52f9, HIGH) — unbounded binary attachments DoS
- **drizzle-orm** 0.45.1 → 0.45.2 — fixes **CVE-2026-39356** (GHSA-gpj5-g38j-94v9, HIGH) — SQL injection via improperly escaped SQL identifiers
- **express-rate-limit** 8.2.1 → 8.3.2 — fixes **CVE-2026-30827** (GHSA-46wh-pxpv-q5gq, HIGH) — IPv4-mapped IPv6 addresses bypass per-client rate limiting on dual-stack servers
- **multer** 2.0.2 → 2.1.1 — fixes 3 of 5 CVEs present since multer's introduction in v1.2.1:
  - **CVE-2026-3520** (GHSA-5528-5vmv-3xc2, HIGH) — DoS via uncontrolled recursion
  - **CVE-2026-2359** (GHSA-v52c-386h-88mc, HIGH) — DoS via resource exhaustion
  - **CVE-2026-3304** (GHSA-xf7r-hgr6-v32p, HIGH) — DoS via incomplete cleanup
  - ⚠️ Still open at 2.1.1 (fix requires multer ≥2.2.0, not yet adopted as of v1.3.1): CVE-2026-5038 (GHSA-3p4h-7m6x-2hcm, MODERATE) and CVE-2026-5079 (GHSA-72gw-mp4g-v24j, HIGH)

## v1.3.1 (from v1.3.0)

No dependency bump in this release crosses a `fixed` OSV boundary — purely maintenance/feature updates.

## v1.4.0 (From v1.3.1)

- **js-yaml** 4.1.1 → 5.2.1 — fixes **CVE-2026-53550** (GHSA-h67p-54hq-rp68, MODERATE) — quadratic-complexity DoS in merge-key handling via repeated aliases. (Three separate devDep-tooling nested copies — under `eslint`'s `@eslint/eslintrc`, `textlint`'s `linter-formatter`, and `rc-config-loader` — resolve independently to `4.3.0`; that's past the `4.2.0` fix boundary for this CVE, so they were never vulnerable and aren't a fix to attribute.)
- **multer** 2.1.1 → 2.2.0 — fixes the 2 CVEs left open in the v1.3.0 report:
  - **CVE-2026-5038** (GHSA-3p4h-7m6x-2hcm, MODERATE) — DoS via incomplete cleanup of aborted uploads
  - **CVE-2026-5079** (GHSA-72gw-mp4g-v24j, HIGH) — DoS via deeply nested field names
- **form-data** (transitive, resolved 4.0.5 → 4.0.6) — fixes **CVE-2026-12143** (GHSA-hmw2-7cc7-3qxx, HIGH) — CRLF injection via unescaped multipart field names/filenames.
- **ws** (transitive, resolved 8.18.3 → 8.21.0) — fixes 2 CVEs:
  - **CVE-2026-45736** (GHSA-58qx-3vcg-4xpx, MODERATE) — uninitialized memory disclosure
  - **CVE-2026-48779** (GHSA-96hv-2xvq-fx4p, HIGH) — memory exhaustion DoS from tiny fragments/data chunks
- **qs** (transitive, resolved 6.14.2 → 6.15.2; pulled in by `body-parser`/`express`, and separately by `openid`/`steam-web`/`superagent`) — fixes **CVE-2026-8723** (GHSA-q8mj-m7cp-5q26, MODERATE) — `qs.stringify` throws an uncaught `TypeError` (remotely-triggerable DoS) on `null`/`undefined` array entries when `encodeValuesOnly` is set. Confirmed fix boundary via OSV: vulnerable range is `introduced: 6.11.1`, `fixed: 6.15.2` — the resolved-at-v1.3.1 version 6.14.2 falls inside it.
- **brace-expansion** (transitive, dedup'd across multiple resolutions) — fixes **CVE-2026-45149** (GHSA-jxxr-4gwj-5jf2, MODERATE) — a crafted large numeric range (e.g. `{1..999999999999}`) defeats the library's documented DoS protection. At v1.3.1 the lockfile carried four parallel resolutions from different dependency chains: `1.1.13`, `2.0.3`, and two under the `minimatch` family, `5.0.5` and `5.0.6`. Verified each individually against OSV — only `5.0.5` fell inside the vulnerable range (fixed at `5.0.6`); the other three were already safe. By HEAD, dependency resolution consolidates everything onto the already-patched `5.0.7`/`1.1.14`, so there's no longer a vulnerable resolution anywhere in the tree. (The `1.1.13→1.1.14` hop on the legacy `minimatch@3.x` chain carries no CVE fix of its own — it's incidental to this consolidation.)
- **esbuild** (devDep) 0.28.0 → 0.28.1 — fixes GHSA-g7r4-m6w7-qqqr (no CVE assigned) — the Windows dev-server arbitrary-file-read issue flagged as still-open in the v1.2.1/v1.3.0 entries is now fixed.
- **esbuild, nested copy** — the new npm `overrides` entry (`@esbuild-kit/core-utils` → `esbuild ^0.25.0`) bumps that dependency's bundled esbuild from 0.18.20 to 0.25.12, fixing GHSA-67mh-4wv8-2f99 (no CVE, MODERATE — dev server accepts arbitrary cross-origin requests). Separately, `tsx`'s own duplicate nested esbuild copy (0.27.7, carrying the same GHSA-g7r4-m6w7-qqqr as above) was deduped away entirely by this bump round rather than upgraded.
- **vite** (devDep) 8.0.12 → 8.1.4 — fixes both issues left open in the v1.3.0 report:
  - **CVE-2026-53571** (GHSA-fx2h-pf6j-xcff, HIGH) — `server.fs.deny` bypass
  - **CVE-2026-53632** (GHSA-v6wh-96g9-6wx3, MODERATE) — launch-editor NTLMv2 hash disclosure via UNC path on Windows

---

## Footnote: devDependencies (build-time only, not shipped to production)

Checked per the "each bumped package" instruction, but these tools run only at build time (Vite/esbuild/PostCSS output is bundled; the tools themselves aren't part of the running server) so their CVEs don't apply to the deployed app:

- **vite** 5.4.21 → 8.0.9 (v1.3.0) fixed **CVE-2026-39365** (path traversal in optimized-deps `.map` handling). Two Windows-dev-server-only issues remain open through 8.0.12: CVE-2026-53571 (`server.fs.deny` bypass) and CVE-2026-53632 (launch-editor NTLMv2 hash disclosure via UNC path).
- **esbuild** 0.27.2 → 0.27.3 (v1.2.1) actually _introduced_ a still-open, no-CVE-assigned advisory (GHSA-g7r4-m6w7-qqqr, dev-server arbitrary file read on Windows) — never fixed by the later 0.28.0 bump.
- **postcss** 8.4.47 → 8.5.10 (v1.3.0) fixed **CVE-2026-41305** (XSS via unescaped `</style>` in stringify output) — relevant only if user-controlled CSS is ever processed at build time, which it isn't here.
