# Dependencies Update

Date: 2026-07-04
Branch: `release/1.4.0`

## @hookform/resolvers

- Target: `3.10.0` -> `5.4.0` (PR #756)
- Status: **Blocked**
- Result on current branch: installs, but TypeScript check fails in form resolver usage (`client/src/pages/downloaders.tsx`, `client/src/pages/indexers.tsx`).
- Notes: project currently uses Zod 3 (`zod: ^3.25.0`), and this upgrade likely requires resolver/schema compatibility adjustments.

## @eslint/js

- Target: `9.39.4` -> `10.0.1` (PR #760)
- Status: **Blocked**
- Result on current branch: install fails with peer dependency resolution because ESLint is still on 9.x.
- Notes: this requires a coordinated ESLint stack upgrade, not a standalone bump.

## React 19

- Target: `react 18.3.1` -> `19.2.7` and `@types/react 18.3.11` -> `19.2.17` (PR #761)
- Status: **Blocked**
- Result on current branch: install fails due to peer dependency resolution across UI dependencies.
- Notes: this needs a broader compatibility pass across the React ecosystem packages before upgrading.
