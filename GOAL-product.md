# Goal: project health

Questarr's fitness function. A living document — update it when the score changes.

**The promise:** A self-hosted, \*Arr-style pipeline that takes a game from "I want this" to "it's in my game folder" automatically. No manual searching, copying links, or moving files.

---

## Fitness Function

Five weighted dimensions. Max score: **100**.

| Dimension    | Weight | Question answered                                |
| ------------ | ------ | ------------------------------------------------ |
| Automation   | 30     | Does the full pipeline work end-to-end?          |
| Integrations | 25     | How many indexers, clients, and services work?   |
| UX quality   | 20     | Is the UI responsive, accessible, and polished?  |
| Code health  | 15     | Are tests, types, and performance in good shape? |
| Community    | 10     | Is the project growing and responsive?           |

**Target: 85/100** (85%) — or every dimension above 75%.

---

## Current Score: 90.3/100

### Automation — 30/30

The full end-to-end pipeline works, including version-aware upgrades (1.7.0: owned games download newer versions automatically, replacing the old one).

- [x] Scheduled auto-search for wanted games
- [x] Download triggers (torrent + usenet)
- [x] Download progress via WebSocket
- [x] Download completion detection
- [x] xREL release monitoring
- [x] RSS feed monitoring
- [x] **Post-processing pipeline** (shipped in #583)
  - [x] Move/copy files to destination path with variable tokens
  - [x] Archive extraction (`.rar`, `.zip`, nested)
  - [x] Custom post-processing script hook
  - [x] Per-download post-processing status
- [x] Version-aware upgrade tracking (P1)
  - [x] Parse version from release title
  - [x] Notify when newer version found
  - [x] Optional Auto update when newer version found (`Download automatically`, #1339, #1403, #1406)

### Integrations — 22.7/25

Debrid, Steam library, local scanner and webhooks shipped for 1.7.0. Left: Gameyfin, and GOG as a direct import (GOG reaches Questarr through Playnite today).

Scored as the share of checked items (20 of 22) × 25.

- [x] Torznab indexer support
- [x] Newznab indexer support
- [x] qBittorrent
- [x] Transmission
- [x] rTorrent
- [x] SABnzbd
- [x] NZBGet
- [x] IGDB metadata
- [x] Steam wishlist import
- [x] PCGamingWiki integration
- [x] NexusMods trending mods
- [x] Time to Beat (IGDB `game_time_to_beats`, #1063; replaces the HowLongToBeat item)
- [x] Real-Debrid / debrid download client (P2) (Real-Debrid #1395, direct-download links #1411; TorBox #1414/#1418)
- [x] Steam library import (owned games) (P3) (#1273)
- [ ] GOG library import (P3) (only via Playnite for now; mgmt #123 for wishlists)
- [x] Local filesystem scanner (P3) (root folder rescan #1308, import into library #1310)
- [x] Webhook outbound events (P4) (signed JSON events)
- [x] Playnite integration (library sync + request-to-download) (P4)
- [x] RomM integration (P4) (sync, folder repair #1410)
- [ ] Gameyfin integration (P4)
- [x] Indexer page links ("View on indexer") (#872)
- [x] DB system agnostic backend: optional Postgres alongside SQLite (#1046)

### UX quality — 18/20

Mobile audit on 2026-11-26 (390 px, touch emulation, 23 routes, empty library): no horizontal overflow on any page, bottom navigation in place. Remaining gap: a few controls under 32 px on Downloads, Backups and Blocklist.

Scored as the share of checked items (9 of 10) × 20.

- [x] Dark-themed visual design with game cover art
- [x] Library, discover, search, wishlist, calendar, downloads, stats pages
- [x] Real-time download progress (WebSocket)
- [x] Game detail modal with cover, metadata, user rating
- [x] ARIA labels on most interactive elements (ongoing hardening)
- [x] Semantic HTML on most components
- [x] Mobile responsiveness (thumb-first layout, bottom nav, no page overflow at 390 px)
- [ ] Touch targets of at least 44 px on every page (audit: 5 undersized controls)
- [x] Notification granularity (per-event control)
- [x] Search result ranking and release group filtering improvements (release scoring and trust, preferred release groups)

### Code health — 13.6/15

Scored as the share of checked items (10 of 11) × 15. Pagination of the library list (`GET /api/games` returns every game) is the remaining item and too invasive for the 1.7.0 window.

- [x] TypeScript strict mode throughout (no `any`)
- [x] 185 server test files (unit + integration)
- [x] 134 client test files and 26 shared test files
- [x] Pre-commit hooks (ESLint + Prettier)
- [x] SSRF-protected outbound fetch
- [x] In-memory SQLite for tests (no real DB in CI)
- [x] Drizzle migrations
- [x] E2E tests for main user journeys (Playwright, port 5100)
- [x] Test coverage gate in CI (83% statements / 76% branches / 79% functions / 84% lines)
- [ ] Pagination on heavy list endpoints
- [x] Short-lived cache for manual indexer searches (3 min, error-free answers only, `?refresh=true` bypasses; auto-search never cached)

### Community — 6/10

Active and growing. Not re-measured for 1.7.0: the checklist below is all ticked but the dimension was scored 6 on 2026-09-30 and stays there until its criteria are defined.

- [x] GitHub issues responded to promptly
- [x] Dependabot + grouped dependency updates
- [x] Contributing guide (`.github/CONTRIBUTING.md`)
- [x] Security policy (`docs/SECURITY.md`)
- [x] Issue and PR templates
- [x] Docker Hub pull milestone: 500k (was 200k at roadmap start)
- [x] Pre-release testing process for major features
- [x] CHANGELOG published to GitHub Releases

---

## Key Known Issues

1. **Validation is green.** Lint, typecheck, and the full unit/integration suite all pass.
2. **Page coverage is complete.** The main frontend surfaces now have dedicated page-level tests.
3. **E2E coverage is complete.** The core user journeys are covered by Playwright specs and the journey list passes discovery.

---

## Constraints

- **Docker-first.** Every feature must work in a standard container with only mapped volumes — no host-level dependencies.
- **SQLite default.** New features cannot require PostgreSQL. Postgres support (P6) is additive.
- **Single-user.** No multi-tenant isolation in scope. JWT auth is sufficient.
- **TypeScript strict.** No `any`, no untyped escape hatches introduced by new work.
- **SSRF protection.** All outbound HTTP (new integrations, debrid APIs) must go through `ssrf.ts`.
- **Side-project pace.** Features ship when they're ready. Quality over velocity.

---

## Next Steps

In priority order:

1. **Touch targets** — raise the remaining undersized controls to 44 px.
2. **Library pagination** — `GET /api/games` is unbounded; needs a client change too (post-1.7.0).
3. **Gameyfin integration and direct GOG import** (post-1.7.0).
4. **Community dimension** — define measurable criteria so it can be re-scored.

---

_Score last updated: 2026-11-26 (`main` at #1437 plus the search cache of PR #1439, before the 1.7.0 release). Each dimension is the share of its checked items × its weight, except Automation (all items done) and Community (kept at 6)._
