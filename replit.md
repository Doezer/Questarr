# GameRadarr

## Overview

GameRadarr is a comprehensive video game collection management application designed to help users organize, track, and discover games across multiple platforms. The application provides features for managing owned games, wishlists, tracking play status, and discovering new titles. Built with a modern tech stack, it offers both desktop and mobile-friendly interfaces with dark/light theme support.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Framework**: Shadcn/UI component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and CSS variables for theming
- **State Management**: TanStack Query for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Design System**: Material Design influenced productivity app with extensive component library

### Backend Architecture
- **Runtime**: Node.js with Express server framework
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful API with JSON responses
- **Storage Layer**: Abstracted interface (IStorage) with in-memory implementation for development
- **Schema Validation**: Zod for runtime type validation and Drizzle-Zod integration
- **Development**: Hot module replacement via Vite middleware integration

### Data Architecture
- **Database ORM**: Drizzle ORM configured for PostgreSQL
- **Schema Management**: Type-safe database schema definitions with automatic TypeScript inference
- **Migration System**: Drizzle Kit for database migrations and schema updates
- **Data Models**: Core entities include Users and Games with status tracking and platform associations

### Component Architecture
- **Design Tokens**: Comprehensive color palette with semantic naming for light/dark modes
- **Component Variants**: Class Variance Authority (CVA) for consistent component styling
- **Responsive Design**: Mobile-first approach with sidebar navigation that adapts to screen size
- **Accessibility**: Radix UI primitives ensure ARIA compliance and keyboard navigation

### Authentication & Session Management
- **Session Storage**: Connect-pg-simple for PostgreSQL session management
- **User Management**: Basic username/password authentication with hashed passwords
- **Authorization**: Route-level protection with session-based authentication

### Game Management Features
- **Status Tracking**: Four-state system (owned, wishlist, playing, completed)
- **Multi-Platform Support**: Platform badges and filtering for PC, PlayStation, Xbox, Switch, Mobile, VR
- **Metadata Storage**: Game titles, descriptions, genres, cover images, release dates, ratings
- **External Integration**: Support for external game database IDs (prepared for IGDB integration)

## External Dependencies

### Database
- **Neon Database**: Serverless PostgreSQL database via @neondatabase/serverless
- **Connection Management**: Environment-based DATABASE_URL configuration

### UI Component Libraries
- **Radix UI**: Complete set of accessible headless UI components
- **Lucide React**: Consistent icon library for interface elements
- **Embla Carousel**: Touch-friendly carousel component for game displays

### Development Tools
- **ESBuild**: Fast JavaScript bundler for production builds
- **TSX**: TypeScript execution for development server
- **Vite Plugins**: Runtime error overlay and development tooling for Replit environment

### Styling & Theming
- **Tailwind CSS**: Utility-first CSS framework with custom configuration
- **PostCSS**: CSS processing with autoprefixer
- **Google Fonts**: Inter and DM Sans for typography with fallback font stacks

### Form Management
- **React Hook Form**: Form state management and validation
- **Hookform Resolvers**: Integration with Zod for schema validation
- **Date-fns**: Date formatting and manipulation utilities

### State Management
- **TanStack Query**: Server state synchronization with automatic caching and invalidation
- **Wouter**: Lightweight routing with hook-based navigation