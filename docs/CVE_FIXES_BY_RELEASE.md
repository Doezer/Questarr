# Questarr — CVEs fixed per release (v1.2.0 → v1.5.0)

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

## v1.4.1 (from v1.4.0) — hotfix

- **brace-expansion** (npm `overrides` pin `^5.0.8`, resolved 5.0.9) 5.0.7 → 5.0.9 — fixes 3 HIGH CVEs:
  - **CVE-2026-14257** (GHSA-mh99-v99m-4gvg) — DoS via unbounded expansion length causing an out-of-memory process crash
  - **CVE-2026-13149** (GHSA-3jxr-9vmj-r5cp) — DoS via exponential-time expansion of consecutive non-expanding `{}` groups
  - **CVE-2026-69152** (GHSA-rgw5-rvv9-x895) — DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation
- **fast-xml-parser** 5.10.0 → 5.10.1 — fixes **CVE-2026-73569** (GHSA-8r6m-32jq-jx6q, HIGH) — repeated DOCTYPE declarations reset entity expansion limits.
- **js-yaml** 5.2.1 → 5.2.2 — fixes **CVE-2026-73643** (GHSA-pm4m-ph32-ghv5, HIGH) — exponential parsing time in flow collections leading to denial of service.
- **body-parser** 1.20.5 → 1.20.6 — fixes **CVE-2026-12590** (GHSA-v422-hmwv-36x6, LOW) — an invalid `limit` value silently disabled size enforcement, allowing arbitrarily large request payloads.
- **fast-uri** (npm `overrides` pin, dev-only at the time) 3.1.3 → 3.1.4 — fixes **CVE-2026-16221** (GHSA-v2hh-gcrm-f6hx, HIGH) — host confusion via a literal backslash authority delimiter.
- **minimatch** override pinned to `^10.2.5` — closes a second resolution path for the `brace-expansion` advisories: `eslint-plugin-react`'s bundled `minimatch@3.1.5` still pulled the vulnerable `brace-expansion@1.1.x`. devDependency-only (not shipped in the production image), but flagged by `npm audit` without `--omit=dev`, so pinned for a fully clean audit.

## v1.4.2 (from v1.4.1) — hotfix

Tagged directly off `v1.4.1`, not from `main`; `main` picked up the same fixes independently.

- **ip-address** (transitive, via `express-rate-limit`) 10.2.0 → 10.5.0 — fixes 3 CVEs; no `overrides` pin needed, `express-rate-limit`'s `^8.5.2` range already permitted 10.5.0:
  - **CVE-2026-69192** (GHSA-mwp4-54f8-5fhr, HIGH) — `Address4` decoded leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass
  - **CVE-2026-54272** (GHSA-22jq-vg5j-6vgg, MODERATE) — misclassification of IPv4-mapped/NAT64 IPv6 addresses
  - **CVE-2026-69198** (GHSA-4xrf-jv44-h6hh, MODERATE) — a CIDR suffix on the parsed address suppressed special-use classification
- **socket.io-parser** (npm `overrides` pin) 4.2.6 → 4.2.7 — fixes **CVE-2026-69185** (GHSA-2m8v-j782-fhvr, HIGH, CVSS 7.5) — zero-attachment memory exhaustion, vulnerable range `4.0.0 - <4.2.7`. Reaches production via `socket.io`/`socket.io-client` (real-time download-progress and notification updates).

## v1.5.0 (from v1.4.2)

Regenerated on 2026-09-29 with `node scripts/cve-report.mjs v1.4.2 HEAD` (plus `v1.4.0 v1.4.1` and `v1.4.1 v1.4.2` for the hotfixes above). Fixes that already shipped in v1.4.1/v1.4.2 are not repeated here, even where `main` re-applied them.

### Production dependencies

- **proxy-addr** (npm `overrides` pin) 2.0.7 → 2.0.8 — fixes **CVE-2026-90711** ([AIKIDO-2026-101201](https://security.aikido.dev/cve/AIKIDO-2026-101201), CRITICAL) — an undersized IPv4-mapped IPv6 trust-subnet prefix (e.g. `::ffff:10.0.0.0/8` instead of `::ffff:10.0.0.0/104`) was accepted without error but trusted every IPv4 address on the internet, letting unauthenticated clients spoof `X-Forwarded-For` and bypass IP-based access controls, rate limiting, and audit logging, vulnerable range `>=1.1.0 <=2.0.7`. Reaches production via `express`, which pins `proxy-addr: ~2.0.7` (a range that otherwise excludes the fix). Not yet indexed by OSV.dev, so absent from the script output.
- **fast-uri** (npm `overrides` pin) 3.1.4 → 3.1.7 — fixes 6 HIGH advisories (#879, #981). Reaches production through `ajv`, an optional peer of `@hookform/resolvers` (and dev-only through `secretlint`):
  - **CVE-2026-18446** (GHSA-7p8r-x3mc-p8w7) — host confusion via backslash authority introducer (fixed in 3.1.5)
  - **CVE-2026-75931** (GHSA-5jgf-p345-68v8) — host confusion via skipped IDN canonicalization on scheme-relative references
  - **CVE-2026-76172** (GHSA-jqff-g426-hqxp) — host confusion via percent-encoded scheme normalization
  - **CVE-2026-75975** (GHSA-f65p-4m7j-42xc) — SSRF via malformed IPv6 normalization
  - **CVE-2026-75899** (GHSA-fph4-wmhf-6fwf) — SSRF via repeated hostname percent-decoding
  - **CVE-2026-84292** (GHSA-qw65-cvwx-89v3) — authority injection via an unvalidated port in `serialize`
- **multer** 2.2.0 → 2.4.0 — fixes 5 CVEs (#1000, #1066):
  - **CVE-2026-82333** (GHSA-535w-7cp7-47q4, HIGH) — DoS via oversized array index in field names
  - **CVE-2026-77037** (GHSA-qfvm-cv95-jqjf, HIGH) — DoS via file descriptor leak on aborted uploads
  - **CVE-2026-77078** (GHSA-wc9g-mqfw-jrwm, HIGH) — DoS via crafted multipart field names
  - **CVE-2026-88932** (GHSA-3pph-fpjx-jg34, MODERATE) — DoS via orphaned disk writes on aborted uploads (fixed in 2.4.0)
  - **CVE-2026-77063** (GHSA-qvfw-j98x-7q72, LOW) — file size limit bypass via async `fileFilter` race condition
- **ip-address** (npm `overrides` pin, transitive via `express-rate-limit` and `socks`) 10.5.0 → 10.7.2 — fixes **CVE-2026-101913** (GHSA-rpw4-54j3-4h4q, MODERATE) — `Address6.isLinkLocal()` recognized `fe80::/64` rather than `fe80::/10` — and **CVE-2026-101910** (GHSA-2vr4-cq9g-pvrc, MODERATE) — the NAT64 local-use range `64:ff9b:1::/48` was not classified; both allowed SSRF and trust-boundary bypass (#1118).
- **qs** (npm `overrides` pin) 6.15.2 → 6.16.0 — fixes **CVE-2026-82417** (GHSA-4mjr-xmp4-gh2g, MODERATE) — DoS via attacker-controlled `isBuffer`, vulnerable range `>=2.2.5 <6.16.0` — and **CVE-2026-82562** (GHSA-x5fp-wj9c-mxmx, MODERATE) — array-limit bypass via bracket-key comma parsing, vulnerable range `>=6.14.2 <=6.15.3`. Reaches production via `express`/`body-parser`, both of which pin `qs: ~6.15.1` (a range that otherwise excludes the fix); the same override also closes the gap in `openid`, `steam-web`, and `superagent` (#997).
- **undici** (direct dependency) 8.10.0 → 8.10.2 — fixes **CVE-2026-85024** (GHSA-3wwx-pv8p-q78v, MODERATE) — DoS via an unhandled error in WebSocket permessage-deflate decompression (#1028). The earlier 7.29.0 → 8.9.0 major bump crossed no fix boundary (see Changed). Before it became a direct dependency, `undici` was only a dev-only transitive of `jsdom`, whose 7.28.0 → 7.29.0 refresh fixed CVE-2026-13697, CVE-2026-16728, CVE-2026-14643, CVE-2026-15157 and CVE-2026-16729 in test tooling.

### Development dependencies (not shipped in the production image)

- **js-yaml** (npm `overrides` pin, scoped to `@eslint/eslintrc`, and the other nested 4.x copies) 4.3.0 → 4.3.2 — fixes GHSA-5p4m-2wfm-xmqj (no CVE assigned, HIGH) — quadratic CPU consumption in `!!omap` resolution — and **CVE-2026-84375** (GHSA-2883-xcg3-v3hh, HIGH) — `maxTotalMergeKeys` did not limit CPU use for empty merge sources (#894, #997, #998). The top-level `js-yaml` 5.x used in production was already unaffected.
- **nanoid** (nested under `postcss`) 3.3.12 → 3.3.18 — fixes **CVE-2026-67214** (GHSA-28wg-ghj8-5hjv, HIGH) and **CVE-2026-67213** (GHSA-2v37-7h3g-55p8, HIGH) — generators could loop indefinitely with a negative or zero size (#917). The production `nanoid` 6.x was never affected.
- **browserslist** 4.28.4 → 4.28.9 — fixes **CVE-2026-73088** (GHSA-73wf-gq98-2v4g, HIGH) — crash / prototype write via untrusted custom stats — and **CVE-2026-73089** (GHSA-c83g-rgw3-j3cx, HIGH) — unbounded memory growth via distinct query results.
- **baseline-browser-mapping** 2.10.40 → 2.11.21 — fixes **CVE-2026-45819** (GHSA-w5vr-8v7q-w6rv, MODERATE) — process termination on invalid input.
- **postcss** 8.5.18 → 8.5.28 — fixes **CVE-2026-69153** (GHSA-fxqj-rqcc-2cmp, MODERATE) — attacker-controlled `sourceMappingURL` could read arbitrary `.map` files when `from` is unset (#882).
- **vitest** / **@vitest/mocker** 4.1.10 → 5.0.1 — fixes **CVE-2026-84373** (GHSA-82fw-gwwq-j7x9, MODERATE) — path traversal / arbitrary file read via the redirect mock (#971).
- **undici** (scoped `overrides` pin under `node-gyp`, via `@lizenz/checker`) 6.28.0 → 6.29.0 — fixes **CVE-2026-85024** (GHSA-3wwx-pv8p-q78v), the same advisory as the production entry above (#1118).
- **fast-copy** (npm `overrides` pin, via `pino-pretty`) 4.0.3 → 4.1.0 — fixes GHSA-jggr-w7fw-pc2j (no CVE assigned, MODERATE) — stack exhaustion when copying deeply nested values.
- **postcss-selector-parser** (npm `overrides` pin, via `@npmcli/query`) 7.1.5 → 7.1.6 — fixes **CVE-2026-104844** (GHSA-rj75-hqrm-r3gf, MODERATE) — quadratic complexity in flat selector parsing. The unused `@tailwindcss/typography` dev dependency, which pinned the unpatched 6.0.10, is removed.
- **pyjwt** (CI Semgrep install, `.github/requirements/semgrep.txt`) 2.13.0 → 2.15.1 through Semgrep 1.178.0 → 1.180.0 — fixes 14 advisories, including **CVE-2026-102268** (GHSA-ffc3-869f-jxw9, CRITICAL) — asymmetric-PEM detection bypass with whitespace-mutated public keys — and HIGH key-confusion and redirect issues (CVE-2026-102266, CVE-2026-102267, CVE-2026-102271, CVE-2026-102272, CVE-2026-102273). Semgrep only scans the repository in CI and never handles tokens.

### Container image

- Docker base image: `apk upgrade` for Alpine's patched `openssl`/`expat` (Trivy #417, #361, #351, #364, #363); removed the base image's bundled npm CLI after `npm prune`, dropping its vendored `tar`/`ip-address`/`brace-expansion` copies (Trivy #350, #287, #286, #272) (#1113).

---

## Footnote: devDependencies (build-time only, not shipped to production)

Checked per the "each bumped package" instruction, but these tools run only at build time (Vite/esbuild/PostCSS output is bundled; the tools themselves aren't part of the running server) so their CVEs don't apply to the deployed app:

- **vite** 5.4.21 → 8.0.9 (v1.3.0) fixed **CVE-2026-39365** (path traversal in optimized-deps `.map` handling). Two Windows-dev-server-only issues remain open through 8.0.12: CVE-2026-53571 (`server.fs.deny` bypass) and CVE-2026-53632 (launch-editor NTLMv2 hash disclosure via UNC path).
- **esbuild** 0.27.2 → 0.27.3 (v1.2.1) actually _introduced_ a still-open, no-CVE-assigned advisory (GHSA-g7r4-m6w7-qqqr, dev-server arbitrary file read on Windows) — never fixed by the later 0.28.0 bump.
- **postcss** 8.4.47 → 8.5.10 (v1.3.0) fixed **CVE-2026-41305** (XSS via unescaped `</style>` in stringify output) — relevant only if user-controlled CSS is ever processed at build time, which it isn't here.
