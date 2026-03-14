# Questarr

Video game management app (inspired by Sonarr/Radarr). Full-stack TypeScript: React frontend, Express backend, SQLite via Drizzle ORM.

## Commands

All commands run from `Questarr/` directory.

```bash
npm run dev          # Dev server on port 5000 (serves API + Vite frontend)
npm run build        # Build frontend (Vite) + server (tsc)
npm run start        # Production server (requires built dist/)
npm run check        # TypeScript type-check
npm run lint:fix     # ESLint auto-fix
npm run db:generate  # Generate Drizzle migration from schema changes
npm run db:migrate   # Run pending migrations
npm run test:run     # Vitest unit tests (single run)
npm run test:coverage # Unit tests with coverage
npm run dev:test     # Dev server for e2e (port 5100, test DB) — run before e2e tests
npm run test:e2e     # Playwright e2e tests (requires dev:test running)
```

## Architecture

```
Questarr/
  client/src/    # React app (Vite root)
  server/        # Express API
  shared/        # schema.ts (Drizzle tables + Zod schemas) — shared by client & server
  migrations/    # SQLite migration files
  tests/e2e/     # Playwright e2e tests
```

- **Path aliases**: `@` → `client/src`, `@shared` → `shared`
- **DB**: SQLite (`better-sqlite3`) with Drizzle ORM; schema defined in `shared/schema.ts`
- **Routing**: `wouter` (client), `server/routes.ts` + `server/routes/` (server)
- **State**: TanStack Query for server state; no global client state manager
- **UI**: Radix UI primitives + Tailwind CSS v4 + shadcn/ui components in `client/src/components/ui/`

## Key Files

- `shared/schema.ts` — single source of truth for DB schema, types, and Zod validators
- `server/config.ts` — env var validation (Zod schema)
- `server/routes.ts` — main Express router registration
- `server/middleware.ts` — rate limiting, request sanitizers, auth middleware

## Environment Variables

| Variable             | Required            | Notes                          |
| -------------------- | ------------------- | ------------------------------ |
| `IGDB_CLIENT_ID`     | For game discovery  | Twitch dev credential          |
| `IGDB_CLIENT_SECRET` | For game discovery  | Twitch dev credential          |
| `JWT_SECRET`         | Recommended in prod | Auto-generated if unset        |
| `SQLITE_DB_PATH`     | No                  | Defaults to `sqlite.db` in cwd |
| `PORT`               | No                  | Default `5000`                 |

## Gotchas

- E2E tests use a **separate dev server** (`npm run dev:test`) on port 5100 with a test DB — must be running before `npm run test:e2e`
- Schema changes require `db:generate` (creates migration file) then `db:migrate` — never edit migration files manually
- Vite config sets `root` to `client/` — run `vite` commands from project root, not `client/`
- `dist/` contains both `dist/public/` (frontend) and `dist/server/` (backend) after build
