# GameRadarr Context & Guidelines

## Project Overview

GameRadarr is a game collection manager and downloader application, similar to the "Arr" suite (Radarr, Sonarr) but for games. It allows users to:
- Discover games via IGDB integration.
- Track their game collection (wanted, owned, completed).
- Search for game torrents using Torznab indexers (e.g., Jackett, Prowlarr).
- Send downloads to torrent clients (Transmission, rTorrent, qBittorrent).

## Tech Stack

- **Frontend:**
  - **Framework:** React 18
  - **Build Tool:** Vite
  - **Language:** TypeScript
  - **Styling:** Tailwind CSS (v4), shadcn/ui (Radix UI)
  - **State Management/Data Fetching:** TanStack Query (React Query)
  - **Routing:** wouter
  - **Forms:** React Hook Form + Zod
  - **Icons:** Lucide React

- **Backend:**
  - **Runtime:** Node.js
  - **Framework:** Express.js
  - **Language:** TypeScript
  - **Database ORM:** Drizzle ORM
  - **Database:** PostgreSQL (using `pg` driver)
  - **Validation:** Zod (shared schemas)
  - **Logging:** Pino
  - **API Integration:** IGDB (games), Torznab (indexers), XMLRPC/API (downloaders)

- **Testing:**
  - **Framework:** Vitest
  - **Environment:** jsdom (client), node (server)
  - **Library:** React Testing Library

## Architecture

- **Monorepo-like Structure:**
  - `client/`: React frontend application.
  - `server/`: Express backend application.
  - `shared/`: Shared code (types, Zod schemas) used by both client and server.
  - `dist/`: Output directory for production builds (server serves static frontend assets).

- **Data Flow:**
  - The frontend communicates with the backend via a REST API (`/api/*`).
  - The backend interacts with the PostgreSQL database using Drizzle ORM.
  - External services (IGDB, Indexers, Downloaders) are consumed by the backend.

## Key Files & Directories

- **`shared/schema.ts`**: **CRITICAL**. Defines the database schema, Zod validation schemas, and TypeScript types shared across the stack. Always check this first when modifying data models.
- **`server/routes.ts`**: Contains all API route definitions.
- **`server/storage.ts`**: Database interaction layer (repository pattern).
- **`server/index.ts`**: Entry point for the server.
- **`client/src/App.tsx`**: Main frontend component and routing.
- **`client/src/lib/queryClient.ts`**: React Query configuration.
- **`drizzle.config.ts`**: Drizzle ORM configuration.

## Development Guidelines

### 1. Conventions
- **Strict TypeScript:** No `any` types unless absolutely necessary. Use shared types from `@shared/schema`.
- **Imports:** Use absolute imports `@/` for client components and utils.
- **Styling:** Use Tailwind CSS utility classes. Prefer `shadcn/ui` components for UI elements.
- **Async/Await:** Always use `async/await` for asynchronous operations. Handle errors gracefully (try/catch).

### 2. Database Changes
- Modify `shared/schema.ts` to update the schema.
- Run `npm run db:push` to apply changes to the database (if using Drizzle Kit). *Note: Check `package.json` for exact command.*

### 3. Testing
- Run tests with `npm run test` or `npm run test:run`.
- Write unit tests for complex logic (e.g., utility functions, backend services).
- Use `vi.mock()` for external dependencies (database, network requests) in backend tests.

### 4. Code Quality
- Run `npm run check` for TypeScript type checking.
- Run `npm run lint` for ESLint checks.
- Run `npm run format` for Prettier formatting.
- **Always** run these checks before finishing a task.

## Common Tasks

- **Adding a new feature:**
  1. Update `shared/schema.ts` if data model changes are needed.
  2. Update `server/storage.ts` to handle database operations.
  3. Add API routes in `server/routes.ts`.
  4. Create/Update frontend components in `client/src/components`.
  5. Add/Update pages in `client/src/pages`.

- **Debugging:**
  - Check server logs (Pino logger output).
  - Use Browser DevTools for frontend network and console errors.
  - Check `npm run check` output for type errors.

## Memory & Context

- **User Preferences:**
  - OS: win32
  - Locale: User's locale (e.g., fr-FR based on date format).
  - Project Path: `C:\Users\Vincent\Repos\Perso\Replit\GameRadarr`

- **Project Status:**
  - IGDB Client ID removed from settings UI for security.
  - Torznab error handling improved (includes response body).
  - `package-lock.json` is untracked.
