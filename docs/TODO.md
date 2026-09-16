# TODO

## Multi-user hardening

Questarr is currently designed around a single admin-style user per instance. If multi-user support becomes a real deployment scenario, revisit:

- **`/api/system/browse` has no role/ownership gate** (`server/routes/system.ts`). It lets any authenticated user browse the entire container filesystem, which is fine for a single-admin deployment but becomes an authorization gap the moment multiple users are trusted at different privilege levels. Add an admin-role check (or otherwise restrict browsing to expected library/download directories) before enabling true multi-user access.
- **`server/library-scanner.ts`'s `getGameByIgdbId()` lookups aren't scoped by owning user** in `matchUnmatchedFolder()` and `recordMatchedCandidate()` — an authenticated user can match an unmatched folder or auto-scan hit against an `igdbId` owned by a different account and have the scanner flip that game's status, overwrite its `libraryPath`, and attach files to it. Same category as the row above: not exploitable in the supported single-operator deployment, but worth an ownership check (`game.userId !== userId` → treat as not found, create a new row) if multi-user ever becomes real. See PR #1039 (closed, not applicable under current scope) for a worked fix and regression tests.
