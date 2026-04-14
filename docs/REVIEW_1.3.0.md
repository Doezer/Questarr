# Bug Review Checklist — Release 1.3.0

Files identified from `git diff main...HEAD` ranked by change volume, module criticality, and correspondence to known bug fix commits.

---

## Backend — Top 10 Files to Review

| #   | File                                         | Why                                                                                                   |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `server/routes.ts`                           | +850 lines across all API endpoints — highest risk surface for regressions                            |
| 2   | `server/cron.ts`                             | +704 lines — auto-search, download status checks, xREL monitoring; blacklist/platform logic runs here |
| 3   | `server/downloaders.ts`                      | +604 lines — multi-client rewrite, NZB `files` attribute fix, rTorrent path changes                   |
| 4   | `server/storage.ts`                          | +408 lines — DB access layer; new fields from migrations can cause subtle query bugs                  |
| 5   | `server/igdb.ts`                             | +238 lines — platform pagination rewrite + new metadata fields; cache invalidation risk               |
| 6   | `server/migrate.ts`                          | +199 lines — SQL statement handling fix; migration failures are silent and hard to diagnose           |
| 7   | `server/search.ts`                           | Core of download search; preferred platform + blacklist filtering changes land here                   |
| 8   | `shared/schema.ts`                           | 11 new migrations applied — schema drift between Drizzle types and actual DB is a common bug source   |
| 9   | `server/steam.ts` / `server/steam-routes.ts` | Steam wishlist sync rewrite after removing Steam API key                                              |
| 10  | `server/rss.ts`                              | SSRF fix + RSS feed item changes; security patches often introduce edge-case regressions              |

---

## Frontend — Top 10 Files to Review

| #   | File                                           | Why                                                                                                         |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `client/src/components/GameDetailsModal.tsx`   | +1148 lines — full tabbed UI rewrite; X button close bug, download tab not updating, overflow bugs all here |
| 2   | `client/src/components/GameDownloadDialog.tsx` | +876 lines — blacklist + preferred platform logic, "has results" badge, complex filter interaction          |
| 3   | `client/src/components/Dashboard.tsx`          | +638 lines — view controls refactor, download indicators, multiple visual regressions possible              |
| 4   | `client/src/pages/settings.tsx`                | +540 lines — preferred release groups, platform selection, Discord webhook, many new form sections          |
| 5   | `client/src/components/ClaimBatchModal.tsx`    | +449 lines (new) — new feature with no prior code to build on; untested edge cases likely                   |
| 6   | `client/src/components/ClaimDownloadModal.tsx` | +330 lines (new) — download linking modals are complex stateful flows                                       |
| 7   | `client/src/pages/wishlist.tsx`                | +335 lines — unreleased game toggle, section reordering, filter interactions                                |
| 8   | `client/src/pages/xrel-releases.tsx`           | +326 lines — xREL monitoring UI; relatively isolated but heavily changed                                    |
| 9   | `client/src/pages/downloads.tsx`               | +248 lines — source filter toggle, case-insensitive hash comparison, Questarr-only filter                   |
| 10  | `client/src/components/GameCard.tsx`           | +199 lines — "has results" icon fix, year vs date display, rating N/A logic; visually critical              |

---

## Highest Priority

These four files are the largest changes and directly correspond to the bugs listed in the fix commits:

- `client/src/components/GameDetailsModal.tsx`
- `client/src/components/GameDownloadDialog.tsx`
- `server/routes.ts`
- `server/cron.ts`

---

# Frontend Bug Findings — Files 1–5

---

## 1. `GameDetailsModal.tsx`

### Critical

| ID    | Line    | Description                                                                                                                                                                                                                                                                                                                                    | Category          |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| GDM-1 | 435     | `return null` guard unmounts the `<Dialog>` while parent `open` state is still `true`. Radix never gets to fire `onOpenChange(false)`, so the X button stops working and the modal cannot be closed. Fix: always render `<Dialog open={open}>` and gate `<DialogContent>` on `game != null`.                                                   | Event handling    |
| GDM-2 | 330–340 | No socket listener for download status changes. The per-game downloads query has `refetchInterval: 5000` but no real-time invalidation — confirmed cause of "download status not updated in the Downloads tab". Fix: add a `useEffect` that subscribes to socket events and calls `queryClient.invalidateQueries` for the game's download key. | State / Real-time |

### High

| ID    | Line | Description                                                                                                                                                                                                                     | Category    |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| GDM-3 | 327  | `isSummaryExpanded` is never reset when `game` prop changes. Opening a second game after expanding the first shows it pre-expanded. Fix: reset in a `useEffect` on `game?.id`.                                                  | Stale state |
| GDM-4 | 327  | `isSummaryExpanded` not reset when modal closes and reopens for the same game. Fix: reset when `open` becomes `false`.                                                                                                          | Stale state |
| GDM-5 | 324  | `selectedScreenshot` (lightbox) persists across modal close. An orphaned open lightbox can surface for the next game. Fix: reset when `open` becomes `false`.                                                                   | Stale state |
| GDM-6 | 325  | `downloadOpen` not reset on modal close — `GameDownloadDialog` renders immediately open on next game. Fix: reset when `open` becomes `false`.                                                                                   | Stale state |
| GDM-7 | 611  | Long unbroken text (e.g. URLs in descriptions) overflows the summary container when expanded. `break-words` alone is insufficient. Fix: add `overflow-hidden` to the container and use `[overflow-wrap:anywhere]` on the `<p>`. | UI / Layout |

---

## 2. `GameDownloadDialog.tsx`

### Critical / P1

| ID    | Line         | Description                                                                                                                                                                                                                                                                                                            | Category           |
| ----- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| GDD-1 | 312          | `minSeeders > 0` silently hides **all NZB/Usenet results** because `seeders` is always `undefined` for them and `t.seeders ?? 0` evaluates to `0`. Fix: `.filter(t => isUsenetItem(t) \|\| (t.seeders ?? 0) >= minSeeders)`.                                                                                           | Filtering / Logic  |
| GDD-2 | 77–98        | `DownloadItem` interface is missing `downloadType: "torrent" \| "usenet"` (present on the server's `SearchItem`). Forces all NZB detection through an unreliable heuristic — root cause of the "files attribute for NZBs doesn't work" bug. Fix: add `downloadType` to the interface and prefer it over the heuristic. | Data model / Logic |
| GDD-3 | 485–496, 637 | Bundle dialog iterates `categorizedDownloads.update` (unfiltered) instead of `filteredCategorizedDownloads.update`. Active platform/seeder filters are ignored for update bundles — wrong-platform updates can be downloaded.                                                                                          | Filtering / Logic  |

### High / P2

| ID    | Line                   | Description                                                                                                                                                                                                                                    | Category               |
| ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| GDD-4 | 194–213                | `applyDownloadRules` runs before `userSettings` resolves on first open (query just triggered). Platform preselection is silently skipped when settings are not cached. Fix: ensure `userSettings` is a dependency that re-triggers the effect. | State / Race condition |
| GDD-5 | downloads-utils.ts:328 | `isUsenetItem` heuristic misclassifies items that have neither `grabs` nor `age` (returns `false`), so their `files` badge is never rendered.                                                                                                  | Logic                  |

---

## 3. `Dashboard.tsx`

### High / P1

| ID    | Line | Description                                                                                                                                                                                                                                                                                                                                                              | Category          |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| DSH-1 | 385  | Empty-state condition `filteredGames.length === 0 && debouncedSearchQuery.trim()` ignores active status/genre/platform filters. When filters produce zero results with no search query, the component falls through to `<GameGrid>` instead of a useful empty state. The "Add game" prompt also surfaces when the zero result is caused by a filter, not a missing game. | Logic / Rendering |

### Medium / P2

| ID    | Line    | Description                                                                                                                                                                                                                                                                | Category         |
| ----- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| DSH-2 | 393     | `<AddGameModal initialQuery={searchQuery}>` passes the raw un-debounced value; the button label displays `debouncedSearchQuery`. They can briefly differ during fast typing. Fix: use `debouncedSearchQuery` for both.                                                     | State / UI       |
| DSH-3 | 139–142 | `useEffect` cleanup clears the add-game store on **every keystroke** (not just unmount), creating a brief window where the store is empty. If the header modal opens in that window, pre-fill is lost. Fix: separate the store-clear into a dedicated unmount-only effect. | State management |

### Low / P3

| ID    | Line | Description                                                                                                                          | Category |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| DSH-4 | 135  | `libStats.totalGames` is always the full library count, shown alongside "X of Y shown" when filters are active — misleading heading. | UI / UX  |

---

## 4. `settings.tsx`

### High / P1

| ID    | Line                  | Description                                                                                                                                                                                                                                                                                                                      | Category      |
| ----- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| SET-1 | 528–538, 188–190      | IGDB save is blocked when the account is already configured because `igdbClientSecret` is always cleared to `""` on load (server never returns the secret). A user updating only their Client ID gets a "provide both fields" error and cannot save. Fix: allow save when already configured and at least one field has a value. | Form handling |
| SET-2 | 145, 181–183, 499–506 | `xrelApiBase` is only set if `config.xrel` exists. If it is absent (never configured or still loading), saving sends `apiBase: undefined`, silently wiping a previously stored value. Fix: only update the state field when `config.xrel.apiBase` is explicitly defined.                                                         | Form state    |

### Medium / P2

| ID    | Line      | Description                                                                                                                                                                                                                                                         | Category      |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| SET-3 | 1286–1298 | Discord webhook show/hide toggle is an icon-only button with no `aria-label` — violates the project accessibility guidelines (equivalent buttons for Nexus/IGDB have labels). Fix: add `aria-label={showDiscordWebhook ? "Hide webhook URL" : "Show webhook URL"}`. | Accessibility |
| SET-4 | 783, 1229 | "Save Auto-Search" and "Save Advanced Settings" share a single `updateSettingsMutation` instance — both buttons show a spinner and disable simultaneously when either is saving. Fix: use two separate mutation instances.                                          | UI / State    |

---

## 5. `ClaimBatchModal.tsx`

### Critical / P1

| ID    | Line    | Description                                                                                                                                                                                                                                                                                                                                                                               | Category           |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| CBM-1 | 409–415 | When the user selects an IGDB result, `selectedGame.id` is set to `g.igdbId?.toString()` (an IGDB numeric string). If this value is later sent as `gameId` to the API (e.g. on retry), the DB UUID lookup returns 404 and the claim silently fails. Fix: set `id: undefined` for IGDB-sourced games — the `source: "igdb"` field already signals that `newGame` should be used.           | Logic / API params |
| CBM-2 | 199–201 | `progress` in the `onSuccess` closure is the stale React state from the render that triggered `mutate()`. The toast always reports "0 group(s) linked". Fix: return the processed count from `mutationFn` and read it as the `onSuccess` argument.                                                                                                                                        | State / Async      |
| CBM-3 | 127–196 | If any `apiRequest` throws mid-loop, already-processed groups are claimed but remaining ones are not, with no per-group feedback. Worse: if `apiRequest` resolves with an error body (non-throwing), `firstResult?.gameId` is `undefined` and subsequent downloads in the same group create duplicate game rows. Fix: check `firstResult?.gameId` before proceeding and throw on failure. | Error handling     |

### High / P2

| ID    | Line     | Description                                                                                                                                                                                                                                                       | Category            |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| CBM-4 | 83–106   | `groupStates` is never cleared when the modal closes. Re-opening shows stale `selectedGame`, `igdbQuery`, and `igdbOpen` state from the previous session, even when the scan returns different data. Fix: reset `groupStates` in a `useEffect` on `open → false`. | Stale state         |
| CBM-5 | 409, 414 | Structural ambiguity: `selectedGame.id` is typed as `string \| undefined` and used for both DB UUIDs and IGDB numeric strings. Same root as CBM-1, documented separately as the interface-level cause.                                                            | Logic / Type safety |
| CBM-6 | 403–443  | No "no results" message when the IGDB search returns an empty array. The panel is blank, which looks broken. Fix: add an explicit empty state when `igdbResults.length === 0 && igdbDebouncedQuery.trim().length > 2`.                                            | UI / Edge case      |

### Medium / P2

| ID    | Line    | Description                                                                                                                                                                                                  | Category            |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| CBM-7 | 409     | React `key` for IGDB results uses `g.igdbId ?? g.id` — both can be `undefined` for unsaved games, producing duplicate/missing keys and potential rendering bugs. Fix: use `g.igdbId?.toString() ?? g.title`. | Logic               |
| CBM-8 | 199–204 | `onOpenChange(false)` is called on `onSuccess` regardless of whether individual `apiRequest` calls silently failed (see CBM-3). Modal closes with no indication of partial failure.                          | Error handling / UX |

### Low / P3

| ID     | Line         | Description                                                                                                                                                    | Category         |
| ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| CBM-9  | 301–306, 363 | Clicking "Change" resets `igdbQuery` to `""` but `igdbDebouncedQuery` still holds the previous value for 500ms — the old search fires briefly before clearing. | State management |
| CBM-10 | 318          | `group.downloads[0]` is accessed without a length guard. If the server returns a group with no downloads, `mainDownload` is `undefined` and line 381 crashes.  | Null safety      |

---

## 6. `ClaimDownloadModal.tsx`

### High / P2

| ID    | Line         | Description                                                                                                                                                                                                                                                                                     | Category          |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| CDM-1 | 247–259      | When `igdbId` is `null`/`undefined` on an IGDB result, `selectedGame.id` falls back to `g.id` which is the sentinel string `"igdb-12345"` — never a valid DB UUID. Multiple results without `igdbId` would all satisfy the selection equality check simultaneously, corrupting highlight state. | Logic / Edge case |
| CDM-2 | 69–78        | Mutation state (`isError`, `error`) is never reset between modal opens. A previous failure is still visible on re-open until the user interacts. Fix: call `claimMutation.reset()` in the open `useEffect`.                                                                                     | State management  |
| CDM-3 | 100–111, 242 | IGDB query `enabled` guard is `> 2` (3+ chars) but when the user deletes back to 2 chars, `igdbResults` still holds the stale 3-char results (query frozen, not cleared). The "no results" empty state is not shown and old results remain visible.                                             | State / UI        |
| CDM-4 | 141          | `source: "api"` in the `newGame` body is silently stripped by Zod on the server (field not in schema). All IGDB-claimed games are stored with `source = "manual"`.                                                                                                                              | Logic             |

### Medium / P3

| ID    | Line             | Description                                                                                                          | Category       |
| ----- | ---------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- |
| CDM-5 | 100–111, 239–244 | No distinct error state when IGDB search API fails — user sees "No results found" instead of a search error message. | Error handling |
| CDM-6 | 185–265          | No way to deselect a chosen game without closing the modal. An accidental selection is irreversible mid-session.     | UX / Edge case |

---

## 7. `wishlist.tsx`

### Critical / P1

| ID    | Line | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Category          |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| WSH-1 | 185  | Empty-state gate checks `wishlistGames.length === 0` instead of `filteredGames.length === 0`. `wishlistGames` ignores `showDownloadsOnly`, so when that filter produces zero results the empty state never shows — three `<GameGrid>` "No games found" fallbacks render inside their sections instead. Second failure: when `showUnreleased` is `false` and the user only has upcoming/TBA games, all section guards evaluate to `false` but `wishlistGames.length > 0`, so a completely blank page renders with zero user feedback. | Filtering / State |

### High / P2

| ID    | Line  | Description                                                                                                                                                                                                                        | Category       |
| ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| WSH-2 | 75–84 | `showSearchResultsOnly` and `showDownloadsOnly` filters are independently toggleable and silently combine as AND. No UI indication that both are active simultaneously; users see unexpectedly narrow results with no explanation. | Filtering / UX |

---

## 8. `xrel-releases.tsx`

### Critical / P1

| ID    | Line    | Description                                                                                                                                                                                                                                                                                                                             | Category    |
| ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| XRL-1 | 221–227 | `rel.matchCandidate.title` accessed without a null guard in both the `disabled` prop and the `title` attribute. TypeScript narrowing from an outer ternary does not carry into JSX attribute closures in all TS versions — potential runtime crash when `addGameMutation.isPending` is `true` for one card and another card re-renders. | Null safety |

### High / P2

| ID    | Line          | Description                                                                                                                                                                                                                              | Category           |
| ----- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| XRL-2 | 265, 259, 270 | Local `page` state not synced to server `current_page`. If the xREL API clamps an out-of-range page request, `page` stays high while `current_page` is lower — "Next" button stays enabled but the server keeps returning the last page. | State / Pagination |
| XRL-3 | 220–233       | Single `addGameMutation` instance shared across all rows: `isPending` becomes `true` for every card when any one is clicked. Two rows with the same `matchCandidate.title` both show a spinner.                                          | UI / State         |
| XRL-4 | 99            | `invalidateQueries` with partial key invalidates all cached pages, but only the active page auto-refetches. Other pages show a stale "Add" button after a game is added.                                                                 | Data fetching      |
| XRL-5 | 43–46         | `formatSize` divides by 1024 when `unit === "GB"` — the value is already in GB and gets converted a second time, displaying e.g. `2 GB` as `0.0 GB`.                                                                                     | Logic              |

### Medium / P3

| ID    | Line    | Description                                                                                                                                                                                                      | Category      |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| XRL-6 | 155–169 | No `isFetching` guard on the empty-state — "No releases found" flashes briefly during page transitions before new data arrives.                                                                                  | Loading state |
| XRL-7 | 254     | Pagination bar hidden when `totalPages === 1` even if `page > 1` (e.g. via history). User is stuck on an unreachable page with no navigation controls. Fix: show pagination when `page > 1 \|\| totalPages > 1`. | Pagination    |
| XRL-8 | 241–249 | External "View" link has no `aria-label` — violates project accessibility guidelines (every row reads as "View" with no context).                                                                                | Accessibility |

---

## 9. `downloads.tsx`

### Critical / P1

| ID   | Line    | Description                                                                                                                                                                                                                                                                                       | Category         |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| DL-1 | 163–196 | `hasShownErrors` (`useState`) is in the `useEffect` dependency array and mutated inside the same effect — creates a re-render loop. Every 5 s poll cycle re-toasts already-shown errors. Fix: replace `useState` with `useRef` for the deduplication set and remove it from the dependency array. | State management |

### High / P2

| ID   | Line                | Description                                                                                                                                                                                                                                                                                      | Category                |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| DL-2 | 760–790             | Empty-state message never mentions the active `questarrFilter`. When "Questarr only" hides all downloads, the user sees "try adjusting filters" with no hint about the source filter.                                                                                                            | UI / Filtering          |
| DL-3 | 341–354             | `downloaderSummaries` is computed from raw `downloads`, not `filteredDownloads`. Status pill counts shown in the summary bar don't reflect active type/source filters — counts and visible cards disagree.                                                                                       | Logic / Filtering       |
| DL-4 | routes.ts:2174–2176 | Server-side hash comparison inconsistent between `/api/downloads` (two probes: raw + lowercase) and `/api/downloads/scan` (full lowercase normalisation). The two endpoints can disagree on which downloads are "tracked by Questarr", causing the source filter to silently mis-classify items. | Logic / Hash comparison |
| DL-5 | 664–684             | Pause button renders for terminal statuses (`completed`, `error`, `seeding`) where pause is meaningless and will cause a downloader API error. Fix: only show pause/resume for `downloading`, `paused`, `repairing`, `unpacking`.                                                                | UI / Logic              |

### Medium / P3

| ID   | Line         | Description                                                                                                                                                                              | Category           |
| ---- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| DL-6 | 116, 795–803 | `selectedDownload` set once on click and never updated during polling. If the modal relies on the passed object, the user sees stale progress/status for the lifetime of the open modal. | State / Stale data |
| DL-7 | 151–159      | `categoryBannerEntries` keyed by `downloaderName` instead of `downloaderId`. Two downloaders with the same name collide and only the first category is recorded.                         | Logic / Edge case  |

---

## 10. `GameCard.tsx`

### High / P1

| ID   | Line     | Description                                                                                                                                                                                                           | Category          |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| GC-1 | 253, 256 | `game.rating ?` is a truthiness check — `rating: 0` (valid IGDB score) renders as "N/A" / "Not rated". Fix: use `game.rating != null`.                                                                                | Logic / Edge case |
| GC-2 | 286, 290 | `new Date(isoDateString).getFullYear()` returns the wrong year in UTC− timezones (e.g., `"2024-01-01"` parses as UTC midnight → `2023` in UTC−5). Fix: extract the year directly from the string with `.slice(0, 4)`. | Logic / Edge case |

### Medium / P2

| ID   | Line    | Description                                                                                                                                                          | Category          |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| GC-3 | 300–308 | `Array.map()` always returns a truthy array; empty `genres: []` never triggers the `\|\| "No genres"` fallback. Fix: use an explicit length check instead of `\|\|`. | Logic / Rendering |

---

## Consolidated Priority Matrix — Frontend (All 10 Files)

| Priority | Severity | Bug IDs                                                                    |
| -------- | -------- | -------------------------------------------------------------------------- |
| P1       | Critical | GDM-1, GDM-2, GDD-1, GDD-2, GDD-3, CBM-1, CBM-2, CBM-3, WSH-1, XRL-1, DL-1 |
| P1       | High     | DSH-1, SET-1, SET-2, CBM-4, CBM-5, GC-1, GC-2                              |
| P2       | High     | GDM-3…7, GDD-4, CBM-6, CDM-1…4, WSH-2, XRL-2…5, DL-2…5                     |
| P2       | Medium   | DSH-2, DSH-3, SET-3, SET-4, CBM-7, CBM-8, GC-3, XRL-6, XRL-7               |
| P3       | Low–Med  | DSH-4, GDD-5, CBM-9, CBM-10, CDM-5, CDM-6, XRL-8, DL-6, DL-7               |

---

# Backend Bug Findings — Files 1–10

---

## 1. `server/routes.ts`

### Critical / P1

| ID   | Line                           | Description                                                                                                                                                                                                                                                         | Category              |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| RT-1 | 984–1009, 1012–1036, 1157–1177 | `PATCH /api/games/:id/status`, `PATCH /api/games/:id/hidden`, `DELETE /api/games/:id` perform no ownership check. Any authenticated user can mutate or delete any other user's game by knowing the UUID. Fix: verify `game.userId === req.user.id` before mutating. | Auth / Data integrity |

### High / P2

| ID   | Line                                 | Description                                                                                                                                                                                             | Category               |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| RT-2 | 761                                  | `GET /api/config` is registered **before** the global `app.use("/api", authenticateToken)` middleware at line 804. Unauthenticated callers can read IGDB configuration status and xREL API base URL.    | Auth / Info disclosure |
| RT-3 | storage.ts:1248                      | `updateGamesBatch` does not await its `db.transaction()` call. Errors inside the transaction are silently swallowed; the caller's error counter never fires.                                            | Data integrity         |
| RT-4 | storage.ts:1256–1259, routes.ts:1157 | `removeGame` always returns `true` — a DELETE on a non-existent game ID silently returns 204, masking race conditions.                                                                                  | Data integrity         |
| RT-5 | 2401                                 | `resolvedGameId` used via `!` non-null assertion before guaranteed assignment in the claim handler — uninitialized variable access, works by accident (`!undefined === true`), fragile under strict TS. | Logic                  |

---

## 2. `server/cron.ts`

### Critical / P1

| ID   | Line                   | Description                                                                                                                                                                                                                                                                                                                                                                                  | Category              |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| CR-1 | 527–547                | Download status transitions (e.g. `downloading→paused`, `downloading→failed`) update the DB but never emit a Socket.io event. The frontend has no real-time signal to invalidate the downloads query. Root cause of "download status not updated in the game details tab". Fix: emit `downloadUpdate` socket event after every status change.                                                | Logic / Missing event |
| CR-2 | storage.ts:643 vs 1450 | `MemStorage.getDownloadingGameDownloads()` returns only `"downloading"` items; `DatabaseStorage` returns `downloading\|paused\|failed`. Test/prod divergence hides bugs in the paused/failed recovery path.                                                                                                                                                                                  | Interface contract    |
| CR-3 | 706–715                | `searchResultsAvailable` is only cleared when `mainItems.length === 0` after filtering. When `searchAndCategorizeItemsForGame` returns `null` (zero results / all blacklisted), the code hits `continue` without clearing the flag — games that previously had results keep the "has results" badge forever. Fix: call `updateGameSearchResultsAvailable(game.id, false)` before `continue`. | Logic                 |

### High / P2

| ID   | Line    | Description                                                                                                                                                                                                                                                                       | Category                 |
| ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| CR-4 | 549–629 | `getDownloadingGameDownloads()` returns `failed` downloads. After 3 missed checks (3 min), cron marks the game `owned` and sends "Download Status Changed" — incorrect for a download that simply failed and was cleaned up. Fix: skip `failed` records in the status-check loop. | Logic / Data integrity   |
| CR-5 | 881     | xREL regex character class contains an unescaped `[`. The `extRegex` variable is computed for every xREL release but is **never used** in the filter logic — dead code that wastes a `RegExp` construction per release.                                                           | Logic / Regex            |
| CR-6 | 771–781 | Single-result "Game Available" notification fires on **every** auto-search cycle with no dedup guard. A game available for 24 h generates 24 identical notifications/hour.                                                                                                        | Logic / Duplicate notifs |
| CR-7 | 965–973 | `checkSteamWishlist` has no top-level try/catch. If `storage.getAllUsers()` throws, the entire cron task crashes silently.                                                                                                                                                        | Error handling           |

---

## 3. `server/downloaders.ts`

### Critical / P1

| ID    | Line                    | Description                                                                                                                                                                                                                                            | Category          |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| DLR-1 | 455, 488, 561, 570, 584 | Transmission `getDownloadStatus`, `getDownloadDetails`, `pauseDownload`, `resumeDownload`, `removeDownload` all call `parseInt(id)` but the ID is a hex hash string — `parseInt` returns `NaN`, making these API calls target all torrents or nothing. | Protocol handling |
| DLR-2 | 3708                    | SABnzbd `removeDownload` only issues `queue delete`. If the download already moved to history, the call silently no-ops. No fallback to `history delete`.                                                                                              | Logic             |
| DLR-3 | 3288                    | SABnzbd `getApiUrl` reads the API key from the `username` DB field. Users who put credentials in the expected `password` field get silent auth failures.                                                                                               | Auth / Convention |

### High / P2

| ID    | Line       | Description                                                                                                                                                                                                    | Category            |
| ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| DLR-4 | 3301       | SABnzbd `fetchWithFallback` uses raw `fetch()` instead of `safeFetch`. All SABnzbd management calls (test, add, status, pause, resume, remove) bypass SSRF protection.                                         | Security / SSRF     |
| DLR-5 | 3642, 4188 | SABnzbd and NZBGet `getAllDownloads` call `getDownloadStatus` per item — N+1 API calls per poll cycle, making each call re-fetch the full queue.                                                               | Logic / Performance |
| DLR-6 | 1153–1209  | rTorrent tracker `t.multicall` requests 5 fields but the destructuring unpacks 8. `lastScrape`, `lastAnnounce`, `lastError` are always `undefined`; the tracker status logic that depends on them never fires. | Data mapping        |
| DLR-7 | 4154–4155  | NZBGet `getFromHistory` maps `ParStatus !== "FAILURE"` as `"good"`, including `"REPAIR_POSSIBLE"` and `"NONE"` — a broken repair shows as green in the UI.                                                     | Status mapping      |
| DLR-8 | 2691–2731  | qBittorrent `stoppedDL` state falls through to `default` branch which logs a spurious "Unknown state" warning and maps it to `"paused"` without an explicit case.                                              | Status mapping      |

### Medium / P3

| ID     | Line    | Description                                                                                                                                   | Category          |
| ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| DLR-9  | 1678    | rTorrent `parseXMLRPCResponse` lazy regex `[\s\S]*?` stops at the first inner `</value>` tag, truncating nested XML responses.                | Protocol handling |
| DLR-10 | 758–759 | Transmission `mapTransmissionDetails` maps both `totalPeers` and `connectedPeers` to `peersConnected` — distinct fields carry identical data. | Data mapping      |

---

## 4. `server/storage.ts`

### Critical / P1

| ID   | Line      | Description                                                                                                                                                                                 | Category       |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| ST-1 | 1248–1253 | `updateGamesBatch`: `db.transaction()` result is discarded (not awaited/returned). Exceptions inside are silently swallowed; all batch updates can fail with the caller receiving no error. | Data integrity |
| ST-2 | 1338–1399 | `syncIndexers`: same unawaited transaction pattern. Any Drizzle exception inside the transaction (e.g. duplicate URL constraint) is swallowed; caller receives incorrect success counts.    | Data integrity |

### High / P2

| ID   | Line             | Description                                                                                                                                                                                      | Category                  |
| ---- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| ST-3 | 643 vs 1450      | `MemStorage.getDownloadingGameDownloads` returns only `"downloading"`; `DatabaseStorage` also returns `"paused"` and `"failed"`. Test/prod divergence — same as CR-2.                            | Interface contract        |
| ST-4 | 1256, 1323, 1444 | `removeGame`, `removeIndexer`, `removeDownloader` always return `true` regardless of whether a row was actually deleted. Fix: return `result.changes > 0`.                                       | Incorrect return value    |
| ST-5 | 1504–1512        | `getTrackedDownloadKeys` fetches all game downloads across all users and statuses with no filter. Completed downloads from months ago keep marking hashes as "tracked"; query grows unboundedly. | Query logic / Performance |

### Medium / P3

| ID   | Line      | Description                                                                                                                                                                  | Category                |
| ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| ST-6 | 1540–1543 | `getDownloadSummaryByGame`: `downloadTypes ?? "torrent"` fabricates a torrent type when the SQL group_concat returns NULL. Fix: fall back to `""` (empty array after split). | Null handling           |
| ST-7 | 1742–1753 | `addReleaseBlacklist` can return `undefined` in a narrow race (row deleted between failed insert and fallback SELECT), despite its return type `Promise<ReleaseBlacklist>`.  | Edge case / Null safety |

---

## 5. `server/igdb.ts`

### Critical / P1

| ID   | Line     | Description                                                                                                                                                                                   | Category           |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| IG-1 | 502, 533 | `external_game_source` is not a valid IGDB field — the correct field is `category`. All Steam App ID → IGDB ID lookups silently return no results, breaking Steam wishlist matching entirely. | API / Data mapping |
| IG-2 | 183–210  | Token refresh has no in-flight promise deduplication. Concurrent requests on an expired token each trigger a separate Twitch auth call, wasting rate-limit quota.                             | Race condition     |

### High / P2

| ID   | Line                    | Description                                                                                                                                                                               | Category            |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| IG-3 | 622, 693, 747, 854, 886 | `rating_count` is not a valid IGDB field — correct field is `total_rating_count`. All popularity threshold `where` filters are silently ignored, returning games with as few as 1 rating. | API / Data mapping  |
| IG-4 | 460–461                 | Two `logger.debug` lines dump the full `JSON.stringify(responseData)` of every multiquery response to stdout in production.                                                               | Production hygiene  |
| IG-5 | 932–953                 | `getPlatforms` loop cap is 10,000 — can fire up to 101 sequential throttled API calls on a cold cache, adding ~30 s of startup latency.                                                   | Logic / Performance |

### Medium / P3

| ID   | Line               | Description                                                                                                                                            | Category       |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| IG-6 | 221, 592–606       | Shared `lastRequestTime` field is overwritten by all concurrent `skipQueue` requests; inter-batch delay logic becomes unreliable under parallel calls. | Race condition |
| IG-7 | 864, 896, 918, 978 | 4 catch blocks use `console.warn` instead of the project's structured Pino logger. Errors bypass log aggregation.                                      | Error handling |

---

## 6. `server/migrate.ts`

### Critical / P1

| ID   | Line    | Description                                                                                                                                                                                                                                                                                                       | Category                     |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| MG-1 | 215     | `tx.run(sql.raw(statement))` passes the raw unstripped SQL instead of `stripped`. The cleaned variable is computed and immediately discarded — the fix for "SQL statement handling" is incomplete.                                                                                                                | SQL handling                 |
| MG-2 | 228–231 | `INSERT INTO __drizzle_migrations` (recording a migration as applied) is **outside** the transaction. A crash between transaction commit and the INSERT leaves the schema changed but the migration not recorded — next startup re-runs the migration, which for destructive DDL (DROP + recreate) corrupts data. | Data integrity / Idempotency |

### High / P2

| ID   | Line    | Description                                                                                                                                                                                                                     | Category                      |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| MG-3 | 206–226 | `PRAGMA foreign_keys=OFF` is session-scoped, not transactional. A mid-migration failure leaves FK enforcement disabled for the rest of the connection's lifetime, allowing subsequent queries to insert orphaned rows.          | SQL handling / Error recovery |
| MG-4 | 139–143 | The dedup DELETE and index creation in `repairSchemaForV1_3_0` run as separate auto-commit statements with no wrapping transaction. A crash after the DELETE but before the index creation permanently loses deduplicated rows. | Data integrity                |
| MG-5 | 216–222 | Swallowing an error mid-transaction leaves the transaction in an aborted state. Subsequent `tx.run()` calls inside the same callback also fail, potentially swallowing real errors or producing misleading logs.                | Error handling                |

---

## 7. `server/search.ts`

### High / P2

| ID   | Line                     | Description                                                                                                                                                                                                                  | Category |
| ---- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| SR-1 | 172 + newznab.ts:298     | `totalCount` is overcounted: newznab pre-slices items to `[offset, limit]` but reports `total: allResults.length`. Torznab never slices. The API `total` is inflated vs actual `items` returned, breaking client pagination. | Logic    |
| SR-2 | 179–184 + torznab.ts:169 | Items are sorted inside each sub-client (seeders desc for torznab) then re-sorted globally by pubDate in `searchAllIndexers`. The per-protocol sort is destroyed; the intermediate sort is dead work.                        | Logic    |

### Medium / P3

| ID   | Line    | Description                                                                                                                      | Category     |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| SR-3 | 152–169 | Newznab `SearchItem` mapping does not set `indexerUrl`. Downstream code relying on this field for usenet items gets `undefined`. | Data mapping |

---

## 8. `shared/schema.ts` + `migrations/`

### Critical / P1

| ID    | File                                | Description                                                                                                                                                                                                                                                                                                                                       | Category                   |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| SCH-1 | 0002:21, 0004:1, 0007:20–21, 0009:1 | `DEFAULT false` / `DEFAULT true` are invalid SQLite literals in migrations for `rss_feeds.enabled`, `auto_search_unreleased`, `games.hidden`, `games.search_results_available`, `games.early_access`. SQLite may store these as text `"false"` instead of integer `0`, breaking all boolean queries. Fix: replace with `DEFAULT 0` / `DEFAULT 1`. | Schema drift / Invalid SQL |

### High / P2

| ID    | File                       | Description                                                                                                                                                                                                                                                  | Category         |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| SCH-2 | 0006, 0007                 | Table-rebuild migrations perform `INSERT … SELECT` without including columns added by later migrations (e.g. `source`, `igdb_websites`). If migrations run out of order or a rebuild is triggered after those columns exist, their data is silently dropped. | Migration safety |
| SCH-3 | 0006:1,78 / 0007:1,30      | `PRAGMA foreign_keys=OFF` is not rolled back on error. A failed table-rebuild leaves FK enforcement disabled for the connection lifetime.                                                                                                                    | Data integrity   |
| SCH-4 | 0000 (no index ever added) | No indexes on `game_downloads(game_id)`, `game_downloads(downloader_id)`, `xrel_notified_releases(game_id)`, `rss_feed_items(feed_id)`. All are hot FK-join columns; every download status query does a full table scan.                                     | Missing index    |
| SCH-5 | 0003:1, 0010–0013          | All `ALTER TABLE … ADD COLUMN` migrations are non-idempotent (SQLite has no `ADD COLUMN IF NOT EXISTS`). A partial migration retry will throw `duplicate column name`.                                                                                       | Migration safety |

---

## 9. `server/steam.ts` + `server/steam-routes.ts`

### Critical / P1

| ID    | Line                              | Description                                                                                                                                                                        | Category               |
| ----- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| STM-1 | steam.ts:60                       | SteamID64 validation regex `/^7656\d{13}$/` is too permissive — accepts IDs like `76569999999999999` that are not real Steam accounts. Tighten to `/^76561\d{12}$/`.               | Logic / Auth           |
| STM-2 | steam-routes.ts:42 / cron.ts:1068 | `syncUserSteamWishlist` returns bare `undefined` for both "user not found" and "Steam ID not linked". Both are reported to the client as "Steam ID not linked", masking DB errors. | Error handling         |
| STM-3 | cron.ts:1027                      | `addNewSteamWishlistGames` iterates all `pendingSteamAppIds` and re-attempts `addGame` for IDs that were just linked by `linkExistingGamesToSteam`, creating duplicate game rows.  | Logic / Data integrity |

### High / P2

| ID    | Line                   | Description                                                                                                                                                                                                       | Category               |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| STM-4 | steam-routes.ts:36     | No rate limiter on `POST /api/steam/wishlist/sync`. A single user can trigger unlimited outbound calls to Steam and IGDB, risking rate-limit bans for the whole instance.                                         | Rate limiting          |
| STM-5 | steam.ts:81–85         | Steam returns `{ response: {} }` (no `items`) for private profiles. `getWishlist` returns `[]`, the failure counter resets to 0, and the sync silently no-ops every cron cycle forever with no user notification. | Logic / Error handling |
| STM-6 | steam-routes.ts:30, 52 | `console.error` used instead of the project's Pino logger. Steam errors bypass structured logging and log aggregation.                                                                                            | Logging                |

---

## 10. `server/rss.ts`

### Critical / P1

| ID    | Line                     | Description                                                                                                                                                                                   | Category        |
| ----- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| RSS-1 | 67 (via ssrf.ts:229–232) | HTTPS RSS feeds are not IP-pinned after SSRF validation. A second DNS resolution happens at TLS connection time — classic DNS rebinding attack surface. The SSRF fix is incomplete for HTTPS. | Security / SSRF |
| RSS-2 | 84–88 + schema.ts:521    | No `UNIQUE` constraint on `rss_feed_items.guid`. Concurrent calls to `refreshFeed` (manual + cron overlap) both pass the read-then-write duplicate check and insert duplicate rows.           | Data integrity  |

### High / P2

| ID    | Line                 | Description                                                                                                                                                                                                        | Category       |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| RSS-3 | 179                  | `new Date(invalidString)` produces `Invalid Date`; `.getTime()` returns `NaN`; Drizzle coerces to `NULL` in SQLite silently. Items with unparseable pub dates are stored without a date, breaking date-based sort. | Data integrity |
| RSS-4 | 157                  | GUID fallback chain ends with `title` — a non-unique value. Two releases with the same game title are deduplicated as one item; the second is permanently silently dropped.                                        | Data integrity |
| RSS-5 | 84 + storage.ts:1656 | `getRssFeedItemByGuid` is not scoped to `feedId`. GUIDs from different feeds collide — an item from Feed B with a GUID matching Feed A is silently dropped. Fix: composite `(feed_id, guid)` unique constraint.    | Data integrity |

### Medium / P3

| ID    | Line    | Description                                                                                                                                                                    | Category       |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| RSS-6 | 19–20   | Module-level `igdbCache` Map has no size bound and no scheduled eviction. Long-running instances accumulate stale cache entries indefinitely.                                  | Memory         |
| RSS-7 | 108–118 | Feed status set to `"ok"` before fire-and-forget `processPendingItems` completes. If IGDB enrichment fails, items are stored forever without enrichment and are never retried. | Error handling |

---

## Consolidated Priority Matrix — Backend (All 10 Files)

| Priority | Severity | Bug IDs                                                                                                      |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| P1       | Critical | RT-1, CR-1, CR-3, ST-1, ST-2, IG-1, IG-2, MG-1, MG-2, DLR-1, DLR-2, SCH-1, STM-1, STM-2, STM-3, RSS-1, RSS-2 |
| P1       | High     | CR-2, RT-2, RT-3, RT-4                                                                                       |
| P2       | High     | CR-4…7, DLR-3…8, ST-3…5, IG-3…5, MG-3…5, SR-1…2, SCH-2…5, STM-4…6, RSS-3…5                                   |
| P3       | Med–Low  | RT-5, DLR-9, DLR-10, ST-6, ST-7, IG-6, IG-7, SR-3, RSS-6, RSS-7                                              |
