<div align="center">
  <img src="images/Questarr_Logo-nobg.png" alt="Questarr Logo" width="400">

  <p>
    A video game management application inspired by the -Arr apps (Sonarr, Radarr, Prowlarr...) and GamezServer. Track and organize your video game collection with automated discovery and download management.
  </p>

  <p>
    <a href="https://hub.docker.com/r/doezer/questarr">
      <img src="https://img.shields.io/docker/pulls/doezer/questarr?logo=docker&logoColor=white" alt="Docker Pulls">
    </a>
    <a href="https://github.com/Doezer/Questarr/pkgs/container/questarr">
      <img src="https://img.shields.io/badge/ghcr.io-questarr-blue?logo=github&logoColor=white" alt="GHCR">
    </a>
    <a href="https://github.com/Doezer/Questarr/blob/main/COPYING">
      <img src="https://img.shields.io/github/license/Doezer/Questarr" alt="License">
    </a>
    <a href="https://github.com/Doezer/Questarr/actions/workflows/ci.yml">
      <img src="https://github.com/Doezer/Questarr/actions/workflows/ci.yml/badge.svg" alt="CI">
    </a>
    <a href="https://codecov.io/gh/Doezer/Questarr">
      <img src="https://codecov.io/gh/Doezer/Questarr/branch/main/graph/badge.svg" alt="Codecov">
    </a>
  </p>

  <p>
    <a href="https://discord.gg/STkp86wP9F">
      <img src="https://img.shields.io/badge/Discord-Join%20Us-7289da?logo=discord&logoColor=white" alt="Discord">
    </a>
    <a href="https://buymeacoffee.com/doezer">
      <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-FFDD00?logo=buymeacoffee&logoColor=black" alt="Buy Me A Coffee">
    </a>
  </p>
</div>

## Features

- **🎮 Game Discovery**: Browse popular games, new releases, and upcoming titles via IGDB integration and xREL.to.
- **📚 Library Management**: Track your game collection with status indicators (Wanted, Owned, Playing, Completed).
<!-- v1.2.0 only - **☁️ Steam Integration**: Sync your Steam wishlist and import your library automatically. -->
- **⬇️ Download Management**: Integrate with indexers (Prowlarr/Torznab/Newsznab), torrent/usenet downloaders (qBittorrent, Transmission, rTorrent / sabnzbd, nzbget), and optionally enable auto-download to get them right when they're there.
- **🔍 Search & Filter**: Find games by genre, platform, and search terms. Automatically search for added games until available on your indexers.
- **📰 RSS Feeds**: Monitor releases from your favorite groups directly within the app.
- **🔒 Privacy Focused**: No external dependencies (Google Fonts removed) and hardened security (CSP, SSRF protection).
- **✨ Clean Interface**: UI optimized for browsing game covers and metadata, with light/dark mode.

## Screenshots

<details open>
<summary><b>👀 See the app in action</b></summary>

### Dashboard

Your central hub for recent activity, collection overview and downloading available games.
[![Dashboard](images/Screenshots/dashboard.png)](images/Screenshots/dashboard.png)
[![Search and download](images/Screenshots/download_modal.png)](images/Screenshots/download_modal.png)

### Discover Games

Browse and find new games to add to your collection.

<p float="left">
  <a href="images/Screenshots/discover.png"><img src="images/Screenshots/discover.png" width="49%" /></a>
  <a href="images/Screenshots/xrelto.png"><img src="images/Screenshots/xrelto.png" width="49%" /></a> 
</p>

### Library & Wishlist

Manage your wanted and owned games.

<p float="left">
  <a href="images/Screenshots/library.png"><img src="images/Screenshots/library.png" width="49%" /></a>
  <a href="images/Screenshots/wishlist.png"><img src="images/Screenshots/wishlist.png" width="49%" /></a> 
</p>

### Calendar

Keep track of upcoming releases.
[![Calendar](images/Screenshots/calendar.png)](images/Screenshots/calendar.png)

### Downloads Queue (WIP)

Monitor your downloaders' active downloads and history.
[![Downloads](images/Screenshots/downloads.png)](images/Screenshots/downloads.png)

### Settings

Configure indexers, downloaders, and application preferences.

<p float="left">
  <a href="images/Screenshots/indexers.png"><img src="images/Screenshots/indexers.png" width="49%" /></a>
  <a href="images/Screenshots/downloaders.png"><img src="images/Screenshots/downloaders.png" width="49%" /></a> 
</p>

[![Settings](images/Screenshots/settings.png)](images/Screenshots/settings.png)

</details>

## Tech Stack

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB" alt="React">
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white" alt="Vite">
    <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white" alt="Tailwind CSS">
    <img src="https://img.shields.io/badge/Node.js-43853D?style=flat&logo=node.js&logoColor=white" alt="Node.js">
    <img src="https://img.shields.io/badge/SQLite-07405E?style=flat&logo=sqlite&logoColor=white" alt="SQLite">
  </p>
</div>

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express, TypeScript
- **Database**: SQLite with Drizzle ORM
- **APIs**: IGDB (game metadata), Torznab (indexer search)<!-- v1.2.0 only - , Steam API (user library sync)-->
- **AIs**: Claude Sonnet 4.5, Gemini 3, Google Jules, GitHub Copilot

## Installation

### Using Docker (Recommended)

Docker is the easiest way to deploy Questarr with all dependencies included. Questarr uses a SQLite database which is self-contained in the application container.

#### Fresh Install

**Option 1: One-liner (Simplest)**

```bash
docker run -d -p 5000:5000 -v ./data:/app/data --name questarr ghcr.io/doezer/questarr:latest
```

**Option 2: Docker Compose**

1. **Create a `docker-compose.yml` file:**

   ```yaml
   services:
     app:
       image: ghcr.io/doezer/questarr:latest
       ports:
         - "5000:5000"
       volumes:
         - ./data:/app/data
       environment:
         - SQLITE_DB_PATH=/app/data/sqlite.db
       restart: unless-stopped
   ```

2. **Start the application:**

   ```bash
   docker compose up -d
   ```

3. **Access the application:**
   Open your browser to `http://localhost:5000`

#### Upgrading from v1.0 (PostgreSQL)

If you are upgrading from an older version that used PostgreSQL, you need to migrate your data.

1.  **Stop your current application:**

    ```bash
    docker compose down
    ```

2.  **Get the migration tools:**
    Download the [`docker-compose.migrate.yml`](https://raw.githubusercontent.com/Doezer/Questarr/main/docker-compose.migrate.yml) file to your directory.

3.  **Run the migration:**
    This command spins up your old database and converts the data to the new format automatically.

    ```bash
    docker compose -f docker-compose.migrate.yml up --abort-on-container-exit
    ```

4.  **Update your deployment:**
    Replace your `docker-compose.yml` with the new version (see "Fresh Install" above).

5.  **Start the new version:**
    ```bash
    docker compose up -d
    ```

See [docs/MIGRATION.md](docs/MIGRATION.md) for more details.

## Configuration

1. **First-time setup:**

- Create your admin account
- Configure the IGDB credentials
- Connect your Steam account (Optional)

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

For development or custom deployments without Docker.

1. **Clone and install dependencies:**

```bash
git clone https://github.com/Doezer/Questarr.git
npm install
```

2. **Configure environment variables in `.env`:**
   See the .env.example for available variables.

3. **Initialize the database:**
   This will run available migration files.

```bash
npm run db:migrate
```

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
- **Discord**: [Join our Server](https://discord.gg/STkp86wP9F)

## Contributing

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines on how to contribute to this project.

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
