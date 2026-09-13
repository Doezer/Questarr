# Questarr — CWEs addressed per release (v1.2.0 → v1.4.3)

Method: same as [`docs/CVE_FIXES_BY_RELEASE.md`](CVE_FIXES_BY_RELEASE.md) — diffed `package-lock.json` at each
tag boundary and cross-checked every bumped package through OSV.dev. Each advisory is then mapped to its CWE
IDs sourced from the `database_specific.cwes` field in the OSV.dev response (e.g.
`[{"cwe_id": "CWE-400", "name": "Uncontrolled Resource Consumption"}, ...]`). The script that automates this
process is `scripts/cwe-report.mjs`.

This document gives a **weakness-category view** of what was addressed across releases — useful for tracking
which classes of bugs (injection, DoS, memory safety, SSRF, …) were systematically reduced over time. The
companion CVE doc lists the same findings by severity and package. The two documents are complementary;
neither replaces the other.

Scope note: same as the CVE doc — this covers dependency-bump _fixes_, not a full current-exposure audit.
First-party code weaknesses are tracked separately in [`docs/SECURITY_ASSESSMENT.md`](SECURITY_ASSESSMENT.md)
and [`docs/THREAT_MODEL.md`](THREAT_MODEL.md).

---

## v1.2.0 (from v1.1.0)

### CWE-400: Uncontrolled Resource Consumption

- **fast-xml-parser** 5.3.3 → 5.3.4 — CVE-2026-25128 — numeric entity parsing caused a RangeError DoS;
  no upper bound on expansion count.

---

## v1.2.1 (from v1.2.0)

### CWE-1333: Inefficient Regular Expression Complexity

- **fast-xml-parser** 5.3.4 → 5.3.5 — CVE-2026-25896 — regex injection in DOCTYPE entity names allowed an
  attacker to craft a payload triggering catastrophic backtracking; classified as injection-via-regex (ReDoS).

---

## v1.2.2 (from v1.2.1)

### CWE-400: Uncontrolled Resource Consumption

- **fast-xml-parser** 5.3.5 → 5.3.7 — CVE-2026-26278 — entity expansion in DOCTYPE had no recursion depth
  limit, enabling unbounded memory growth via a small document.

---

## v1.3.0 (from v1.2.2) — largest security-relevant release

### CWE-89: Improper Neutralization of Special Elements used in an SQL Command

- **drizzle-orm** 0.45.1 → 0.45.2 — CVE-2026-39356 — SQL identifiers were not properly escaped, allowing
  injection via user-controlled column/table names passed to query builders.

### CWE-91: XML Injection

- **fast-xml-parser** 5.3.7 → 5.7.1 — CVE-2026-41650 — XML comment and CDATA delimiters were not escaped in
  XMLBuilder output, allowing injected markup when user data flowed through the serialiser.

### CWE-290: Authentication Bypass by Spoofing

- **express-rate-limit** 8.2.1 → 8.3.2 — CVE-2026-30827 — IPv4-mapped IPv6 addresses (e.g. `::ffff:1.2.3.4`)
  were not normalised to their IPv4 form, giving dual-stack clients two independent rate-limit buckets and
  allowing effective bypass of per-client limits.

### CWE-295: Improper Certificate Validation

- **node-forge** 1.3.3 → 1.4.0 — CVE-2026-33896 — `basicConstraints` and RFC 5280 path-length constraints
  were not validated during certificate-chain building, enabling a crafted intermediate to forge a trusted leaf
  certificate.

### CWE-347: Improper Verification of Cryptographic Signature

- **node-forge** 1.3.3 → 1.4.0 — CVE-2026-33894 — RSA-PKCS1 v1.5 signature verification was susceptible to a
  Bleichenbacher-style chosen-ciphertext attack, allowing signature forgery without the private key.
- **node-forge** 1.3.3 → 1.4.0 — CVE-2026-33895 — Ed25519 signature verification did not check for canonical
  scalar encoding, allowing signature malleability (different byte sequences passing for the same signature).

### CWE-400: Uncontrolled Resource Consumption

- **fast-xml-parser** 5.3.7 → 5.7.1 — CVE-2026-33036 — incomplete fix for CVE-2026-26278; a numeric entity
  bypass re-enabled unbounded expansion even when a limit was configured.
- **fast-xml-parser** 5.3.7 → 5.7.1 — CVE-2026-33349 — entity expansion limit treated as JS falsy when set
  to `0`, silently disabling all protection.
- **multer** 2.0.2 → 2.1.1 — CVE-2026-2359 — resource exhaustion via concurrent upload requests with
  pathological field layouts.
- **multer** 2.0.2 → 2.1.1 — CVE-2026-3304 — incomplete cleanup of aborted uploads consumed disk space until
  the process ran out of writable storage.
- **socket.io-parser** 4.2.5 → 4.2.6 — CVE-2026-33151 — unbounded binary attachments in Socket.IO messages
  were buffered in memory without any size limit, enabling memory exhaustion DoS.

### CWE-459: Incomplete Cleanup

- **multer** 2.0.2 → 2.1.1 — CVE-2026-3304 — see CWE-400 entry above; incomplete cleanup of aborted uploads
  is classified under both resource consumption and incomplete cleanup.

### CWE-674: Uncontrolled Recursion

- **fast-xml-parser** 5.3.7 → 5.7.1 — CVE-2026-27942 — `XMLBuilder` with `preserveOrder: true` recursed into
  nested structures without a depth guard, causing a stack overflow on deeply nested input.
- **multer** 2.0.2 → 2.1.1 — CVE-2026-3520 — uncontrolled recursion when parsing multipart payloads with
  deeply nested boundary markers; exploitable with a crafted ~4 KB request body.

### CWE-835: Loop with Unreachable Exit Condition (Infinite Loop)

- **node-forge** 1.3.3 → 1.4.0 — CVE-2026-33891 — `BigInteger.modInverse(0)` entered an infinite loop with no
  exit path; reachable via crafted RSA public keys or DH parameters.

---

## v1.3.1 (from v1.3.0)

No dependency bump in this release crosses a `fixed` OSV boundary — no CWE fixes to attribute.

---

## v1.4.0 (from v1.3.1)

### CWE-20: Improper Input Validation

- **qs** 6.14.2 → 6.15.2 — CVE-2026-8723 — `qs.stringify` threw an uncaught `TypeError` when it encountered
  `null`/`undefined` array entries with `encodeValuesOnly` set; missing input guard turned invalid data into a
  remotely-triggerable DoS.

### CWE-22: Improper Limitation of a Pathname to a Restricted Directory (Path Traversal) _(devDep)_

- **vite** 8.0.12 → 8.1.4 — CVE-2026-53571 — `server.fs.deny` allow-list bypass; crafted paths using URL
  encoding evaded the restriction and allowed arbitrary file reads from the dev server's host filesystem.

### CWE-93: Improper Neutralization of CRLF Sequences

- **form-data** 4.0.5 → 4.0.6 — CVE-2026-12143 — multipart field names and filenames were passed through to
  MIME headers without stripping `\r\n` sequences, allowing header injection in any HTTP client that consumed
  the generated body (e.g. proxied upload forwarding).

### CWE-200: Exposure of Sensitive Information to an Unauthorised Actor _(devDep)_

- **vite** 8.0.12 → 8.1.4 — CVE-2026-53632 — the `launch-editor` integration passed user-supplied paths
  through to an OS shell command on Windows; a UNC path could be crafted to trigger an outbound SMB connection
  and capture an NTLMv2 authentication hash from the developer's machine.

### CWE-400: Uncontrolled Resource Consumption

- **multer** 2.1.1 → 2.2.0 — CVE-2026-5079 — deeply nested field name arrays (e.g. `a[b][c][…]` repeated
  thousands of times) caused O(n²) processing and memory growth, eventually OOM-killing the process.
- **ws** 8.18.3 → 8.21.0 — CVE-2026-48779 — the receiver reassembled fragmented frames and tiny data chunks
  without a per-message size cap, allowing memory exhaustion from a stream of small messages.

### CWE-457: Use of Uninitialized Variable

- **ws** 8.18.3 → 8.21.0 — CVE-2026-45736 — a buffer slice was returned to callers before being zeroed,
  leaking up to 124 bytes of adjacent heap content from a prior message in the same allocation region.

### CWE-459: Incomplete Cleanup

- **multer** 2.1.1 → 2.2.0 — CVE-2026-5038 — aborted uploads left temporary files on disk; the cleanup path
  was skipped when the request was destroyed before the `finish` event fired.

### CWE-770: Allocation of Resources Without Limits or Throttling

- **brace-expansion** 5.0.6 → 5.0.7 — CVE-2026-45149 — a crafted large numeric range (e.g. `{1..999999999}`)
  bypassed the documented DoS protection; the guard checked only the final count, not intermediate string
  lengths, so the per-item buffer could exhaust memory before the limit was tested.

### CWE-1333: Inefficient Regular Expression Complexity

- **js-yaml** 4.1.1 → 5.2.1 — CVE-2026-53550 — YAML merge keys (`<<`) with repeated alias references caused
  O(n²) work during parsing; a payload under 10 KB could delay processing by several seconds.

---

## v1.4.1 (from v1.4.0) — hotfix

### CWE-20: Improper Input Validation

- **body-parser** 1.20.5 → 1.20.6 — CVE-2026-12590 — passing an unparseable string or `NaN` as the `limit`
  option made `bytes.parse()` return `null`; the middleware silently disabled size enforcement, allowing
  arbitrarily large request bodies through to route handlers.

### CWE-674: Uncontrolled Recursion _(devDep)_

- **js-yaml** 5.2.1 → 5.2.2 — GHSA-pm4m-ph32-ghv5 — flow-collection entries were re-parsed on each recursion
  level, producing 2^n parse time; a 200-byte payload was sufficient to hang the event loop.

### CWE-770: Allocation of Resources Without Limits or Throttling

- **brace-expansion** 5.0.7 → 5.0.8 — CVE-2026-14257 — the `expand()` function imposed no limit on the length
  of individual result strings; chaining brace groups (e.g. `{a,b}` repeated 1 500 times) exhausted memory
  with an uncatchable error before the count guard fired. 5.0.8 adds a `maxLength` cap defaulting to 4 000 000
  characters. _(Also pinned for the `minimatch@3.x` chain via `overrides` — devDep only.)_

---

## v1.4.2 (from v1.4.1) — hotfix tag off v1.4.1, not reachable from main

Fixed the same two advisories as v1.4.3 below (ip-address and socket.io-parser). Skipped in this diff-based
report; see the v1.4.2 tag for the full record.

---

## v1.4.3 (from v1.4.1, via main)

### CWE-400: Uncontrolled Resource Consumption

- **socket.io-parser** 4.2.6 → 4.2.7 — GHSA-2m8v-j782-fhvr — an attacker could emit a message carrying zero
  binary attachments but a non-zero `attachments` count, causing the parser to hold buffered data indefinitely
  and exhaust memory over repeated messages.
- **fast-xml-parser** 5.10.0 → 5.10.1 — GHSA-8r6m-32jq-jx6q — DoS via a crafted input pattern; fix required
  a `package.json` bump since the direct-dependency range `^5.10.0` still permitted the unpatched `5.10.0`.

### CWE-918: Server-Side Request Forgery (SSRF)

- **ip-address** 10.2.0 → 10.4.0 — GHSA-mwp4-54f8-5fhr — `Address4` decoded leading-zero octets as decimal
  while OS resolvers treat them as octal (e.g. `010` → decimal 10 vs. octal 8); a crafted IP literal could
  bypass SSRF allow-lists and trust-boundary checks that relied on `ip-address` for normalisation. Two
  moderate SSRF-adjacent advisories (GHSA-4xrf-jv44-h6hh, GHSA-22jq-vg5j-6vgg) also fall inside the same
  bump range.
- **fast-uri** 3.1.3 → 3.1.5 — CVE-2026-16221 / GHSA-7p8r-x3mc-p8w7 — host-component parsing accepted a
  backslash as an authority introducer in some URI schemes, causing the parsed host to differ from what
  browsers and HTTP clients resolved; exploitable for host-confusion SSRF and redirect attacks _(devDep
  only via `secretlint` → `ajv`; pinned for hygiene)_.

---

## Footnote: devDependencies (build-time only, not shipped to production)

The CWE entries marked _(devDep)_ above apply only to tooling that runs at build time (Vite, esbuild,
secretlint). They don't affect the deployed server. Included for completeness so `npm audit` is fully clean.

### CWE-22: Improper Limitation of a Pathname to a Restricted Directory _(devDep)_

- **esbuild** 0.27.2 → 0.27.3 (v1.2.1) — GHSA-g7r4-m6w7-qqqr — the esbuild dev server served arbitrary files
  outside the configured root on Windows when path traversal sequences were used in asset requests. Fixed
  properly in 0.28.1 (v1.4.0). A separate advisory (GHSA-67mh-4wv8-2f99) in the `@esbuild-kit/core-utils`
  nested copy covered permissive cross-origin request handling (related CWE-942).
- **vite** 5.4.21 → 8.0.9 (v1.3.0) — CVE-2026-39365 — path traversal in optimised-deps `.map` handling
  (build-time only).

---

_To regenerate this report, run `node scripts/cwe-report.mjs` after fetching all `v*` tags (`git fetch --tags`).
To save a specific range: `node scripts/cwe-report.mjs v1.3.0 v1.4.0`. OSV.dev is queried live; network access
is required._
