# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-04-11

### Added

- **Steam Wishlist Sync**: New button near Add game (displayed with Steam ID is provided in the settings) to sync up your backlog with your Steam wishlist, adding all games as wanted.
- **Add Game UX**: Pre-fill the add game search value with the current dashboard search query; display release date in the modal.
- **New game badges**: Three new games badges:
  - Results available, badge displayed when a game has downloads available (#517).
  - Update available, for owned games that have update type downloads available.
  - "Early Access" badge (#519).
- **Game Details Modal Redesign**:
  - Tabbed UI with IGDB metadata, full download history, game related links.
  - Game Data Integrations: IGDB and Steam metadata enrichment, HowLongToBeat (#537), PCGamingWiki game URL lookup (#538), and NexusMods integration (#540).
  - User Ratings: Rate games directly from the game details (#530).
- **Notification on Download**: Notification updated when a download is sent to the download client, to display the downloader's name.
- **Download Linking**: Per-game and batch linking to games to claim existing downloads (#543).
- **New settings**
  - **Preferred Platform**: Select a preferred platform and filter results accordingly (#531).
  - **Preferred Release Groups**: Configure preferred release groups for auto-download, auto search and pre-filtering (#491).
  - **Auto-Search Control**: Disable auto-search for unreleased games with possibility to enable in settings (#394).
- **Stats Page**: New statistics page with Discord sharing support (#384, #493).
- **Blacklist Releases**: Blacklist unwanted releases directly from download search results (#490).
- **Updates Filter**: Filter library to show only games with available updates (#548).
- **Hide from Library**: Hide button in game details, accessible from all pages (#439).
- **Search Fields**: Added search/filter field to calendar, downloads, and wishlist pages.
- **Calendar — Year-Only Section**: Separate calendar section for games with a year-level release date but no exact date.
- **Download Enhancements**: Download indicators and shared view controls (#484); freeleech status, poster name, and leecher count per download item (#516); "Questarr-added" toggle (#523); platform filter in download dialog (#518).
- **Sidebar Page Counters**: Sidebar now shows active download count only; full counters added to the downloads page (#503).
- **Wishlist Improvements**: Toggle to show/hide unreleased games with reordered sections (released first) (#460).
- **Login Page**: GitHub link with current version info (#481).
- **Inline Priority**: Change indexer and downloader priority inline without opening settings.
- **PageToolbar**: Unified toolbar component replacing the standalone SearchBar and DisplaySettingsModal across pages (#521).
- **Migration Repair**: Automatic schema repair for the v1.2.2 → v1.3.0 migration path, to account for people using v1.3.0 before release. (#542).

### Security

- **SSRF**: Fixed SSRF vulnerabilities in RSS feed fetching (#404, #468) and magnet link redirects in qBittorrent (#508).
- **SSRF DNS Rebinding**: Fixed DNS rebinding bypass in SSRF protection layer (#385).
- **Rate Limiting**: Added brute-force rate limiting to the login endpoint (#455).
- **Credential Exposure**: Fixed credential logging, weak session secret enforcement, and missing brute-force protection (#415).
- **Information Leakage**: Fixed error messages exposing internal details (#421).
- **axios CVE**: Resolved critical axios vulnerability (#547).
- **CI Hardening**: Applied security best practices and pinned action SHAs in GitHub Actions workflows (#494, #504).
- **node-forge**: Upgraded from 1.3.3 to 1.4.0 to resolve a known vulnerability (#496).

### Changed

- **Lazy Loading**: Game details and download dialogs are now lazy-loaded for faster initial page load (#422).
- **Performance**: Server-side filtering for user games (#386); batch DB updates in game update cron job (#405); memoized sorted game lists in wishlist (#509); memoized search result sorting (#533).
- **Steam**: Removed Steam sign-in button and Steam API key requirement; fixed wishlist sync (#428).
- **IGDB**: Platform retrieval is now paginated to return complete results (#471).
- **RTorrent**: Refactored download path handling to prevent double-nesting of category directories.
- **Download Dialog**: Removed non-functional files field from the game download dialog UI; dialog no longer auto-closes after a successful download.
- **Game Card**: Displays primary genre only and shows N/A for unrated games.
- **Notifications**: Game update notifications now trigger only for owned games (#438).

### Fixed

- SABnzbd downloads lost on queue→history transition (#511).
- RTorrent download directory and NZB file parameter stripping (#472).
- Transmission download failures: RPC errors now surfaced correctly (#436).
- Torznab client not correctly handling Prowlarr redirect links (#487).
- Magnet link redirect handling for Transmission and rTorrent clients.
- Platform select dropdown overflowing the viewport (#512).
- Download search results, UI state, and download action visibility (#515, #557).
- IGDB request failures on the Discover page (#522).
- Sort option "Health" not sorting correctly (#390).
- Search bar position displaced by clear button; stats bar disappearing during search.
- Validation error when adding a game without a cover URL.
- Pino logging objects by reference instead of value.
- One-time IGDB retry on HTTP 429 to avoid hammering the API.
- Download results table header not sticky during scroll.

---

## [1.2.2] - 2026-02-26

### Security

- **Docker**: Fixed container running as root user; adjusted user permissions for safer defaults (#424, #417).
- **SSRF Protection**: Fixed HTTP request SSRF vulnerability (#418).
- **fast-xml-parser**: Upgraded from 5.3.5 to 5.3.7 to address CVE (#416).
- **CI**: Pinned 3rd-party GitHub Actions to commit SHAs (#419).

### Changed

- Added `repository` and `engines` fields to `package.json`.
- Updated CI dependencies: `docker/build-push-action` 6.18.0 → 6.19.2 (#408), `docker/setup-qemu-action` 3.2.0 → 3.7.0 (#409).
- Updated runtime dependencies: `react-hook-form` (#410), `pino` 10.3.0 → 10.3.1 (#412), `@tanstack/react-query` 5.90.20 → 5.90.21 (#413), `dotenv` 17.2.4 → 17.3.1 (#414).
- Updated dev dependencies group (#411).

## [1.2.1] - 2026-02-21

### Added

- **SSL Support**: Added SSL support with optional HTTP to HTTPS redirection (#395).
- **ARM64 Support**: Added ARM64 architecture to CI builds (#388).

### Changed

- HSTS is disabled if SSL is disabled.
- Updated dependencies including `fast-xml-parser`, `semver`, `dotenv` (#378, #379, #380, #381).

### Fixed

- Fixed issue with tracked `sqlite.db` and updated `.gitignore`.

## [1.2.0] - 2026-02-08

- **RSS Feed Support**: Added a dedicated page for RSS feeds with capabilities to manage feeds and view items.
- **xREL Integration**: Implemented integration with xREL.to for game release notifications and metadata.
- **Download Modal Redesign**: Complete redesign of the download dialogs (simple and advanced) for improved usability.
- **Compact View**: Added a density setting to toggle between comfortable and compact list views in Dashboard, Library, and Wishlist.
- **Enhanced Notifications**: Added links to notifications, allowing direct navigation to relevant games or pages.
- **Security hardening**: Introduced protections for SSRF, missing security headers, and improved IPv6 validation.

### Changed

- **Privacy**: Removed Google Fonts dependency for better privacy and offline support.
- **Performance**: Optimized metadata refresh with chunked fetching and improved Prowlarr indexer synchronization.
- **Settings**: Updated settings page with tabbed navigation for better organization.
- **UX**: Enhanced password visibility toggles and accessibility throughout the app.
- **Logging**: Improved log truncation for better performance and privacy.

### Fixed

- Fixed Content Security Policy (CSP) preventing version checks.
- Resolved UI issue where the close button overlaid the cover image in GameCard.
- Fixed timestamp calculation issues affecting notification times.
- Reduced log verbosity for SSL verification errors.

## [1.1.0] - 2026-01-19

### Added

- **SQLite Support**: Migrated database engine from PostgreSQL to SQLite for a simpler, "single-file" deployment.
- **Migration Tooling**: Added `docker-compose.migrate.yml` and `pg-to-sqlite.ts` to automatically convert data from old PostgreSQL installations.
- **Improved Docker Experience**: Default environment variables and automatic directory creation for a true "Pull & Run" experience.
- **Migration UI Warning**: Added a prominent banner on the Setup page to prevent users from accidentally skipping the migration process.

### Changed

- Refactored `storage.ts` and `schema.ts` for SQLite compatibility.
- Simplified `docker-compose.yml` (removed PostgreSQL service).
- Updated `README.md` and added `docs/MIGRATION.md` with detailed upgrade instructions.

### Fixed

- Improved reliability of database initialization on fresh installs.

## [1.0.5] - 2026-01-18

### Changed

- Update to docker-compose.yml file to make port a variable throughout.

### Fixed

- Initial setup not working

## [1.0.4] - 2026-01-13

- Initial release of the changelog

### Added

- feat: added links to torrent on indexer if available
- feat: add indexer filtering to download items in GameDownloadDialog
- feat: add indexerName to DownloadItem interface
- feat: add auto sorting functionality for downloaders and indexers based on priority and enabled status
- Add contributors list and shorten readme

### Changed

- refactor: added new max width for download title, aligned tooltip with changes, added underlines on hover to links
- Dep updates
- Update downloader and indexer pages to sort by enabled status, then priority and update disabled style
- feat: update downloader input placeholder to reflect selected type
- Allow IGDB configuration during initial setup, removing the need to edit the .env or docker-compose file.
- Updated deployment workflow
- Improved URL parsing to fix some issues when using external indexers/downloaders
- Refactoring of migration runner for more reliability

### Fixed

- fix: added missing seperator to download modal #312

---

> This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
