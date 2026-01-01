# Questarr

A video game management application inspired by the -Arr apps (Sonarr, Radarr, Prowlarr...) and GamezServer. Track and organize your video game collection with automated discovery and download management.

## Features

- **Game Discovery**: Browse popular games, new releases, and upcoming titles via IGDB integration
- **Library Management**: Track your game collection with status indicators (Wanted, Owned, Playing, Completed)
- **Download Management**: Integrate with indexers (Prowlarr/Torznab) and torrent downloaders (qBittorrent, Transmission, rTorrent)
- **Search & Filter**: Find games by genre, platform, and search terms
- **Clean Interface**: UI optimized for browsing game covers and metadata, with light/dark mode

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **APIs**: IGDB (game metadata), Torznab (indexer search)
- **AIs**: Claude Sonnet 4.5, Gemini 3, Google Jules, GitHub Copilot

## Installation

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/Doezer/Questarr.git
cd Questarr
```

2. Create a `.env` file:
```bash
cp .env.example .env
```

3. Add your IGDB credentials to `.env`:
```
IGDB_CLIENT_ID=your_client_id
IGDB_CLIENT_SECRET=your_client_secret
DATABASE_URL=postgresql://postgres:password@db:5432/questarr
PORT=3000
HOST=0.0.0.0
```

4. Start with Docker Compose:
```bash
docker-compose up -d
```

5. Access the app at `http://localhost:3000`

### Using npm

1. Clone and install dependencies:
```bash
git clone https://github.com/Doezer/Questarr.git
cd Questarr
npm install
```

2. Set up PostgreSQL database and create a `.env` file with your credentials. You can use the DB from the docker file.

3. Push database schema:
```bash
npm run db:push
```

4. Start development server:
```bash
npm run dev
```

Or build and run production:
```bash
npm run build
npm start
```

## Configuration

### IGDB API Credentials

1. Register at [Twitch Developer Console](https://dev.twitch.tv/console)
2. Create an application to get Client ID and Secret
3. Add credentials to your `.env` file

### Indexers

Configure Torznab-compatible indexers in the app settings to enable torrent search. Prowlarr sync is supported.

### Downloaders

Add qBittorrent, Transmission, or rtorrent in settings to enable automated downloads.
Usenet is currently unsupported since, as far as I know, games are not common on it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

GPL3 License - see [COPYING](COPYING) file for details.

## Acknowledgments

- Inspired by [Sonarr](https://sonarr.tv/) and [GamezServer](https://github.com/Riveu/GamezServer)
- Game metadata powered by [IGDB API](https://www.igdb.com/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
