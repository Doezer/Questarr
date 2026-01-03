# Security Policy

## Supported Versions

Use the latest version of this project to ensure you have the latest security patches.

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please do not report it publicly. Instead, please report it via [INSERT CONTACT METHOD HERE, e.g., email or private issue].

## Deployment Security Guide

When deploying this application, please ensure you follow these security best practices:

### 1. Environment Variables

Never commit your `.env` file to version control. This file contains sensitive information such as database credentials and API keys.

Ensure you set the following environment variables in your production environment:

- **`JWT_SECRET`**: This is used to sign authentication tokens. **You must change this from the default value.** Use a long, random string.
- **`SESSION_SECRET`**: Used for session signing. Change this to a secure random string.
- **`DATABASE_URL`**: Ensure your database connection string is secure and your database is not publicly accessible without authentication.
- **`IGDB_CLIENT_SECRET`**: Your IGDB API secret.

### 2. Docker Compose

The provided `docker-compose.yml` file contains default credentials for the PostgreSQL database (`POSTGRES_PASSWORD=password`).
**Do not use these defaults in production.**
Update the `docker-compose.yml` or use a `.env` file to set strong passwords for your database containers.

### 3. Network Security

- Run the application behind a reverse proxy (like Nginx or Traefik) with SSL/TLS enabled (HTTPS).
- Do not expose the database port (5432) directly to the internet.

### 4. Authentication

- The application uses a default admin setup flow. Ensure you complete the setup immediately after deployment to claim the admin account.
