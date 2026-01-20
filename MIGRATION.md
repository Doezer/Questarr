# Migration Guide: PostgreSQL to SQLite

Questarr v1.1+ moves from PostgreSQL to SQLite to simplify deployment and reduce resource usage. This guide explains how to migrate your existing data.

## Prerequisites

- You have an existing Questarr installation running with Docker Compose.
- You have updated your repository files (specifically `docker-compose.migrate.yml`).

## Compatibility

The migration tool is compatible with all Questarr versions from v1.0.0 onwards. It automatically handles:
- **Table Renames**: e.g., `game_torrents` (v1.0) -> `game_downloads` (v1.1)
- **Column Renames**: e.g., `torrent_hash` -> `download_hash`
- **Missing Columns**: Automatically applies default values for new features.

## Migration Steps

1.  **Stop the current application:**
    ```bash
    docker compose down
    ```

2.  **Run the migration:**
    This special compose file spins up your old database and the new migration tool. It will automatically initialize the SQLite database and copy your data.
    ```bash
    docker compose -f docker-compose.migrate.yml up --abort-on-container-exit
    ```
    *The `--abort-on-container-exit` flag will stop everything once the migration is finished.*
    *Wait for the process to complete. You should see "Migration completed." in the logs.*
    
3.  **Verify the output:**
    A new file `sqlite.db` should be created in the `data/` directory (created in your current folder).

4.  **Update your `docker-compose.yml`:**
    Update your main `docker-compose.yml` to the new version (removing the postgres service and linking the sqlite volume).
    
    *Example snippet for the new `app` service:*
    ```yaml
    services:
      app:
        image: ghcr.io/doezer/questarr:latest
        volumes:
          - ./data:/app/data # Ensure this maps to where your sqlite.db is
        environment:
          - SQLITE_DB_PATH=/app/data/sqlite.db
    ```

5.  **Start the new version:**
    ```bash
    docker compose up -d
    ```

## Troubleshooting

- **Permissions:** If `sqlite.db` is created with root permissions and you cannot move it, use `sudo chown $USER:$USER data/sqlite.db`.
- **Missing Data:** If the migration says "No rows found", ensure your `postgres_data` volume is correctly mapped. The migration tool uses the default `postgres_data` volume name.
