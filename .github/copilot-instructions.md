# GitHub Copilot Instructions for Questarr

## Project Overview

Questarr is a video game management application inspired by the \*Arr ecosystem (Sonarr, Radarr) and Steam's library view. Users discover, track, and download games via automated indexer search and download client integration. The application features a clean, dark-themed interface focused on visual game covers and efficient browsing.

## Technology Stack

### Frontend

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 5
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state and caching
- **UI Components**: Radix UI primitives with shadcn/ui component library
- **Styling**: Tailwind CSS 4 with custom CSS variables for dark-first theming
- **Design System**: Grid-based layout with card-based game display

### Backend

- **Runtime**: Node.js 20+ with Express.js
- **Language**: TypeScript with ES modules
- **Database**: SQLite with better-sqlite3
- **ORM**: Drizzle ORM for type-safe database operations
- **Authentication**: JWT with bcryptjs password hashing
- **Validation**: express-validator for request validation, Zod for schema validation
- **Logging**: Pino
- **Real-time**: Socket.io for WebSocket notifications

### External APIs

- **IGDB API**: Game metadata, cover images, screenshots, ratings, and platform information (via Twitch OAuth)
- **Torznab/Newznab**: Indexer search protocol (torrent/NZB)
- **Download Clients**: qBittorrent, Transmission, rTorrent, sabnzbd, nzbget
- **Steam**: Wishlist import and Steam App ID resolution
- **xREL.to**: Scene release monitoring
- **HowLongToBeat**: Gameplay time data with fuzzy title matching (24h cache)
- **NexusMods**: Mod search and trending mods per game
- **PCGamingWiki**: Game wiki URL lookup via Steam App ID (CargoQuery API, 24h cache)

## Project Structure

```
/client              # Frontend React application
  /src               # React components and client code
    /components      # Reusable React components
    /pages           # Page components (lazy loaded): library, discover, search, wishlist, calendar, downloads, indexers, downloaders, rss, xrel-releases, stats, settings
    /hooks           # Custom React hooks
    /lib             # Utilities & services (auth, queryClient, etc.)
    /components/ui   # shadcn/ui component library
/server              # Backend Express application
  index.ts           # Server entry point, middleware chain
  routes.ts          # All API endpoints (~3360 lines, organized by domain)
  storage.ts         # Database access layer (Drizzle queries)
  middleware.ts      # Rate limiters, validators, sanitizers
  auth.ts            # JWT generation/verification, password hashing
  igdb.ts            # IGDB API client with caching
  downloaders.ts     # Multi-client download management
  search.ts          # Aggregated Torznab/Newznab search
  cron.ts            # Scheduled jobs (auto-search, download checks, etc.)
  ssrf.ts            # SSRF URL validation
  socket.ts          # WebSocket setup (Socket.io)
  torznab.ts         # Torznab protocol client
  newznab.ts         # Newznab protocol client
  hltb.ts            # HowLongToBeat client (gameplay time data)
  nexusmods.ts       # NexusMods API client (mod search)
  steam.ts           # Steam wishlist import and App ID resolution
  steam-routes.ts    # Express router for Steam endpoints
  pcgamingwiki-router.ts  # PCGamingWiki URL lookup via Steam App ID
  config.ts          # System-wide configuration access layer
/shared              # Shared code between client and server
  schema.ts          # Drizzle ORM schema + Zod validation schemas
  title-utils.ts     # Game title normalization & matching
  download-categorizer.ts  # Download categorization (main/update/DLC/extra)
/migrations          # Drizzle migration files
/tests               # Test setup and E2E tests
```

## TypeScript Configuration

- **Module System**: ESNext with ES modules (`"type": "module"`)
- **Strict Mode**: Enabled for type safety
- **Path Aliases**:
  - `@/*` → `./client/src/*`
  - `@shared/*` → `./shared/*`
- **Target**: Modern browsers with DOM and ESNext libraries

## Development Workflow

### Setup and Installation

```bash
npm install                 # Install dependencies
npm run db:migrate          # Run database migrations
npm run dev                 # Start development server with hot reload (port 5000)
```

### Build and Production

```bash
npm run build              # Build frontend (Vite) + backend (tsc)
npm start                  # Start production server from dist/
npm run check              # Type check with TypeScript
```

### Database Management

```bash
npm run db:generate        # Generate migration from schema changes
npm run db:migrate         # Run pending migrations
npm run db:push            # Push schema directly to dev DB (dev only)
```

### Testing

```bash
npm test                   # Vitest watch mode
npm run test:run           # Run all tests once
npm run test:coverage      # Coverage report (v8, HTML output)
npm run test:e2e           # Playwright E2E tests (requires dev:test running)
npm run dev:test           # Dev server with test DB on port 5100
npx vitest run path/to/test.ts  # Run a single test file
npx vitest -t "pattern"         # Run tests matching a name pattern
```

### Linting & Formatting

```bash
npm run lint               # ESLint check
npm run lint:fix           # ESLint with auto-fix
npm run format             # Prettier format all files
npm run format:check       # Prettier check only
```

Pre-commit hooks (Husky + lint-staged) run ESLint + Prettier on staged files automatically.

## Coding Standards and Best Practices

### General Guidelines

1. **Type Safety**: Always use TypeScript with strict mode. Avoid `any` types. Prefix unused params with `_`.
2. **ES Modules**: Use ES module syntax (`import`/`export`) throughout the codebase.
3. **Path Aliases**: Use `@/` for client imports and `@shared/` for shared code.
4. **Consistency**: Follow existing patterns in the codebase for similar functionality.

### Frontend Standards

1. **Components**: Use functional components with TypeScript interfaces for props.
2. **State Management**: Use TanStack Query for server state, React hooks for local state.
3. **Styling**: Use Tailwind CSS utility classes with the dark-first theme.
4. **Color Palette**: Stick to the defined dark theme colors:
   - Primary: `#3B82F6` (blue)
   - Secondary: `#10B981` (emerald)
   - Background: `#1F2937` (dark slate)
   - Cards: `#374151` (grey)
   - Text: `#F9FAFB` (light)
   - Accent: `#F59E0B` (amber)
5. **Spacing**: Use Tailwind spacing in units of 2, 4, and 8 (e.g., `gap-4`, `p-4`, `m-2`).
6. **Typography**: Use Inter for primary text.
7. **Animations**: Keep minimal - use Framer Motion for subtle transitions only.

### Backend Standards

1. **API Design**: Follow RESTful principles for route design.
2. **Error Handling**: Always handle errors with try-catch blocks.
3. **Database**: Use Drizzle ORM for all database operations. Define schemas in `shared/schema.ts`. Key tables: `users`, `userSettings`, `systemConfig`, `games`, `indexers`, `downloaders`, `gameDownloads`, `notifications`, `rssFeeds`, `rssFeedItems`, `xrelNotifiedReleases`, `releaseBlacklist`. Notable game fields: `steamAppId`, `hidden`, `userRating` (0.5–10), `source` ("manual"|"steam"|"api").
4. **Authentication**: Use JWT middleware for protected routes. Tokens are verified via `server/auth.ts`.
5. **Input Validation**: Validate requests with express-validator middleware in `server/middleware.ts`.
6. **Security**: Use `safeFetch()` from `server/ssrf.ts` for any outbound HTTP requests to prevent SSRF.
7. **Environment Variables**: Use process.env for configuration, never hardcode secrets.

### Code Organization

1. **Shared Code**: Place shared types, schemas, and utilities in `/shared`.
2. **Component Structure**: Keep components focused and single-purpose.
3. **File Naming**: Use kebab-case for file names, PascalCase for React components.
4. **Imports**: Group imports logically (React, third-party, local, types).

## Testing

- **Unit tests**: Vitest with `@testing-library/react` (client) and supertest (server). Server tests use in-memory SQLite.
- **E2E tests**: Playwright, run against `dev:test` server on port 5100.
- **Test files**: `server/__tests__/` and `client/__tests__/`
- **Setup**: `tests/setup.ts` provides ResizeObserver mocks and test env vars.

### Before Committing

1. **Lint & Format**: Pre-commit hooks handle this automatically.
2. **Type Check**: Run `npm run check` to ensure no TypeScript errors.
3. **Tests**: Run `npm run test:run` to verify all tests pass.

## Design Guidelines

- **Content-First**: Game cover art drives the visual hierarchy.
- **Grid Layouts**: Efficient scanning with consistent aspect ratios.
- **Dark Theme**: Optimized for extended viewing sessions.
- **Responsive**: Maintains usability across all screen sizes.
- **Status Clarity**: Clear visual indicators for game states (wanted/owned/completed).

## Common Tasks

### Adding a New API Route

1. Define the route in `server/routes.ts`
2. Add validation middleware in `server/middleware.ts`
3. Add storage method in `server/storage.ts`
4. Update shared types/schemas in `shared/schema.ts` if needed
5. Add React Query call in client component
6. Add tests in `server/__tests__/`

### Database Schema Changes

1. Update schema in `shared/schema.ts`
2. Run `npm run db:generate` to create migration
3. Run `npm run db:migrate` to apply
4. Update Zod schemas if needed

### External API Usage (IGDB)

- Always use the abstraction in `server/igdb.ts`
- The client includes in-memory caching (30s TTL for searches)
- Rate limits are configurable per user in settings
- Handle API failures gracefully

## Security

1. **SSRF Protection**: All outbound fetches use `safeFetch()` with DNS rebinding and cloud metadata filtering.
2. **Rate Limiting**: IGDB (3/sec configurable), auth (5/15min), general API (100/min).
3. **Input Validation**: express-validator + Zod schemas at API boundaries.
4. **Helmet**: Security headers configured via helmet middleware.

## Environment Setup

Key environment variables (see `.env.example`):

- `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` — IGDB/Twitch API credentials
- `SQLITE_DB_PATH` — Database file path (default: `sqlite.db`)
- `JWT_SECRET` — JWT signing secret (auto-generated if unset)
- `PORT` — Server port (default: 5000)
- `NODE_ENV` — `development` | `production` | `test`

## Commit Messages

- Start with a verb in present tense (e.g., "Add", "Fix", "Update")
- Reference issue numbers when applicable (e.g., "Fix #123: description")
