# Database backends

Questarr runs on **SQLite by default** and needs no configuration for it. Postgres
is available as an opt-in alternative.

Most self-hosters should stay on SQLite. Questarr actually ran on Postgres before
v1.1 and moved to SQLite deliberately, to simplify deployment and cut resource
usage (see [MIGRATION.md](./MIGRATION.md)). Postgres is worth choosing if you
already run one and would rather back up a single database server, or if you want
your library in something you can query directly with `psql`.

> **Postgres is for new installations.** There is no automatic import of an
> existing SQLite library. If you already run Questarr on SQLite and switch the
> backend, Questarr will start against an empty Postgres database and your
> library will still be sitting in the SQLite file, untouched.

## Choosing a backend

| Variable            | Default     | Meaning                                                          |
| ------------------- | ----------- | ---------------------------------------------------------------- |
| `DB_DIALECT`        | `sqlite`    | `sqlite` or `postgres`                                           |
| `SQLITE_DB_PATH`    | `sqlite.db` | SQLite file path. Ignored when `DB_DIALECT=postgres`.            |
| `DATABASE_URL`      | —           | Postgres connection string. Required when `DB_DIALECT=postgres`. |
| `DATABASE_POOL_MAX` | `10`        | Postgres connection pool size.                                   |

The backend is chosen by `DB_DIALECT` **only**. Setting `DATABASE_URL` on its own
does not switch Questarr to Postgres — it logs a warning and stays on SQLite.
That is deliberate: installs predating v1.1 may still carry a stale
`DATABASE_URL` in their compose file, and inferring the backend from it would
silently swap a live SQLite library for an empty or four-versions-stale database
on upgrade.

## Running on Postgres

With Docker Compose:

```bash
POSTGRES_PASSWORD=choose-something docker compose -f docker-compose.postgres.yml up -d
```

That file adds a `postgres:17-alpine` service with a healthcheck the app waits on,
so the first migration cannot run against a database that is still starting.

Manually, against a Postgres you already run:

```bash
createdb questarr                     # the database must exist; Questarr will not create it
export DB_DIALECT=postgres
export DATABASE_URL=postgres://questarr:password@localhost:5432/questarr
npm run db:migrate                    # applies migrations-pg/
npm start
```

Questarr applies migrations at startup, so `db:migrate` is only needed if you want
to run them ahead of time.

## How the two backends stay in step

Each dialect has its own schema module and migration history:

|            | SQLite                | Postgres                 |
| ---------- | --------------------- | ------------------------ |
| Schema     | `shared/schema.ts`    | `shared/schema.pg.ts`    |
| Migrations | `migrations/`         | `migrations-pg/`         |
| Generate   | `npm run db:generate` | `npm run db:generate:pg` |

`shared/schema.ts` is the single source of TypeScript types for the whole
codebase; `shared/schema.pg.ts` is a runtime-only mirror. They are kept
interchangeable by two guards, both of which run in CI:

- `shared/schema-parity.ts` — compile-time assertions that all 19 tables infer
  identical row and insert shapes.
- `shared/__tests__/schema-parity.test.ts` — runtime assertions on SQL column
  names, nullability, defaults and primary keys.

`server/__tests__/dialect-parity.test.ts` then runs the same behavioural
assertions against both backends, using an in-process Postgres (PGlite) so no
container is needed.

If you are changing anything database-related, read
`.claude/skills/db-dialect-parity/SKILL.md` first.

## Type mapping, and why timestamps look like numbers

Postgres columns use the most native type that preserves the exact TypeScript
type, so application code is identical on both backends: `boolean` for booleans,
`jsonb` for JSON columns, `double precision` for ratings, and `bigint` for byte
counts (Postgres `integer` is 32-bit and would overflow on any file or disk over
2.1 GB).

Timestamps are the exception. They are stored as **epoch milliseconds in a
`bigint`** rather than `timestamptz`, so in `psql` they look like `1789595556783`
rather than a date. This is deliberate: several queries compare these columns
against `Date.now()`, and a `timestamptz` column rejects an integer bind, which
would force per-dialect branches through the storage layer. Questarr does no
calendar arithmetic in SQL — all date handling is in JavaScript — so `timestamptz`
would buy nothing today.

Converting later is cheap and self-contained, because the TypeScript type is
`Date` either way and no application code would change:

```sql
ALTER TABLE games ALTER COLUMN added_at TYPE timestamptz USING to_timestamp(added_at / 1000.0);
```

plus a new body for the `timestampMs` custom type in `shared/schema.pg.ts`.
