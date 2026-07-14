# Decisions

Track architectural, technical, and design decisions made during development.

<!-- Format:
## [Date] Decision Title
**Context:** Why this decision was needed
**Choice:** What was decided
**Rationale:** Why this option was chosen over alternatives
-->

## [2026-07-02] Synology Download Station: adopt Prowlarr's reverse-engineered API contract

**Context:** Synology's DS2 (`SYNO.DownloadStation2.Task`) API is undocumented beyond field names. Two prior fix attempts (a POST/`uri`-based patch, then a literal field-reordering spec) each turned out to diverge from the real undocumented contract once checked against Prowlarr's production C# client (fetched live via `gh api`).
**Choice:** Implemented Prowlarr's verified contract in `server/downloaders/synology.ts`: URL/magnet adds go out as GET (not POST); DS2 file uploads use JSON-quoted `type`/`file`/`destination` params with bytes under a `fileData` field (not `file`) appended last and `_sid` moved to the query string; legacy (v1) file uploads use API version 2 specifically (other legacy calls use v3). Full contract documented in `docs/synology-download-station-api-notes.md`, including the two superseded approaches kept as fallback reference in case a user's device doesn't match Prowlarr's contract.
**Rationale:** No real Synology device was available to test against, so trusting a live, widely-deployed \*arr project's production code over our own guesses was the best available evidence. User explicitly chose "adopt Prowlarr's contract, consign the earlier approaches to a doc" over keeping the simpler literal spec.

## [2026-07-13] Library file deletion trusts a stored path against the _current_ libraryRoot

**Context:** Added `games.libraryPath` (persisted by `ImportManager.finalizeImport`) and wired `DELETE /api/games/:id?deleteFiles=true` to delete it via `fs-extra`, gated by a containment check that resolves `game.libraryPath` against `storage.getImportConfig(userId).libraryRoot` at delete time.
**Choice:** Shipped with a lexical `path.resolve` containment check only (`resolvedTarget === resolvedRoot || startsWith(resolvedRoot + path.sep)`), skip-and-log-warning on failure, no user-facing error surfaced.
**Known limitation:** If the user reconfigures `libraryRoot` after games were already imported (new drive, remounted Docker volume), every previously-stored `libraryPath` will fail containment against the _new_ root — deletion silently no-ops for those games with nothing visible in the UI, only a server log line. A manual smoke test of the real import → delete flow was not performed this session (only mocked unit tests); this gap was not caught by tests. If library reorganization becomes common, consider a reconciliation job that flags games whose `libraryPath` no longer exists or no longer resolves under the current root, and surface skipped deletions to the caller instead of only logging.
