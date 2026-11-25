# Dependency Management

This document describes how Questarr selects, obtains, and tracks its dependencies.

## Selection

Dependencies are added deliberately as part of normal development, via `npm install`, and land in `package.json` alongside the feature or fix that needs them. Preference is given to actively maintained, widely used packages already common in the Node/React ecosystem. New dependencies go through the same pull request review process as any other code change (see [.github/CONTRIBUTING.md](https://github.com/Doezer/Questarr/blob/main/.github/CONTRIBUTING.md)) before merging to `main`.

## Obtaining dependencies

- Packages are installed from the public [npm registry](https://www.npmjs.com/).
- `package-lock.json` is committed to the repository and used for reproducible installs — the exact resolved version of every direct and transitive dependency is pinned.
- The `packageManager` field in `package.json` pins the npm version used to install and build the project.
- The `allowScripts` field in `package.json` explicitly allowlists which packages are permitted to run install-time (postinstall) scripts. It's npm's own native field (npm ≥ 11.16.0), managed via `npm approve-scripts` / `npm deny-scripts`, not a third-party tool — today it's advisory (npm flags unreviewed scripts but still runs them), with a future npm release expected to block unapproved scripts by default. Any package added here should have a concrete reason (e.g. a native module that needs to compile a binary during install).
- The `overrides` field forces a specific version of a transitive dependency when a direct dependency's own declared range still permits a vulnerable release:
  - `socket.io-parser: 4.2.7` patches [CVE-2026-33151](https://github.com/socketio/socket.io/security/advisories/GHSA-677m-j7p3-52f9) (resource exhaustion via unbounded binary attachments, fixed in 4.2.6) and [CVE-2026-69185](https://github.com/advisories/GHSA-2m8v-j782-fhvr) (zero-attachment memory exhaustion, fixed in 4.2.7). Needed because `socket.io`/`socket.io-client` declare `socket.io-parser: ~4.2.4`, a range that still allows the unpatched 4.2.4–4.2.6.
  - `engine.io: ^6.6.10` patches [GHSA-2gc4-cqfq-p2gv](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv) (DoS via an Engine.IO protocol revision mismatch). Needed because `socket.io@4.8.4` declares `engine.io: ~6.6.0`, a range that still allows the unpatched 6.6.0–6.6.9.
  - `@esbuild-kit/core-utils`'s `esbuild` dependency is bumped to `^0.25.0` to patch the esbuild dev-server request-forwarding issue ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)). Needed because `drizzle-kit` pulls in `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils`, which pins `esbuild: ~0.18.20`.
  - `qs: ^6.16.0` patches [CVE-2026-82417](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) (DoS via attacker-controlled `isBuffer`, affecting `>=2.2.5 <6.16.0`) and [CVE-2026-82562](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) (array-limit bypass via bracket-key comma parsing, affecting `>=6.14.2 <=6.15.3`). Needed because `express` and `body-parser` still pin `qs` to a range that excludes the patched `6.16.0`, and `openid`, `steam-web` and `superagent` have ranges that likewise still permit a vulnerable release.
  - `brace-expansion` is no longer overridden: every `minimatch` release now resolved (10.2.6 and 11.x) declares `^5.0.12` itself, which covers [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) and the earlier CVE-2026-69152 / CVE-2026-14257 / CVE-2026-13149 DoS issues. Re-add the override if a consumer ever resolves a version below `5.0.12`.
  - `ip-address: ^10.7.5` (raised from 10.7.2 by a Dependabot bump) patches [CVE-2026-101913](https://github.com/advisories/GHSA-rpw4-54j3-4h4q) and [CVE-2026-101910](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc) (affecting `<=10.5.0`). Needed because `express-rate-limit` (`^10.2.0`) and `socks` (`^10.1.1`) still allow a vulnerable release.
  - `minimatch: ^10.2.6` keeps the general `minimatch` consumers (`eslint`, `glob`, `@npmcli/*`, …) on the 10.x line they declare, at the latest 10.x release. The nested `readdir-glob` → `minimatch: ^11.0.1` override patches [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (denial of service via globparts amplification, affects `>=7.0.0 <11.0.1`, fixed in 11.0.1; 10.x has no fix). `archiver` → `readdir-glob` (backup archives) is the only production consumer, and it is scoped so the semver-major jump does not reach dev tooling such as `glob@13`. Verified that `readdir-glob` works with minimatch 11 and that the backup tests pass. Both overrides can go once `readdir-glob` ships a release depending on a patched minimatch.
  - `node-gyp`'s `undici` dependency is bumped to `^6.29.0` to patch [CVE-2026-85024](https://github.com/advisories/GHSA-3wwx-pv8p-q78v) (affecting `6.25.0`–`6.28.0`). Scoped to `node-gyp` (reached via the dev-only `@lizenz/checker`) because the app's own direct `undici` dependency already carries the same fix on the 8.x line (8.10.2). Needed because `node-gyp` declares `undici: ^6.25.0`.
  - `eslint-plugin-react`'s `eslint` dependency is bumped to `^10.9.1` to allow ESLint v10 support. Needed because `eslint-plugin-react@7.37.2` officially supports only up to `eslint@^9.7`, but the linting rules in ESLint v10 are stricter and require updating the codebase to comply. This override is temporary — once `eslint-plugin-react` releases a new major version with official ESLint v10 support, it can be removed.
  - `fast-copy: ^4.1.0` patches [GHSA-jggr-w7fw-pc2j](https://github.com/advisories/GHSA-jggr-w7fw-pc2j) (stack exhaustion when copying deeply nested values, fixed in 4.1.0). Dev-only. Needed because `pino-pretty` declares `fast-copy: ^4.0.0`, which still allows the unpatched 4.0.0–4.0.4.
  - `postcss-selector-parser: ^7.1.6` patches [CVE-2026-104844](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) (quadratic complexity in flat selector parsing, fixed in 7.1.6). Dev-only. Needed because `@npmcli/query` declares `postcss-selector-parser: ^7.0.0`. The 6.x line has no fix; its only consumer, the unused `@tailwindcss/typography`, was removed rather than forced across a major version.
  - `body-parser: ^2.4.0` patches [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) (DoS via trailing bytes after a compressed request body, affecting `2.3.0`). Needed because `express@5.3.0` declares `body-parser: ^2.3.0`, a range that still allows the vulnerable release. The direct `multer` dependency is bumped to `^2.5.0` for [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) (DoS via a pending asynchronous `fileFilter` after request teardown, fixed in 2.5.0).
  - All of the above should be revisited (and likely removed) once the upstream packages bump their own internal dependency ranges past the vulnerable versions.
  - The `check-overrides` CI job (`npm run check:overrides`, see [`scripts/check-overrides.mjs`](https://github.com/Doezer/Questarr/blob/main/scripts/check-overrides.mjs)) checks this automatically on every PR and fails once an override is no longer needed, so there's no need to track removal manually.

## Tracking and updates

[Dependabot](https://docs.github.com/en/code-security/dependabot) is configured in [`.github/dependabot.yml`](https://github.com/Doezer/Questarr/blob/main/.github/dependabot.yml) to check for updates weekly (Monday) for both npm dependencies and GitHub Actions used in CI:

- Updates are opened as grouped pull requests (e.g. React-related packages, Radix UI components, dev vs. production dependencies, and all GitHub Actions bumps) to keep the PR volume manageable.
- Semver-major bumps are proposed automatically like any other update rather than excluded, since silently skipping them meant a major-version-only security fix could go unnoticed; they aren't folded into the minor/patch groups, so they still land as their own PR and get individual review.
- Every dependency-update PR runs through the same CI gate as any other change — lint, type check, the full test suite, and a Docker build (see [`.github/workflows/ci.yml`](https://github.com/Doezer/Questarr/blob/main/.github/workflows/ci.yml)) — before it can be merged.

## Release-time visibility

Every published Docker image ships with a generated Software Bill of Materials listing the exact versions of every dependency included in that release. See [docs/SBOM.md](SBOM.md) for how to inspect it.

## Previously blocked updates

Resolved in 1.5.0: React 19, matching React type packages, Zod 4, and
`@hookform/resolvers` 5 are supported.
