# Operational Procedures

This document outlines the standard operating procedures for maintaining and hardening this repository.

## Verification Matrix

All pull requests and hardening passes must pass the following verification gates:

| Gate | Command | Requirement |
|------|---------|-------------|
| **Build** | `npm run build` | Must compile without errors. |
| **Lint** | `npm run lint` | Must pass without warnings or errors. |
| **Format** | `npm run format:check` | Code must be formatted according to Prettier rules. |
| **Unit Tests** | `npm run test:run` | All unit tests must pass. |
| **Type Check** | `npm run check` | TypeScript compiler must pass without errors. |

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
