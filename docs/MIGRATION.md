# Migration Guide: PostgreSQL to SQLite

Questarr v1.1 moved from PostgreSQL to SQLite to simplify deployment and reduce
resource usage. This guide is for operators still running a **pre-v1.1
PostgreSQL** installation who need to bring that data across.

> **The migration tooling was removed in v1.5.0.** `scripts/pg-to-sqlite.ts` and
> `docker-compose.migrate.yml` no longer ship with Questarr, because the schema
> has moved far enough since v1.1 that the tool only knew about 8 of the
> project's tables and would silently skip the rest. It is still available from
> the **v1.4.2** release, which is the supported way to run this migration —
> see below.
>
> **Not to be confused with the optional Postgres backend.** Questarr can now
> also be _run_ on PostgreSQL as an opt-in alternative to the SQLite default
> (see `docs/DATABASE.md`). That is a different thing entirely, and
> this guide does not apply to it. There is no automated path from that backend
> back to SQLite.

## Compatibility

The archived tool handles Questarr versions v1.0.0 through v1.1, including the
table renames, column renames and missing columns from that era. It does **not**
understand any table added since, so do not point it at a database from a later
version.

## Migration steps

Run this against the **v1.4.2** release. Pinning matters: the tool is not
present in `latest`, and `latest`'s schema is far ahead of what it understands.

1.  **Stop the current application:**

    ```bash
    docker compose down app
    ```

2.  **Save the compose file below** as `docker-compose.migrate.yml`.

    It is reproduced here in full, pinned to `v1.4.2`, because the file no
    longer exists on the default branch:

    ```yaml
    services:
      # Temporary Postgres service to access old data
      db:
        image: postgres:16-alpine
        environment:
          - POSTGRES_USER=postgres
          - POSTGRES_PASSWORD=password
          - POSTGRES_DB=questarr
        volumes:
          - postgres_data:/var/lib/postgresql/data
        healthcheck:
          test: ["CMD-SHELL", "pg_isready -U postgres"]
          interval: 10s
          timeout: 5s
          retries: 5

      # The migrator service (your app)
      migrator:
        image: ghcr.io/doezer/questarr:v1.4.2
        environment:
          - NODE_ENV=production
          - DATABASE_URL=postgresql://postgres:password@db:5432/questarr
          # Path where the SQLite DB will be created inside the container
          - SQLITE_DB_PATH=/app/data/sqlite.db
        volumes:
          # Map a local 'data' folder to receive the migrated database
          - ./data:/app/data
        depends_on:
          db:
            condition: service_healthy
        # Chain: 1. Push schema to SQLite, 2. Run the PG->SQLite migration script
        command: sh -c "node dist/server/run-migrations.js && node dist/scripts/pg-to-sqlite.js"

    volumes:
      postgres_data:
    ```

    This is the archived file verbatim, with only the image tag changed from
    `latest` to `v1.4.2`. Adjust `POSTGRES_USER`, `POSTGRES_PASSWORD` and
    `POSTGRES_DB` to match your original installation, and run it from the
    same directory as your original compose project so the `postgres_data`
    volume resolves to your existing data rather than a fresh empty one.

3.  **Run the migration:**

    ```bash
    docker compose -f docker-compose.migrate.yml up --abort-on-container-exit
    ```

4.  **Verify**, then start Questarr normally on the current release. Your data
    now lives in `./data/sqlite.db`.

## Source

The tool as it last shipped, for inspection or manual use:

- [`scripts/pg-to-sqlite.ts` at v1.4.2](https://github.com/Doezer/Questarr/blob/v1.4.2/scripts/pg-to-sqlite.ts)
- [`docker-compose.migrate.yml` at v1.4.2](https://github.com/Doezer/Questarr/blob/v1.4.2/docker-compose.migrate.yml)

These are tag permalinks and will keep resolving after the files leave the
default branch.

> **Credential note:** the archived script prints the full `DATABASE_URL` —
> including `user:password@host` — before connecting. Avoid piping its output
> into shared terminals or CI logs. This was one reason for removing it rather
> than carrying it forward.
