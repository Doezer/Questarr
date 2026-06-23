# Questarr — Product Requirements Document

**Version:** 1.0  
**Date:** 2026-06-07  
**Author:** Doezer
**Audience:** Project owner, AI coding agents, open source contributors  
**Horizon:** 6 months (Q3–Q4 2026)

---

## 1. Problem Statement

There is no automated, self-hosted tool to connect torrent/usenet **indexers** and **download clients** specifically for video games. Tools like Sonarr and Radarr solve this for TV and movies; Questarr fills the same gap for games.

Without Questarr, a user who wants to automatically download a newly released game must manually search indexers, copy magnet/NZB links, and paste them into a download client — repeatedly, for every game, every update. Questarr eliminates that loop.

---

## 2. Vision

**Questarr is the \*Arr-ecosystem equivalent for video games.** It gives self-hosters a single, browser-based dashboard to discover, track, download, and organize their game library — automatically.

The long-term vision is to be the **connective tissue of the self-hosted gaming stack**: integrated with indexers, download clients, external libraries (Steam, GOG), media management tools (Playnite, RomM, Gameyfin), and release trackers (xREL), while staying lightweight enough to run on a NAS or home server.

---

## 3. Users & Personas

### Primary — The Automated Downloader

A self-hoster who wants a set-it-and-forget-it pipeline. They add a game to their wishlist; Questarr searches indexers on a schedule, picks the best release, sends it to qBittorrent/SABnzbd/etc., monitors completion, and moves files to the right folder. They should rarely need to intervene.

**Core job:** Don't make me think about the download pipeline.

### Secondary — The Library Centralizer

A collector who already owns games on Steam, GOG, or a local filesystem and wants a single place to track everything. They use Questarr as a unified library view and may use it to fill gaps (games not on storefronts) via download.

**Core job:** Show me everything I own in one place, regardless of source.

### Tertiary — The Retro Gamer

A user who wants to automate ROM downloads for retro gaming, feeding tools like RomM or ES-DE that read from a local path.

**Core job:** Keep my ROM library up to date without manual searching.

---

## 4. What Exists Today

Questarr is a working, production-ready application. The features below are live in the current release.

### Library Management

- Add games manually, via IGDB search, or by importing from Steam wishlist
- Game detail modal: cover art, metadata, user rating (0.5–10), hidden flag
- Filter, sort, and search the library
- Per-game status tracking (wanted, downloading, downloaded, etc.)
- Platform detection (from release title, IGDB data, fallback to PC)

### Discovery

- IGDB-powered game discovery and metadata enrichment
- Steam App ID resolution + PCGamingWiki integration
- NexusMods trending mods per game

### Search & Indexers

- Torznab and Newznab indexer aggregation
- Manual search with per-release download triggers
- Release blacklisting
- Preferred release groups setting

### Download Client Integration

- qBittorrent, Transmission, rTorrent, SABnzbd, NZBGet
- Download status tracking and progress via WebSocket
- Auto-delete completed downloads setting

### Automation

- Scheduled auto-search for wanted games
- Download completion checks (cron)
- xREL release monitoring with direct "add to library" from release list
- RSS feed monitoring

### Calendar

- Release calendar for tracked games

### Stats

- Library and download statistics dashboard

### Settings & Config

- Per-user settings (preferred release groups, Steam sync)
- Indexer and downloader configuration UI
- System logs page

### Infrastructure

- JWT authentication (single-user)
- SQLite database (Drizzle ORM)
- Docker-first deployment
- Socket.io real-time updates
- SSRF-protected outbound fetch
- React 18 SPA + Express REST API + TypeScript strict mode throughout

---

## 5. Six-Month Roadmap

Features are ordered by current priority. Each section includes the user value and the scope.

---

### P0 — Post-Processing Pipeline _(in progress)_

**Problem:** After a download completes, files land wherever the download client puts them. Users currently manage file organization manually or with external scripts.

**Feature:** A configurable pipeline that runs after a download is marked complete:

- Copy or move files to a user-defined destination path
- Support variable tokens in paths (e.g. `{game.title}`, `{platform}`)
- Extract archives (`.rar`, `.zip`, nested subdirs)
- Optional: run a custom post-processing script (hook)
- Show post-processing status per download

**Why now:** This is the single most-requested feature. Without it, the "set it and forget it" promise is incomplete — users still have to manually move files.

---

### P1 — Smart Game Backlog (Version-Aware Updates)

**Problem:** Once a game is downloaded, Questarr forgets about it. Users have no way to know when a newer version (patch, repack, upgrade) becomes available on indexers.

**Feature:**

- Track the last downloaded version per game (parsed from release title)
- On each scheduled search, compare new results against the stored version
- Notify the user only when a strictly higher version is found (e.g. v1.0 → v1.1)
- Option to auto-download upgrades

**Why:** Moves Questarr from "download once" to "keep library current" — the full \*Arr experience.

---

### P2 — Direct Download Support (Real-Debrid and similar)

**Problem:** Some users prefer direct download services (Real-Debrid, AllDebrid, etc.) over traditional torrent/usenet pipelines — no seeding required.

**Feature:**

- New downloader type: "direct download / debrid service"
- Resolve magnet links or torrent files through the debrid API into direct HTTP links
- Trigger download to a local downloader or direct to server path
- Surface in the existing downloader configuration UI

**Why:** Expands the user base to those who don't run a torrent client, and complements the existing pipeline without replacing it.

---

### P3 — External Library Sync

**Problem:** Users own games on Steam, GOG, and other platforms. Questarr currently only imports from Steam wishlists, not the actual library.

**Feature:**

- Import owned games from Steam library (via Steam API)
- Import from GOG (if API available, otherwise file-based)
- Filesystem scanner: detect games installed on a local path and add them to the library as "owned"
- Mark synced games with their source; avoid duplicates across sources
- Periodic background re-sync

**Why:** Serves the Library Centralizer persona and makes Questarr useful even for users who don't download anything.

---

### P4 — Integrations with External Tools

**Problem:** Self-hosters already use tools like Playnite, Gameyfin, and RomM. Questarr should fit into those ecosystems rather than compete with them.

**Planned integrations:**

- **Playnite**: Export library or sync game metadata/status
- **RomM**: Tag ROMs with metadata from Questarr; trigger ROM downloads via Questarr pipeline
- **Gameyfin**: Notify or sync when a new game is added/downloaded
- **Generic webhook**: POST to a user-defined URL on events (game added, download complete, post-processing done) — enables any integration not explicitly supported

**Why:** Lowers switching cost and increases stickiness for users already in the self-hosted ecosystem.

---

### P5 — Indexer Page Links

**Problem:** When a user wants more context about a specific release (description, NFO, comments), they have to manually navigate to the indexer.

**Feature:**

- Store and display a direct link to the release page on the indexer
- Surface as a "View on indexer" button in the download/search result UI

**Why:** Small lift, high user request frequency. Reduces tab-switching for power users who want to inspect releases before committing.

---

### P6 — PostgreSQL Support (Re-introduction)

**Problem:** SQLite is limiting for users running Questarr in containerized or NAS environments where a shared DB or larger datasets are needed. PostgreSQL was previously supported and removed.

**Feature:**

- Re-introduce PostgreSQL as an optional database backend
- Maintain SQLite as the default (zero-config)
- Abstract the Drizzle schema to work cleanly on both dialects
- Document migration path from SQLite to PostgreSQL

**Why:** Enables production-grade deployments and unblocks potential multi-user or multi-instance scenarios.

---

### Ongoing — Quality of Life, Design & UX

Not features but a standing priority for all 6 months. In line with the project philosophy: a well-maintained side project that is useful and pleasant to use beats a bloated one.

- Mobile responsiveness: thumb-first navigation, touch-safe density, progressive disclosure on small screens
- Notification system improvements (granular per-event control)
- Search UX improvements (better result ranking, release group filtering)
- Performance: reduce unnecessary re-renders, paginate heavy lists
- Accessibility: aria-labels on all interactive elements, semantic HTML throughout
- Visual polish: consistent spacing, cover art quality, status color clarity

---

## 6. Non-Goals (Explicit Out-of-Scope)

The following will not be built within this roadmap and are not planned:

| Out of scope                      | Reason                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Game launcher / desktop agent** | Requires a persistent desktop process, OS-level integration, and significant platform-specific work. Out of scope for a server-side tool.             |
| **Game streaming server**         | Separate product class. Requires video encoding, session management, input streaming. Tools like Sunshine/Moonlight exist for this.                   |
| **Storefront replacement**        | Users still go to Steam/GOG to play games. Questarr facilitates acquisition and organization, not the storefront experience.                          |
| **Multi-user / multi-profile**    | Backend may support it architecturally, but UI, permission model, and per-user isolation are not planned. Single-user is the supported configuration. |
| **Cloud-hosted SaaS version**     | Self-hosted only. No plans for Questarr-as-a-service.                                                                                                 |

---

## 7. Success Metrics

### Growth

- **Docker Hub pulls**: 200k at project start → **500k by end of roadmap** (6 months)
- **GitHub stars**: continued growth; no hard target, trend matters more than absolute number
- **GitHub issues / discussions**: response to every issue or question (community health)

### Quality

- Zero regressions on post-processing pipeline at launch
- Test coverage maintained or improved (no coverage cliff from new features)
- No open P0/P1 bugs older than 30 days

### Community

- Pre-release testing by users for major features (post-processing, smart backlog)
- Active engagement on Reddit posts and GitHub issues
- Feature requests acknowledged within 48 hours

---

## 8. Technical Constraints & Principles

- **Docker-first**: All features must work in a standard Docker container without host-level dependencies (except mapped volumes).
- **SQLite by default**: New features must not require PostgreSQL to function. Postgres is additive.
- **Single-user**: No multi-tenant data isolation required. JWT auth is sufficient for current scope.
- **TypeScript strict**: No `any`, no untyped escape hatches introduced by new features.
- **SSRF protection**: All outbound HTTP calls (new integrations, debrid APIs) must go through `ssrf.ts` validation.
- **Backward compatibility**: Settings, config, and the database schema must migrate cleanly. No silent breaking changes.
- **Side-project pace**: Features are shipped when they're ready. No artificial deadlines.

---

## 9. Open Questions

| Question                               | Notes                                                                |
| -------------------------------------- | -------------------------------------------------------------------- |
| Which debrid API to support first?     | Real-Debrid has the largest user base in the community               |
| GOG library import — API or file scan? | GOG's public API is limited; may need to read the GOG Galaxy DB file |
| Playnite integration shape             | Plugin (runs in Playnite) vs. webhook-based (runs in Questarr)?      |
| PostgreSQL migration tooling           | Provide an official migration script or leave it to the user?        |
