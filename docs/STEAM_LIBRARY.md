# Import owned Steam games

In **Settings → Integrations**, save your SteamID64, then use **Preview owned
games**. Check the games to add and choose **Import selected** (up to 50 per
request). Search narrows the preview without clearing selections.

Requirements: `STEAM_API_KEY` configured on the server, configured IGDB, a linked
Steam ID, and Steam **Privacy Settings → Game details → Public**. The API key
never goes to the browser. Preview uses Steam's official GetOwnedGames endpoint,
not an indexer or a title scraper. A private/unavailable library produces an error,
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

The server rechecks Steam ownership at import time; a stale or invalid selection
is rejected before adding anything. Concurrent imports by the same account return
409; imports from different accounts are independent. This initial version is
manual, separate from automatic wishlist sync. It does not track license removals,
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
