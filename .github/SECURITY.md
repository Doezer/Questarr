# Security Policy

## Supported Versions

Use the latest version of this project to ensure you have the latest security patches.

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please do not report it publicly. Instead, please report it via email to the maintainer directly.

For a full inventory of how secrets and credentials are stored, accessed, and rotated throughout the codebase, see [docs/SECRETS.md](../docs/SECRETS.md).

## Deployment Security Guide

When deploying this application, please ensure you follow these security best practices:

### 1. Environment Variables

Never commit your `.env` file to version control. This file contains sensitive information such as database credentials and API keys.

Ensure you set the following environment variables in your production environment:

- **`JWT_SECRET`**: This is used to sign authentication tokens. Set a long, random string so sessions survive restarts (if unset, one is auto-generated and stored in the database instead — see [docs/SECRETS.md](../docs/SECRETS.md)).
- **`SQLITE_DB_PATH`**: Ensure the SQLite database file lives on a volume/path that isn't publicly accessible or served by the web server.
- **`IGDB_CLIENT_SECRET`**: Your IGDB API secret.

### 2. Docker Compose

Questarr uses SQLite, not PostgreSQL — the provided `docker-compose.yml` does not run a separate database container. Persist the `./data` volume (which holds `sqlite.db`) and never commit real credentials into `docker-compose.yml`; use a `.env` file or a git-ignored `docker-compose.*local.yml` override instead.

### 3. Network Security

- Run the application behind a reverse proxy (like Nginx or Traefik) with SSL/TLS enabled (HTTPS).
- `HOST` defaults to `0.0.0.0` (all network interfaces) in every deployment mode, not just Docker. Set `HOST=127.0.0.1` if the app should only be reachable through a local reverse proxy.

### 4. Authentication

- The application uses a default admin setup flow. Ensure you complete the setup immediately after deployment to claim the admin account.
