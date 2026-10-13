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
