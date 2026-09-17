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

## [2026-09-15] HTTP credential transmission policy: CI build and pre-merge fixes

**Context:** PR #1022 implements per-indexer and per-downloader control over HTTP credential transmission (API keys, passwords). The PR had a CI build failure on commit 4c86a3f due to using `requireHttps` parameter in `safeFetch()` without first implementing it.

**Choice:** Added `requireHttps?: boolean` parameter to `SafeFetchOptions` type and implemented logic in `safeFetch()` to reject HTTPS-to-HTTP redirects when `requireHttps` is enabled, preventing credential leakage through downgrade attacks. Also fixed TypeScript errors where `allowInsecureLan` field was missing from Indexer and Downloader object creation in `routes.ts` and `storage.ts`. Applied both fixes on copilot/define-http-indexer-policy branch (commit f727a76).

**Rationale:** The CI failure was blocking the PR. Fixing it unblocks the review process. However, CodeRabbit pre-merge checks identified additional issues: (1) SonarCloud code duplication at 5.6% vs 3% threshold, (2) missing documentation for the allowInsecureLan option, (3) docstring coverage at 55.56% vs 80% threshold, (4) scope concern: downloader changes may belong in separate PR per issue #1005 scope. These remain unresolved and require further work.

**Remaining work:** Address SonarCloud duplication, add user-facing documentation of allowInsecureLan for indexers and downloaders (warn it sends credentials over cleartext HTTP), add docstrings to reach 80% coverage, consider splitting downloader-specific changes into separate PR (#1005 is indexer-focused per CodeRabbit).

## [2026-09-15] PR #1022 Security fixes: API key redirect protection and pre-merge status

**Context:** Continued work on PR #1022. Previous session had fixed CI build failures by implementing requireHttps parameter in safeFetch() and adding missing allowInsecureLan fields. CodeRabbit review identified additional security concerns and scope issues. New commit adds HTTPS-to-HTTP downgrade protection for API key requests in Torznab and Newznab.

**Latest work (commit 6b6a2a3):**

- Added `requireHttps` protection to Torznab searchGames() and Newznab search() methods
- When API key is sent (indexerAllowsApiKey returns true) AND origin URL is HTTPS, requireHttps is set to true
- Prevents HTTPS-to-HTTP redirect downgrades that could leak API keys
- All indexer-related tests pass (226 tests across torznab.test.ts, newznab.test.ts, indexer-caps.test.ts)

**Current blockers:**

1. **SonarCloud code duplication** — 5.5% on new code (required ≤ 3%). Large PR scope (381 commits from main) makes it difficult to identify source. Likely duplication in XML parsing logic between Newznab and Torznab caps category discovery.
2. **Test failures on older commits** — test-1 and test-4 failed on commit e9e3bc2 (earlier work), not on latest commit
3. **Downloader scope** — CodeRabbit flags that downloader credential changes (schema, migration, UI, server, tests) should be in separate PR tied to a downloader credential-policy issue; PR #1005 is indexer-focused
4. **Missing product documentation** — allowInsecureLan option needs explanation that it sends API keys over cleartext HTTP and should only be used on trusted LANs
5. **Docstring coverage** — Currently 60% on touched functions, need 80%

**Architectural decisions pending:**

- Should downloader changes be removed from this PR as CodeRabbit recommends?
- Should the PR be rebased to reduce from 381 commits?
- What refactoring approach for SonarCloud duplication (extract shared parsing to utility, base class, etc.)?
- Should product documentation be user-facing (UI tooltip/help) or in docs/README?

## [2026-09-17] Library-side archive extraction, redone from scratch against current `main` (supersedes closed PR #809)

**Context:** PR #809 (`library-side-extraction`, opened 2026-07-19) implemented the same feature this entry covers, but the branch sat untouched for ~2 months while `main` independently rewrote every file it touched: `ArchiveService.ts` dropped the `node-7z` npm library for direct `execFile` invocation of resolved 7-Zip/unrar binaries and gained password-protected-archive detection (`ArchivePasswordRequiredError`) with read-race retry logic; `ImportManager.ts` gained password-required propagation and `sortExtras` file-categorization; `ImportStrategies.ts` gained its own independent per-file hardlink implementation (`hardlinkTree`) with broader errno fallback handling. A test-merge of `main` into the old branch produced conflicts in 7 of 11 changed files, including 8 separate hunks in `ImportManager.ts` alone spanning the exact control flow this feature rewrites. Closed #809 and reimplemented the feature fresh on top of current `main` rather than attempting a mechanical rebase, since that risked silently dropping either side's work.
**Choice:**

- Ported `findVolumeSiblings`/`isAlreadyExtracted`/`listEntries` from the old PR's `ArchiveService.ts` (which used `node-7z`) onto the new CLI-exec architecture. `listEntries` always shells out to **7-Zip** (`7z l -slt`), even for `.rar` — extraction still routes `.rar` to unrar, but 7-Zip's `-slt` output has a stable block-per-entry format regardless of archive type, and 7-Zip has read-only RAR (including RAR5) support built in, so a second listing code path for unrar's own column-aligned `l`/`v`/`lb` commands (whose exact layout isn't safe to assume across builds, and couldn't be verified here — CI has no 7z/unrar binary; only the production Docker image installs one) wasn't needed. Verified the parser and the `.partN.rar` stem-derivation fix against a real 7-Zip binary installed ad hoc in the dev sandbox (not part of the repo/CI).
- Fixed a second instance of the same stem-derivation bug the old PR only half-fixed: `findVolumeSiblings` also failed to match `.7z.NNN`/`.zip.NNN` split volumes when the archive path passed in was itself the first numbered volume (e.g. `Game.7z.001`, which 7-Zip splits produce with no separate `Game.7z`) — same root cause as the `.partN.rar` case, just for a different volume-naming scheme. Combined all volume-suffix patterns into one stripping regex instead of two sequential special cases.
- `ImportStrategies.ts`'s directory transfer now takes an `excludePaths` param needed for volume-sibling/already-extracted exclusion, but the existing whole-tree `hardlinkTree` fallback path (added on `main` since the old PR) only goes per-file when `excludePaths` is non-empty — preserves `main`'s current atomic-ish whole-tree-copy-on-fallback behavior for the common case instead of always falling back file-by-file.
- `sortExtras` (file categorization) doesn't exist for an archive being unpacked — the old PR never accounted for it since it predates that feature. Rather than threading `fileCategories` through archive resolution, added a `reorganizeBySortExtras` post-pass that runs after extraction lands files at the destination and moves them into category subfolders in place — same categorization logic (`categorizeDownload`), applied after the fact instead of before.

**Known limitation carried over unchanged from the old PR:** the archive-entry chosen as "main" for a directory source is `archiveEntries[0]` after an alphabetical `.sort()` on filenames — for classic `.rNN` RAR sets this can pick `Game.r00` over `Game.rar` (`'0' < 'a'`), not a regression introduced by this rewrite, pre-existing in both versions.
