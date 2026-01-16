# Operational Procedures

This document outlines the standard operating procedures for maintaining and hardening the `Doezer/Questarr` repository.

## Verification Matrix

Before creating a Pull Request, the following checks must be performed:

1.  **Build & Install**: `npm install && npm run build` - Must pass without errors.
2.  **Linters**: `npm run lint` - Must pass with 0 errors and preferably 0 warnings.
3.  **Type Checks**: `npm run check` - Must pass.
4.  **Unit & Integration Tests**: `npm run test:run` - All tests must pass.
5.  **Test Coverage**: Ensure no regression in test coverage.

## Auto-fix Policy

### Allowed Automatic Fixes
- Lint & formatting fixes (prettier, eslint --fix).
- Test repairs (fixing selectors, assertions, mocks).
- Small product bugfixes where tests prove a regression.
- Small, measurable UX and performance micro-optimizations.

### Disallowed
- Large refactors.
- Schema/API changes without prior approval.
- Adding external services.
- Committing secrets.
- Removing tests to make the build pass.

## Release Process

1.  Ensure all checks in the Verification Matrix are green.
2.  Create a PR with a descriptive title and body (following `.github/PR_TEMPLATE.md`).
3.  Upon approval, merge the PR.
