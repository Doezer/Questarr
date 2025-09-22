# Overview

GameRadarr is a video game management application inspired by Radarr and Steam's library view. The application allows users to discover, track, and organize their video game collection with automated discovery and status management. Users can search for games, add them to their collection, and track their status (wanted, owned, completed, downloading) with a clean, dark-themed interface focused on visual game covers and efficient browsing.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite for development and building
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management and caching
- **UI Components**: Radix UI primitives with shadcn/ui component library for consistent, accessible components
- **Styling**: Tailwind CSS with custom CSS variables for theming, following a dark-first design approach
- **Design System**: Implements a grid-based layout inspired by Radarr's dashboard interface with hover effects and card-based game display

## Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Design**: RESTful API structure with routes for game collection management
- **Development**: Hot reloading with Vite integration for seamless full-stack development
- **Storage**: Abstracted storage interface supporting both in-memory storage (development) and database implementations

## Data Storage Solutions
- **ORM**: Drizzle ORM for type-safe database operations
- **Database**: PostgreSQL with Neon serverless driver for production
- **Schema**: Structured tables for users and games with proper relationships and indexing
- **Migrations**: Drizzle Kit for database schema management and migrations

## Authentication and Authorization
- **Session Management**: Express sessions with PostgreSQL session store using connect-pg-simple
- **User Management**: Basic username/password authentication system
- **Security**: Password hashing and session-based authentication

## External Dependencies
- **IGDB API**: Internet Game Database integration for game discovery and metadata retrieval
- **Authentication**: Twitch OAuth for IGDB API access
- **Game Data**: Cover images, screenshots, ratings, platforms, and genre information from IGDB
- **Fonts**: Google Fonts integration (Inter, DM Sans, Fira Code, Geist Mono, Architects Daughter)
- **Build Tools**: ESBuild for production bundling and optimization
- **Development**: Replit-specific plugins for development environment integration