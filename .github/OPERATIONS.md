# Operational Procedures

This document outlines standard operating procedures for maintaining the Questarr repository.

## Verification Matrix

Before submitting any changes, run the following verification steps:

1.  **Build & Install**: Ensure `npm install` and `npm run build` succeed.
2.  **Linting**: Run `npm run lint` and ensure there are no errors or warnings.
3.  **Type Checking**: Run `npm run check` to verify TypeScript types.
4.  **Tests**: Run `npm test` to execute unit and integration tests. All tests must pass.

## Release Process

1.  Ensure all changes are committed and pushed to the main branch.
2.  Verify that CI/CD pipelines have passed.
3.  Create a release tag (e.g., `v1.0.x`).
4.  Deploy to production environment (if applicable).

## Emergency Procedures

In case of a critical failure:

1.  **Rollback**: Revert the last commit or deploy the previous stable version.
2.  **Diagnose**: Analyze logs to identify the root cause.
3.  **Fix**: Implement a fix and run the verification matrix.
4.  **Deploy**: Deploy the fix.
