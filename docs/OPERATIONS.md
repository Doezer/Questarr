# Operational Procedures

This document outlines the standard operating procedures for maintaining and hardening this repository.

## Verification Matrix

All pull requests and hardening passes must pass the following verification gates:

| Gate           | Command                | Requirement                                         |
| -------------- | ---------------------- | --------------------------------------------------- |
| **Build**      | `npm run build`        | Must compile without errors.                        |
| **Lint**       | `npm run lint`         | Must pass without warnings or errors.               |
| **Format**     | `npm run format:check` | Code must be formatted according to Prettier rules. |
| **Unit Tests** | `npm run test:run`     | All unit tests must pass.                           |
| **Type Check** | `npm run check`        | TypeScript compiler must pass without errors.       |

## Auto-fix & Improvement Policy

### Allowed Automatic Fixes

- Lint & formatting fixes (`prettier`, `eslint --fix`).
- Test repairs (fixing selectors, assertions, mocks).
- Small product bugfixes where tests prove a regression.
- Small, measurable UX and performance micro-optimizations.
- Adding or tightening smoke tests and improving build scripts.

### Disallowed

- Large refactors, schema/API changes.
- Adding new external services or dependencies without approval.
- Committing secrets.
- Removing tests or masking failures.

## Hardening Workflow

1.  **Inventory & Diagnose**: Check current state, run verification matrix.
2.  **Iterative Remediation**: Fix failures using the allowed policy.
3.  **Proactive Improvement**: Implement small, high-impact improvements.
4.  **Deliver Green PR**: Submit fully-tested changes.

## Windows release assets

Windows installers use the existing manual **Deploy Web App** workflow. Creating
a tag creates a draft release; it does not build or attach an installer.

Before publishing a release that advertises Windows support:

1. Wait for the matching draft GitHub release to exist.
2. Run **Deploy Web App** from the release commit with the matching `tag` input
   (for example, `v1.5.0`) and **build_windows_installer** enabled. Choose the
   deployment environment intended for that release.
3. Verify that `QuestarrSetup-<version>-windows-x64.exe` and its `.sha256` file
   are attached to the matching release. The version comes from `package.json`
   on the workflow's selected ref, so it must match the release.
4. Publish the release only after verifying its assets.

The installer job treats a missing matching release as a skipped attachment.
If that occurs, attach the executable and checksum from the workflow artifact
to the matching draft release before publishing. Tagging, dispatching the
deployment workflow, and publication remain maintainer actions.

## Weekly development pre-releases

`.github/workflows/weekly-release.yml` runs every Monday at 06:00 UTC (and on demand from the Actions tab). If `main` has new commits since the last tag it:

1. tags `main` as `v<next patch>-dev.<YYYYMMDD>` (for example `v1.5.1-dev.20261019`);
2. publishes a GitHub **pre-release** whose notes list the merged pull requests (security and dependency fixes first) and any commit pushed straight to `main`;
3. dispatches the Deploy workflow for the `dev` environment, which pushes `ghcr.io/doezer/questarr` and `doezer/questarr` images tagged with the release tag, `weekly` (moves only when a new pre-release is built; follow it to stay on the weekly build) and `dev` (moves with the daily dev build) (multi-arch), built from the tag. `latest` is only moved by production deployments.

These builds are not functionally tested. Stable releases keep using a `vX.Y.Z` tag, which creates a draft release from `docs/CHANGELOG.md` (`release.yml` ignores `-dev.` tags).

The optional Windows installer takes its file name and version from `package.json`, not from the pre-release tag.
A second run on the same day gets a `.2` suffix (`-dev.20261019.2`). A run that fails after pushing the tag resumes on the next run (the tag has no release yet).

The release is published as soon as the image build is dispatched, without waiting for it. If that build fails, run **Deploy Web App** manually with environment `dev` and the pre-release tag (leave `weekly` unchecked unless it is the newest pre-release).
