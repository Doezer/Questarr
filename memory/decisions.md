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
