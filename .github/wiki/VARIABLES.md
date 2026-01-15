## Environment Variables

For advanced configurations, the following variables can be passed to the container:

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_HOST` | Database host address | `localhost` |
| `POSTGRES_USER` | Database user | `postgres` |
| `POSTGRES_PASSWORD` | Database password | `questarr` (Docker) / `password` (fallback) |
| `POSTGRES_DB` | Database name | `questarr` |
| `POSTGRES_PORT` | Database port | `5432` |
| `DATABASE_URL` | Full PostgreSQL connection string (Overrides individual DB vars) | (Constructed from vars) |
| `IGDB_CLIENT_ID` | IGDB API client ID | (Set in UI) |
| `IGDB_CLIENT_SECRET` | IGDB API client secret | (Set in UI) |
| `PORT` | Application port | `5000` |
| `HOST` | Bind address | `0.0.0.0` |
| `NODE_ENV` | Application environment (`development`, `production`, `test`) | `production` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `http://localhost:5000` |
| `JWT_SECRET` | Secret key for login sessions | (Auto-generated in DB) |