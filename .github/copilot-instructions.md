# GameRadarr - Copilot Instructions

## Project Overview

GameRadarr is a comprehensive video game collection management application that helps users organize, track, and discover games across multiple platforms. It provides features for managing owned games, wishlists, tracking play status, and discovering new titles.

## Tech Stack

### Frontend
- **Framework**: React 18.3 with TypeScript
- **Build Tool**: Vite 5.4
- **UI Library**: Shadcn/UI (built on Radix UI primitives)
- **Styling**: Tailwind CSS 3.4 with custom design tokens
- **State Management**: TanStack Query for server state
- **Routing**: Wouter for lightweight client-side routing
- **Form Management**: React Hook Form with Zod validation
- **Icons**: Lucide React

### Backend
- **Runtime**: Node.js with Express 4.21
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL via Neon Database
- **ORM**: Drizzle ORM 0.39
- **Session Management**: express-session with connect-pg-simple
- **Authentication**: Passport.js with local strategy
- **Validation**: Zod for runtime type validation

### Development Tools
- **Type Checking**: TypeScript 5.6 (strict mode enabled)
- **Linting**: ESLint
- **Build**: ESBuild for server, Vite for client
- **Database Migrations**: Drizzle Kit

## Project Structure

```
/
├── client/              # React frontend application
│   ├── src/            # Source code for React app
│   └── index.html      # HTML entry point
├── server/             # Express backend application
│   ├── index.ts        # Server entry point
│   ├── routes.ts       # API route definitions
│   ├── config.ts       # Server configuration
│   ├── storage.ts      # Data storage interface
│   ├── services/       # Business logic services
│   └── vite.ts         # Vite middleware integration
├── shared/             # Shared code between client and server
│   └── schema.ts       # Database schema and TypeScript types
├── migrations/         # Database migration files
├── package.json        # Project dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── vite.config.ts      # Vite build configuration
├── tailwind.config.ts  # Tailwind CSS configuration
└── drizzle.config.ts   # Drizzle ORM configuration
```

## Design Guidelines

GameRadarr follows a Material Design-influenced productivity app approach. See `design_guidelines.md` for comprehensive design specifications including:
- Color palette for dark/light modes
- Typography (Inter font family)
- Spacing primitives (Tailwind units)
- Component patterns and layouts
- Minimal, functional animations

**Key Design Principles**:
- Information density for efficient data management
- Clean, accessible UI using Radix UI primitives
- Dark mode first with light mode support
- Mobile-responsive with sidebar navigation

## Code Conventions

### TypeScript
- Use strict TypeScript with no implicit any
- Define types/interfaces in shared locations when used across client/server
- Use Zod schemas for runtime validation
- Leverage TypeScript path aliases: `@/*` for client, `@shared/*` for shared code

### React Components
- Use functional components with hooks
- Keep components focused and composable
- Use Shadcn/UI components as base when possible
- Follow existing component patterns in the codebase

### Styling
- Use Tailwind utility classes
- Follow spacing primitives: 2, 4, 6, 8 units
- Maintain design system consistency
- Use CSS variables for theme-able values

### Backend
- RESTful API patterns with Express
- Use proper HTTP status codes
- Implement error handling middleware
- Validate request data with Zod schemas
- Use async/await for asynchronous operations

### Database
- Define schema in `shared/schema.ts` using Drizzle ORM
- Use type-safe queries via Drizzle
- Create migrations with `npm run db:push`
- Follow existing schema patterns for consistency

## Available Commands

### Development
- `npm run dev` - Start both client and server in development mode
- `npm run dev:client` - Start only the Vite development server
- `npm run dev:server` - Start only the Express server with hot reload

### Building
- `npm run build` - Build both client and server for production
- `npm run build:client` - Build only the client with Vite
- `npm run build:server` - Build only the server with ESBuild
- `npm run check` - Type check the entire codebase

### Testing & Quality
- `npm run lint` - Run ESLint on TypeScript files
- `npm run check` - Run TypeScript compiler checks

### Database
- `npm run db:push` - Push schema changes to database

### Production
- `npm start` - Start the production server

## Common Development Workflows

### Adding a New Feature
1. Define database schema changes in `shared/schema.ts` if needed
2. Run `npm run db:push` to apply schema changes
3. Create/update API endpoints in `server/routes.ts`
4. Implement business logic in appropriate service files
5. Create React components in `client/src/`
6. Use TanStack Query for API calls from components
7. Run `npm run check` to verify types
8. Test manually using `npm run dev`

### Adding UI Components
1. Use Shadcn/UI components when available
2. Follow Tailwind spacing and color conventions
3. Ensure dark mode compatibility
4. Use Radix UI primitives for accessibility
5. Reference `design_guidelines.md` for styling

### Database Changes
1. Update `shared/schema.ts` with new models or fields
2. Use Drizzle ORM type inference for TypeScript types
3. Run `npm run db:push` to synchronize schema
4. Update API routes and frontend code accordingly

## Environment Setup

Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string (required)
- `SESSION_SECRET` - Secret key for session management (production)
- `NODE_ENV` - Environment mode (development/production)

## Important Notes

- This is a monorepo with shared TypeScript configuration
- The app uses ES modules throughout (type: "module" in package.json)
- Session management requires PostgreSQL for production
- Development uses hot module replacement for fast iteration
- All database operations should use Drizzle ORM, not raw SQL
- Follow existing patterns for consistency

## External Integrations

The application is designed to integrate with:
- IGDB (Internet Game Database) API for game metadata
- Neon Database for serverless PostgreSQL hosting

## Preferred Communication Style

Use simple, everyday language in code comments and documentation.
