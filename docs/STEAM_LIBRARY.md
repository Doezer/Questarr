# Import owned Steam games

In **Settings → Integrations**, save your SteamID64, then use **Preview owned
games**. All untracked games are selected by default. Choose **Import selected**
once to import a large library, including thousands of games, without manually
submitting batches.

The preview shows 50 rows per page. **Select all matching** selects every eligible
game matching your search across all pages; **Clear selection** clears the entire
selection. Search and paging do not discard selections. Already tracked entries
are disabled.

Imports run on the server. The progress card shows processed games and added,
already tracked, skipped and failed counts. You can navigate away, close the tab,
or return later to follow the same job. Checkpoints survive server restarts and
unfinished jobs resume automatically. Steam is read once per run; the server
handles 50-game batches internally. A crash within a batch can replay that batch,
but duplicate checks preserve existing writes.

**Retry unfinished games** retries failed games and any unprocessed
remainder without selecting them again. Unmapped or content-filtered games count
as completed skips; change the filters/mapping and preview again to reconsider them. Games already imported are preserved.
The card describes the latest import/retry, with its ten most recent results.
Only one import per account can run at a time. A single job accepts up to 20,000
games, matching the preview's existing Steam response bound.

Requirements: `STEAM_API_KEY` configured on the server, configured IGDB, a linked
Steam ID, and Steam **Privacy Settings → Game details → Public**. The API key
never goes to the browser. Preview uses Steam's official GetOwnedGames endpoint,
not an indexer or a title scraper. Played free-to-play games are included by
requesting Steam's `include_played_free_games` option. A private/unavailable library produces an error,
not an apparently successful empty sync. Steam licenses unavailable to that API
(for example family sharing) are not inferred.

New games use exact Steam App ID → IGDB mappings, respect account content filters,
and are added as **Owned** with source `steam`. Unmapped or filtered games are
skipped, not guessed by title. Existing game states (including Wanted, Playing,
Completed, hidden games, ratings, journals and file paths) stay unchanged, even
when matched by IGDB ID rather than Steam ID. Exact existing IGDB matches gain a
missing Steam App ID so later previews recognize them; an existing Steam App ID
is never replaced. Multiple Steam editions mapping to one IGDB game stay a single
entry; tracking every edition's provenance remains future work. Repeating an import skips duplicates.
Each row reports added, already tracked, no eligible match, or failed; successful
rows are retained if another fails. The importer does not start downloads or move
files. Normal account automation continues to apply to owned games afterward.

The worker rechecks Steam ownership before each run, including recovery after a
restart. A stale or invalid selection fails the job before any game writes, with
an instruction to preview the library again. Concurrent import starts by the same account return
409; progress is scoped to the authenticated account. This workflow is manually initiated, separate from automatic wishlist sync. It does not track license removals,
schedule owned-library resyncs, import playtime, or claim games are installed.

## Why this direction

Research reviewed on 2026-10-28:

- [Questarr's PRD](PRD.md) identifies the library centralizer persona and Steam
  owned-library import as remaining roadmap work. The current Steam import brings
  in wishlist entries as Wanted, not owned licenses.
- [Playnite](https://github.com/JosefNemec/Playnite/blob/master/README.md) unifies
  Steam/GOG and other libraries but requires Windows. Questarr already has a
  Playnite extension; direct Steam import avoids requiring that desktop process.
- [Gameyfin](https://github.com/gameyfin/gameyfin/blob/main/README.md) emphasizes
  scanning local files and serving them in a browser.
- [ROMarr](https://github.com/BlizzHacker/romarr/blob/main/README.md) emphasizes
  acquisition, DAT verification, and local ROM libraries. It already explains
  release scores, so another score preview alone would not be a strong differentiator.
- [Steamworks Web API: GetOwnedGames](https://partner.steamgames.com/doc/webapi/IPlayerService#GetOwnedGames)
  supplies explicit ownership through a supported endpoint with an API key and
  public Game details.

The potential differentiator is a server-native view connecting storefront
ownership, the gaming backlog, and local acquisition/import workflows. Direct
Steam import is a useful first increment, not a claim that Steam import itself is
unique. GOG, provenance across multiple sources, and safe periodic reconciliation
remain follow-up work. No comparative adoption or user-demand metric has been
measured for this increment.
