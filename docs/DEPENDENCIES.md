# Dependency Management

This document describes how Questarr selects, obtains, and tracks its dependencies.

## Selection

Dependencies are added deliberately as part of normal development, via `npm install`, and land in `package.json` alongside the feature or fix that needs them. Preference is given to actively maintained, widely used packages already common in the Node/React ecosystem. New dependencies go through the same pull request review process as any other code change (see [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)) before merging to `main`.

## Obtaining dependencies

- Packages are installed from the public [npm registry](https://www.npmjs.com/).
- `package-lock.json` is committed to the repository and used for reproducible installs — the exact resolved version of every direct and transitive dependency is pinned.
- The `packageManager` field in `package.json` pins the npm version used to install and build the project.
- The `allowScripts` field in `package.json` explicitly allowlists which packages are permitted to run install-time (postinstall) scripts. It's npm's own native field (npm ≥ 11.16.0), managed via `npm approve-scripts` / `npm deny-scripts`, not a third-party tool — today it's advisory (npm flags unreviewed scripts but still runs them), with a future npm release expected to block unapproved scripts by default. Any package added here should have a concrete reason (e.g. a native module that needs to compile a binary during install).
- The `overrides` field forces a specific version of a transitive dependency when a direct dependency's own declared range still permits a vulnerable release:
  - `socket.io-parser: 4.2.6` patches [CVE-2026-33151](https://github.com/socketio/socket.io/security/advisories/GHSA-677m-j7p3-52f9) (resource exhaustion via unbounded binary attachments). Needed because `socket.io`/`socket.io-client` declare `socket.io-parser: ~4.2.4`, a range that still allows the unpatched 4.2.4/4.2.5.
  - `@esbuild-kit/core-utils`'s `esbuild` dependency is bumped to `^0.25.0` to patch the esbuild dev-server request-forwarding issue ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)). Needed because `drizzle-kit` pulls in `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils`, which pins `esbuild: ~0.18.20`.
  - Both should be revisited (and likely removed) once the upstream packages bump their own internal dependency ranges past the vulnerable versions.
  - The `check-overrides` CI job (`npm run check:overrides`, see [`scripts/check-overrides.mjs`](../scripts/check-overrides.mjs)) checks this automatically on every PR and fails once an override is no longer needed, so there's no need to track removal manually.

## Tracking and updates

[Dependabot](https://docs.github.com/en/code-security/dependabot) is configured in [`.github/dependabot.yml`](../.github/dependabot.yml) to check for updates weekly (Monday) for both npm dependencies and GitHub Actions used in CI:

- Updates are opened as grouped pull requests (e.g. React-related packages, Radix UI components, dev vs. production dependencies, and all GitHub Actions bumps) to keep the PR volume manageable.
- Semver-major bumps are proposed automatically like any other update rather than excluded, since silently skipping them meant a major-version-only security fix could go unnoticed; they aren't folded into the minor/patch groups, so they still land as their own PR and get individual review.
- Every dependency-update PR runs through the same CI gate as any other change — lint, type check, the full test suite, and a Docker build (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) — before it can be merged.

## Release-time visibility

Every published Docker image ships with a generated Software Bill of Materials listing the exact versions of every dependency included in that release. See [docs/SBOM.md](SBOM.md) for how to inspect it.

## Currently blocked updates

Tracked here so a blocked Dependabot PR doesn't get silently re-proposed and re-investigated from scratch. Remove an entry once its update is unblocked and merged.

_As of 2026-07-04, `release/1.4.0`:_

- **`@hookform/resolvers`** `3.10.0` → `5.4.0` (PR #756) — blocked. Installs, but the TypeScript check fails in form resolver usage (`client/src/pages/downloaders.tsx`, `client/src/pages/indexers.tsx`). The project is on Zod 3 (`zod: ^3.25.0`); this upgrade likely needs resolver/schema compatibility adjustments first.
- **`@eslint/js`** `9.39.4` → `10.0.1` (PR #760) — blocked. Install fails on peer dependency resolution because ESLint is still on 9.x; needs a coordinated ESLint stack upgrade, not a standalone bump.
- **React 19** `react 18.3.1` → `19.2.7`, `@types/react 18.3.11` → `19.2.17` (PR #761) — blocked. Install fails on peer dependency resolution across UI dependencies; needs a broader compatibility pass across the React ecosystem packages first.
