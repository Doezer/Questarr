# Questarr

A video game management application inspired by the -Arr apps (Sonarr, Radarr, Prowlarr...) and GamezServer. Track and organize your video game collection with automated discovery and download management.

## Features

- **Game Discovery**: Browse popular games, new releases, and upcoming titles via IGDB integration
- **Library Management**: Track your game collection with status indicators (Wanted, Owned, Playing, Completed)
- **Download Management**: Optionally integrate with indexers (Prowlarr/Torznab/Newsznab), torrent/usenet downloaders (qBittorrent, Transmission, rTorrent / sabnzbd, nzbget), and optionally enable auto-download to get them right when they're there.
- **Search & Filter**: Find games by genre, platform, and search terms. Automatically search for added games until available on your indexers.
- **Clean Interface**: UI optimized for browsing game covers and metadata, with light/dark mode

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **APIs**: IGDB (game metadata), Torznab (indexer search)
- **AIs**: Claude Sonnet 4.5, Gemini 3, Google Jules, GitHub Copilot

## Installation

### Using Docker (Recommended)

Docker is the easiest way to deploy Questarr with all dependencies included.

### Prerequisites

- **Docker & Docker Compose**
- **IGDB API credentials** (required for game discovery)

Questarr requires a PostgreSQL database. The easiest way to run both is using the provided Docker Compose configuration.

1. **Get the `docker-compose.yml` file:**
   
   You can either clone this repository or just download the `docker-compose.yml` file from it.

2. **Start the application:**
   ```bash
   docker-compose up -d
   ```

3. **Access the application:**
   Open your browser to `http://localhost:5000`
   
## Configuration


1. **First-time setup:**
- Create your admin account
- Configure the IGDB credentials
Once logged-in: 
- Configure indexers
- Add downloaders
- Add games!

See [Configuration on the Wiki](https://github.com/Doezer/Questarr/wiki/Configuring-the-application#configure-app-behavior-in-settings--general) for more detailed info.

<details>
<summary><b>Getting IGDB API Credentials</b></summary>

IGDB provides game metadata (covers, descriptions, ratings, release dates, etc.).

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console)
2. Log in with your Twitch account (create one if needed)
3. Click "Register Your Application"
4. Fill in:
   - **Name**: Questarr (or any name)
   - **OAuth Redirect URLs**: `http://localhost` (not used, but required)
   - **Category**: Application Integration
5. Click "Create"
6. Copy your **Client ID** and **Client Secret**
7. Add them to your `.env` file

</details>


<details>
<summary><b>Advanced usage</b></summary>

### Docker compose

This is mainly for users who want the latest commit (e.g when trying out fixes for an issue) or contributing users.

1. **Clone the repository:**
```bash
git clone https://github.com/Doezer/Questarr.git
cd Questarr
```

1. **Configure the application:**
Edit `docker-compose.yml` directly if you need to setup a specific environment.

1. **Build and start the containers:**
```bash
docker-compose up -d
```

1. **Access the application:**
Open your browser to `http://localhost:5000`


### **Update to latest version for Docker**

Your database content will be kept.

```bash
git pull
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Manual Installation (npm) - NOT RECOMMENDED

For development or custom deployments without Docker. Launching it requires having a PostgreSQL DB configured apart (can use the docker compose file). Not for normal users.

1. **Clone and install dependencies:**
```bash
git clone https://github.com/Doezer/Questarr.git
npm install
```

2. **Use the DB from docker file or Set up PostgreSQL:**
- Install PostgreSQL 16+ on your system
- Create a database: `createdb questarr`
- Create a `.env` file and provide your custom database connection string

3. **Configure environment variables in `.env`:**
See the .env.example for available variables.

4. **Initialize the database:**
This will run available migration files.
```bash
npm run db:migrate
```
You may run db:push instead if you have set DATABASE_URL (only for development)

5. **Development mode (with hot reload):**
```bash
npm run dev
```

6. **Access the application:**
Open your browser to `http://localhost:5000`

</details>

## Troubleshooting
See [Troubleshooting on the Wiki](https://github.com/Doezer/Questarr/wiki/Troubleshooting)

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/Doezer/Questarr/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Doezer/Questarr/discussions)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## Contributors

<a href="https://github.com/Doezer/Questarr/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Doezer/Questarr" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## License

GPL3 License - see [COPYING](COPYING) file for details.

## Acknowledgments

- Inspired by [Sonarr](https://sonarr.tv/) and [GamezServer](https://github.com/05sonicblue/GamezServer)
- Game metadata powered by [IGDB API](https://www.igdb.com/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
