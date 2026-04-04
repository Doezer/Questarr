# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Memory Protocol

**At the start of every session**, read the files in `/memory/` to restore context:

- `memory/user.md` — who the user is, their background and working style
- `memory/preferences.md` — coding and workflow preferences for this project
- `memory/decisions.md` — past architectural and technical decisions
- `memory/people.md` — collaborators and stakeholders

**At the end of every session** (when the user says goodbye, wraps up, or asks to end), update the relevant memory files with anything learned during the session: new decisions made, preferences expressed, feedback given, or new information about people involved.

---

## Project Overview

Questarr is a video game management app inspired by the \*Arr ecosystem (Sonarr, Radarr). Users discover, track, and download games via automated indexer search and download client integration. Dark-themed UI built around visual game covers.

## Commands

```bash
npm run dev              # Dev server with hot reload (port 5000)
npm run build            # Production build: Vite (client) + tsc (server/shared)
npm start                # Run production server from dist/
npm run check            # TypeScript type checking (no emit)

npm run lint             # ESLint
npm run lint:fix         # ESLint with auto-fix
npm run format           # Prettier format all files
npm run format:check     # Prettier check only

npm test                 # Vitest watch mode
npm run test:run         # Run all tests once
npm run test:coverage    # Coverage report (v8, HTML output)
npm run test:e2e         # Playwright E2E tests (requires dev:test running)
npm run dev:test         # Dev server with test DB on port 5100

# Run a single test file
npx vitest run server/__tests__/api_routes.test.ts

# Run tests matching a name pattern
npx vitest -t "pattern"

npm run db:generate      # Generate Drizzle migration from schema changes
npm run db:migrate       # Run pending migrations
npm run db:push          # Push schema directly (dev only)
```

## Architecture

Three-layer TypeScript app with a single `package.json` (not a monorepo):

- **`/client/src`** — React 18 SPA. Wouter routing, TanStack React Query for server state, shadcn/ui + Radix primitives, Tailwind CSS 4. Pages are code-split with `React.lazy`.
- **`/server`** — Express REST API + Socket.io WebSockets. JWT auth (bcryptjs), express-validator for input validation, Pino logging, SSRF-protected fetch.
- **`/shared`** — Drizzle ORM schema (`schema.ts`), Zod validation schemas (derived from Drizzle), game title normalization (`title-utils.ts`), download categorization.

### Key backend modules

| File             | Purpose                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| `routes.ts`      | All API endpoints (~2700 lines, organized by domain)                                    |
| `storage.ts`     | Database access layer (Drizzle queries)                                                 |
| `downloaders.ts` | Multi-client download management (qBittorrent, Transmission, rTorrent, sabnzbd, nzbget) |
| `igdb.ts`        | IGDB API client with in-memory cache                                                    |
| `search.ts`      | Aggregated Torznab/Newznab indexer search                                               |
| `cron.ts`        | Scheduled jobs (auto-search, download checks, xREL monitoring, game updates)            |
| `middleware.ts`  | Rate limiters, validators, sanitizers                                                   |
| `ssrf.ts`        | SSRF URL validation (DNS rebinding, cloud metadata filtering)                           |

### Data flow

1. Frontend uses React Query to call Express REST endpoints
2. Routes validate input (express-validator + Zod), call storage/service layers
3. Storage layer uses Drizzle ORM against SQLite (better-sqlite3)
4. Real-time updates pushed via Socket.io (download progress, notifications)

### Database

SQLite with Drizzle ORM. Schema defined in `shared/schema.ts`. Migrations in `/migrations/`. Key tables: `users`, `userSettings`, `games`, `indexers`, `downloaders`, `gameDownloads`, `notifications`, `rssFeeds`, `rssFeedItems`.

## Code Conventions

- **TypeScript strict mode**, no `any`. Unused params prefixed with `_`.
- **Path aliases**: `@/*` → `client/src/*`, `@shared/*` → `shared/*`
- **ES modules** throughout (`"type": "module"` in package.json)
- **Prettier**: 100 char width, 2 spaces, trailing comma ES5
- **Pre-commit hooks**: Husky + lint-staged runs ESLint + Prettier on staged files
- **Commit messages**: Start with a verb ("Add", "Fix", "Update"), reference issues when applicable
- **Frontend styling**: Tailwind CSS utility classes, dark-first theme with CSS variables. Colors: primary blue `#3B82F6`, secondary emerald `#10B981`, background dark slate `#1F2937`.
- **Components**: Functional, TypeScript interfaces for props, Radix UI for interactive primitives

### React Performance

- Wrap expensive computations in `useMemo`; wrap stable callbacks passed as props or used in dependency arrays in `useCallback`.
- Prefer deriving state via `useMemo` over storing redundant state that can be computed from existing state/props.

### Accessibility

- All interactive elements must have an accessible label: use `aria-label` on icon-only buttons/controls, `htmlFor` + `id` pairs on form fields, and `aria-labelledby` when a visible heading already describes the region.
- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<section>`) rather than `<div>` with click handlers.
- Radix UI primitives handle most ARIA roles automatically — avoid duplicating role attributes they already set.

## Testing

- **Unit tests**: Vitest with `@testing-library/react` (client) and supertest (server). Tests use in-memory SQLite.
- **E2E tests**: Playwright. Run against `dev:test` server on port 5100.
- **Test files**: `server/__tests__/` and `client/__tests__/`
- **Setup**: `tests/setup.ts` provides ResizeObserver mocks and test env vars

## Environment Variables

Key vars (see `.env.example`):

- `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` — IGDB/Twitch API credentials
- `SQLITE_DB_PATH` — Database file path (default: `sqlite.db`)
- `JWT_SECRET` — JWT signing secret (auto-generated if unset)
- `PORT` — Server port (default: 5000)
- `NODE_ENV` — `development` | `production` | `test`
