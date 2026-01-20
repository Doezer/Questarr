# Migration Guide: PostgreSQL to SQLite

Questarr v1.1+ moves from PostgreSQL to SQLite to simplify deployment and reduce resource usage. This guide explains how to migrate your existing data.

## Prerequisites

- You have an existing Questarr installation running with Docker Compose.
- You have updated your repository files (specifically `docker-compose.migrate.yml`).

## Compatibility

The migration tool is compatible with all Questarr versions from v1.0.0 onwards. It automatically handles, table renames, column renames & missing columns.

## Migration Steps

1.  **Stop the current application:**
    ```bash
    docker compose down
    ```

2.  **Run the migration:**
    This special compose file spins up your old database and the new migration tool. It will automatically initialize the SQLite database (if it doesn't exist) and copy your data.
    
    You can download the required migration file here: [docker-compose.migrate.yml](https://raw.githubusercontent.com/Doezer/Questarr/main/docker-compose.migrate.yml)

    ```bash
    docker compose -f docker-compose.migrate.yml up --abort-on-container-exit
    ```


    
3.  **Verify the output:**
    A new file `sqlite.db` should be created in the `data/` directory (created in your current folder).

4.  **Update your `docker-compose.yml`:**
    Update your main `docker-compose.yml` to use SQLite by removing the `postgres` service and updating the `app` service to mount the SQLite data volume. Your configuration should look similar to this:

    ```yaml
    services:
        app:
            image: ghcr.io/doezer/questarr:latest
            ports:
                - "5000:5000"
            volumes:
                - ./data:/app/data # Maps your SQLite database file
            environment:
                - SQLITE_DB_PATH=/app/data/sqlite.db
    ```


5.  **Start the new version:**
    ```bash
    docker compose up -d
    ```

Alternatively, you can run Questarr directly with Docker:

```bash
docker run -d -p 5000:5000 -v ./data:/app/data ghcr.io/doezer/questarr:latest
```
## Troubleshooting

- **Permissions (Linux/macOS):** If `sqlite.db` is created with root permissions and you cannot move it, use `sudo chown $USER:$USER data/sqlite.db`.
- **SQLITE_IOERR_FSTAT (Windows/Docker Desktop):** If you see this error, it usually means the `data/` folder on your host has incorrect permissions or was created by Docker as root. Ensure the `data/` folder exists before starting the container and that your user has full read/write access to it.
- **Missing Data:** If the migration says "No rows found", ensure your `postgres_data` volume is correctly mapped. The migration tool uses the default `postgres_data` volume name.
