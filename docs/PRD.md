# Questarr — Product Requirements Document

**Version:** 1.5.1

**Date:** 2026-10-12

**Author:** Doezer  
**Audience:** Project owner, AI coding agents, open source contributors  
**Horizon:** Remaining priorities after the 1.5.0 release

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

## 4. Shipped in 1.5.0

### Library and discovery

- IGDB discovery and metadata, Steam wishlist import and scheduled sync, RSS
  feeds refreshed at startup and hourly, and xREL release monitoring.
- Wanted, Owned, Playing, Completed, and Shelved statuses, ratings, notes,
  platform/content filters, sorting, and Backlog roulette.
- Playing journal, milestones, screenshots, and Steam achievements; game details
  include DLC/expansions, crack status, Time to Beat, PCGamingWiki, and NexusMods.
- Root-folder discovery with scan progress, automatic rescans, and IGDB review
  for unmatched folders. Existing files stay in place.
- Installed-version tracking, populated from completed downloads or edited in
  game details. Older update releases do not produce newer-version alerts.

### Search and downloads

- Torznab, Newznab, and G4U indexers, plus Prowlarr synchronization with saved
  connection, category, and priority defaults.
- Manual and scheduled searches, auto-download, release blacklisting, preferred
  release groups, source-page links, and per-game target platforms.
- qBittorrent, Transmission, rTorrent, Deluge, Synology Download Station,
  SABnzbd, and NZBGet integrations with live download progress.
- Optional experimental AI release analysis using TypeSafe/Jev through
  OpenRouter with the user's API key.

### Import pipeline

- Configurable library root, rename pattern, copy/move/hardlink transfer,
  hardlink fallback, archive extraction, path mappings, and add-on organization.
- Manual review for failed or ambiguous imports, archive passwords, and orphaned
  downloads; import history records task results.
- Optional VirusTotal and ClamAV checks quarantine detected files before import;
  incomplete ClamAV scans wait for informed manual review.
- Playing, Shelved, and Completed statuses survive download and import updates.

### Notifications and administration

- Release calendar with past dates muted in the year view; library/download
  statistics and Discord sharing.
- In-app and Apprise notifications, authenticated Apprise API connections, and
  independent update/add-on notification controls for Shelved and Completed games.
- Settings, system logs, password-reset CLI, optional error telemetry, and
  Playnite library sync/game requests through dedicated integration API keys.

### Infrastructure

- Single-user self-hosting with httpOnly cookie authentication, CSRF protection,
  bearer-token compatibility, and authenticated Socket.IO updates.
- SQLite by default; optional PostgreSQL with documented migration tooling.
- React 19, Express, Drizzle ORM, and strict TypeScript.
- Docker images for amd64/arm64, native Windows installer, Home Assistant add-on,
  Helm, Proxmox LXC, and Unraid/CasaOS/Umbrel/Cosmos deployment definitions.
- Runtime reverse-proxy subdirectory support and protected outbound requests.

---

## 5. Remaining Roadmap

The post-processing pipeline, local filesystem discovery, Playnite integration,
indexer page links, and optional PostgreSQL support are shipped. Further work
builds on those capabilities rather than treating them as pending features.

### Smart backlog

Installed-version tracking and update notification filtering are available.
Continue improving version comparison and configurable automatic upgrades.

### Direct downloads

Add a debrid downloader integration, such as Real-Debrid or AllDebrid, to resolve
releases into direct downloads within the existing downloader workflow.

### External library sync

Extend the existing Steam wishlist, local filesystem, and Playnite workflows to
Steam owned-library and GOG import, with source tracking and periodic resync.

### External integrations

Playnite and RomM are available. Gameyfin and generic event webhooks remain planned.

### Ongoing quality

Improve mobile usability, accessibility, result ranking, large-library performance,
and regression coverage for downloader and import workflows.

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

- No regressions in the shipped post-processing pipeline
- Test coverage maintained or improved (no coverage cliff from new features)
- No open P0/P1 bugs older than 30 days

### Community

- Pre-release testing by users for upcoming major features (automatic upgrades, direct downloads)
- Active engagement on Reddit posts and GitHub issues
- Feature requests acknowledged within 48 hours

---

## 8. Technical Constraints & Principles

- **Supported deployments**: Features must work in Docker and the native Windows distribution; filesystem access must respect configured paths.
- **SQLite by default**: New features must not require PostgreSQL to function. Postgres is additive.
- **Single-user**: Single-user is the supported configuration. Preserve cookie authentication, CSRF protection, and authenticated real-time connections.
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
