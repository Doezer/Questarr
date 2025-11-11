# GitHub Copilot Instructions for GameRadarr

## Project Overview
GameRadarr is a video game management application inspired by Radarr and Steam's library view. It allows users to discover, track, and organize their video game collection with automated discovery and status management. The application features a clean, dark-themed interface focused on visual game covers and efficient browsing.

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
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Neon serverless driver
- **ORM**: Drizzle ORM for type-safe database operations
- **Session Management**: Express sessions with PostgreSQL session store (connect-pg-simple)
- **Authentication**: Passport.js with local strategy

### External APIs
- **IGDB API**: Game metadata, cover images, screenshots, ratings, and platform information
- **Authentication**: Twitch OAuth for IGDB API access

## Project Structure
```
/client              # Frontend React application
  /src               # React components and client code
/server              # Backend Express application
  index.ts           # Server entry point
  routes.ts          # API routes
  db.ts              # Database connection and setup
  igdb.ts            # IGDB API integration
  storage.ts         # Storage abstraction layer
  downloaders.ts     # Download management
  torznab.ts         # Torznab integration
/shared              # Shared code between client and server
  schema.ts          # Shared type definitions and Zod schemas
```

## TypeScript Configuration
- **Module System**: ESNext with ES modules
- **Strict Mode**: Enabled for type safety
- **Path Aliases**: 
  - `@/*` → `./client/src/*`
  - `@shared/*` → `./shared/*`
- **Target**: Modern browsers with DOM and ESNext libraries

## Development Workflow

### Setup and Installation
```bash
npm install                 # Install dependencies
npm run dev                 # Start development server with hot reload
```

### Build and Production
```bash
npm run build              # Build both frontend and backend
npm start                  # Start production server
npm run check              # Type check with TypeScript
```

### Database Management
```bash
npm run db:push            # Push schema changes to database using Drizzle Kit
```

## Coding Standards and Best Practices

### General Guidelines
1. **Type Safety**: Always use TypeScript with strict mode. Avoid `any` types.
2. **ES Modules**: Use ES module syntax (`import`/`export`) throughout the codebase.
3. **Path Aliases**: Use `@/` for client imports and `@shared/` for shared code.
4. **Consistency**: Follow existing patterns in the codebase for similar functionality.

### Frontend Standards
1. **Components**: Use functional components with TypeScript interfaces for props.
2. **State Management**: Use TanStack Query for server state, React hooks for local state.
3. **Styling**: Use Tailwind CSS utility classes. Follow the design guidelines in `design_guidelines.md`.
4. **Color Palette**: Stick to the defined dark theme colors:
   - Primary: `#3B82F6` (blue)
   - Secondary: `#10B981` (emerald)
   - Background: `#1F2937` (dark slate)
   - Cards: `#374151` (grey)
   - Text: `#F9FAFB` (light)
   - Accent: `#F59E0B` (amber)
5. **Spacing**: Use Tailwind spacing in units of 2, 4, and 8 (e.g., `gap-4`, `p-4`, `m-2`).
6. **Typography**: Use Inter for primary text, Roboto for data-heavy sections.
7. **Animations**: Keep minimal - use subtle fade-ins for loading states only.

### Backend Standards
1. **API Design**: Follow RESTful principles for route design.
2. **Error Handling**: Always handle errors appropriately with try-catch blocks.
3. **Database**: Use Drizzle ORM for all database operations. Define schemas in shared code.
4. **Authentication**: Use Passport.js middleware for protected routes.
5. **Environment Variables**: Use process.env for configuration, never hardcode secrets.

### Code Organization
1. **Shared Code**: Place shared types, schemas, and utilities in `/shared`.
2. **Component Structure**: Keep components focused and single-purpose.
3. **File Naming**: Use kebab-case for file names, PascalCase for React components.
4. **Imports**: Group imports logically (React, third-party, local, types).

## Testing and Quality Assurance

### Before Committing
1. **Type Check**: Run `npm run check` to ensure no TypeScript errors.
2. **Build Test**: Run `npm run build` to verify the production build works.
3. **Manual Testing**: Test changes in the development environment with `npm run dev`.

### Code Review Checklist
- [ ] TypeScript types are properly defined (no `any` unless absolutely necessary)
- [ ] Code follows existing patterns and conventions
- [ ] UI changes follow design guidelines
- [ ] Error handling is in place
- [ ] No hardcoded credentials or secrets
- [ ] Imports use path aliases where appropriate

## Design Guidelines
- **Reference-Based Design**: Inspired by Radarr's clean dashboard and Steam's library view.
- **Content-First**: Game cover art drives the visual hierarchy.
- **Grid Layouts**: Efficient scanning with consistent aspect ratios.
- **Dark Theme**: Optimized for extended viewing sessions.
- **Responsive**: Maintains usability across all screen sizes.
- **Status Clarity**: Clear visual indicators for game states (wanted/owned/completed).

For detailed design specifications, refer to `design_guidelines.md`.

## Common Tasks

### Adding a New API Route
1. Define the route in `server/routes.ts`
2. Create corresponding handler function
3. Add authentication middleware if needed
4. Update shared types in `shared/schema.ts` if needed

### Creating a New Component
1. Create component file in `client/src/components/`
2. Use TypeScript interface for props
3. Follow Tailwind CSS styling conventions
4. Use Radix UI primitives for interactive elements
5. Ensure accessibility with proper ARIA labels

### Database Schema Changes
1. Update schema in appropriate file (likely in server or shared)
2. Run `npm run db:push` to apply changes
3. Update related TypeScript types
4. Test database operations

## External API Usage

### IGDB API
- Always use the abstraction in `server/igdb.ts`
- Cache responses when appropriate
- Handle rate limits gracefully
- Include proper error handling for API failures

## Security Considerations
1. **Never commit secrets**: Use environment variables for API keys and credentials.
2. **Session Security**: Use secure session configuration in production.
3. **Input Validation**: Validate all user inputs using Zod schemas.
4. **SQL Injection**: Use Drizzle ORM's parameterized queries (never build raw SQL with user input).
5. **Authentication**: Always check authentication status for protected routes.

## Environment Setup
Ensure the following environment variables are configured:
- Database connection string (for PostgreSQL)
- IGDB API credentials
- Session secret

## Communication Style
Prefer simple, everyday language in code comments and documentation. Keep explanations clear and concise.

## Additional Resources
- Design Guidelines: `design_guidelines.md`
- Package Configuration: `package.json`
- TypeScript Config: `tsconfig.json`
- Tailwind Config: `tailwind.config.ts`
