# Dependency Management

This document describes how Questarr selects, obtains, and tracks its dependencies.

## Selection

Dependencies are added deliberately as part of normal development, via `npm install`, and land in `package.json` alongside the feature or fix that needs them. Preference is given to actively maintained, widely used packages already common in the Node/React ecosystem. New dependencies go through the same pull request review process as any other code change (see [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)) before merging to `main`.

## Obtaining dependencies

- Packages are installed from the public [npm registry](https://www.npmjs.com/).
- `package-lock.json` is committed to the repository and used for reproducible installs — the exact resolved version of every direct and transitive dependency is pinned.
- The `packageManager` field in `package.json` pins the npm version used to install and build the project.
- The `allowScripts` field in `package.json` explicitly allowlists which packages are permitted to run install-time (postinstall) scripts. Any package not on that list has its scripts blocked by default, limiting the blast radius of a compromised transitive dependency.
- The `overrides` field is used to force a specific version of a transitive dependency when needed (e.g. pinning `socket.io-parser` to a patched release).

## Tracking and updates

[Dependabot](https://docs.github.com/en/code-security/dependabot) is configured in [`.github/dependabot.yml`](../.github/dependabot.yml) to check for updates weekly (Monday) for both npm dependencies and GitHub Actions used in CI:

- Updates are opened as grouped pull requests (e.g. React-related packages, Radix UI components, dev vs. production dependencies, and all GitHub Actions bumps) to keep the PR volume manageable.
- Semver-major bumps are proposed automatically like any other update rather than excluded, since silently skipping them meant a major-version-only security fix could go unnoticed; they aren't folded into the minor/patch groups, so they still land as their own PR and get individual review.
- Every dependency-update PR runs through the same CI gate as any other change — lint, type check, the full test suite, and a Docker build (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) — before it can be merged.

## Release-time visibility

Every published Docker image ships with a generated Software Bill of Materials listing the exact versions of every dependency included in that release. See [docs/SBOM.md](SBOM.md) for how to inspect it.
