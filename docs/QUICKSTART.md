# Getting started

Questarr is a self-hosted game library and download manager. Start with Docker,
or use the native Windows installer available from 1.5.0.

## Install and sign in

For Docker, run:

```bash
docker run -d -p 5000:5000 -v ./data:/app/data --name questarr ghcr.io/doezer/questarr:latest
```

For Windows, download `QuestarrSetup-<version>-windows-x64.exe` from the
[releases](https://github.com/Doezer/Questarr/releases). Choose a 1.5.0 or later
release with the Windows installer attached. The installer
sets up a Windows service and starts Questarr automatically.

Open `http://localhost:5000` and follow the initial setup wizard. Keep the Docker
`data` volume across upgrades. SQLite is the default; see [Database](DATABASE.md)
for optional PostgreSQL and data migration.

## Build your library

- Add games through IGDB search, or sync your Steam wishlist in Settings.
- Configure [indexers or Prowlarr](INDEXERS.md) and add a downloader under
  **Downloaders** to search and download releases.
- Set up [Library Import](LIBRARY_IMPORT.md) to organize completed downloads or
  discover games you already have on disk.
- Choose [notifications](NOTIFICATIONS.md), browse [RSS releases](RSS.md), and
  use [Backlog roulette](BACKLOG_ROULETTE.md) to choose what to play next.

For other installation options, see [home server deployments](HOME_SERVER_APPS.md)
and [Proxmox](PROXMOX.md). See [reverse proxy setup](REVERSE_PROXY.md) before
publishing Questarr behind a proxy, and [the changelog](CHANGELOG.md) when upgrading.

## Forgot your password

Questarr has no email reset. Run the reset script on the machine that hosts it;
it prompts for a new password.

- Docker: `docker exec -it questarr su-exec questarr node dist/scripts/reset-password.js <username>`
  (replace `questarr` with your container name; the image has no `npm`).
- From source: `npm run reset-password -- <username>`.
