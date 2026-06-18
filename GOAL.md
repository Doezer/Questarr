# GOAL.md

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

## Current Score: 70/100

### Automation — 26/30

The full end-to-end pipeline now works. The remaining gap is version-aware upgrade tracking.

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
- [ ] Version-aware upgrade tracking (P1)
  - [ ] Parse version from release title
  - [ ] Notify/auto-download when newer version found

### Integrations — 15/25

Solid core. Direct download and library sync are the missing pieces.

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
- [x] HowLongToBeat
- [ ] Real-Debrid / debrid download client (P2)
- [ ] Steam library import (owned games) (P3)
- [ ] GOG library import (P3)
- [ ] Local filesystem scanner (P3)
- [ ] Webhook outbound events (P4)
- [ ] Playnite / Gameyfin / RomM integrations (P4)
- [ ] Indexer page links ("View on indexer") (P5)
- [ ] PostgreSQL backend (P6)

### UX quality — 12/20

Functional. Mobile and accessibility are the gaps.

- [x] Dark-themed visual design with game cover art
- [x] Library, discover, search, wishlist, calendar, downloads, stats pages
- [x] Real-time download progress (WebSocket)
- [x] Game detail modal with cover, metadata, user rating
- [x] ARIA labels on most interactive elements (ongoing hardening)
- [x] Semantic HTML on most components
- [ ] Mobile responsiveness (thumb-first, touch-safe density)
- [ ] Full accessibility audit + CI check
- [ ] Notification granularity (per-event control)
- [ ] Search result ranking and release group filtering improvements

### Code health — 11/15

Good foundation. E2E coverage and performance work remain.

- [x] TypeScript strict mode throughout (no `any`)
- [x] 53 server test files (unit + integration)
- [x] 29 client test files
- [x] Pre-commit hooks (ESLint + Prettier)
- [x] SSRF-protected outbound fetch
- [x] In-memory SQLite for tests (no real DB in CI)
- [x] Drizzle migrations
- [ ] E2E tests for main user journeys (Playwright, port 5100)
- [ ] Test coverage gate in CI
- [ ] Pagination on heavy list endpoints
- [ ] Advanced caching for search results

### Community — 6/10

Active and growing. Response time is good; structured community artifacts are thin.

- [x] GitHub issues responded to promptly
- [x] Dependabot + grouped dependency updates
- [x] Contributing guide (`.github/CONTRIBUTING.md`)
- [x] Security policy (`.github/SECURITY.md`)
- [x] Issue and PR templates
- [ ] Docker Hub pull milestone: 500k (was 200k at roadmap start)
- [ ] Pre-release testing process for major features
- [ ] CHANGELOG published to GitHub Releases

---

## Key Known Issues

1. **Mobile is untested.** The UI was built desktop-first; touch targets, density, and navigation haven't been validated on phone-sized screens.
2. **No E2E test coverage.** The Playwright setup exists but the tests aren't written yet. A regression in a full user journey (add game → auto-search → download → post-process) would go undetected.
3. **Accessibility gaps remain.** ARIA label hardening is ongoing (recent commits) but there's no automated audit in CI to prevent regressions.

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

1. **Write E2E tests for main user journeys** — add game, auto-search, trigger download, mark complete, verify post-processing.
2. **Mobile responsiveness pass** — thumb-first navigation, touch-safe density.
3. **Accessibility CI check** — automated audit so ARIA regressions don't sneak back in.
4. **Real-Debrid downloader** — expands the user base beyond torrent/usenet.
5. **Version-aware upgrade tracking** — auto-download newer versions of tracked games.

---

_Score last updated: 2026-06-18_
