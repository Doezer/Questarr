---
name: db-dialect-parity
description: Keep the SQLite and Postgres schemas in sync when changing anything database-related in Questarr. Use when adding, removing or altering a column or table in shared/schema.ts, writing or editing queries in server/storage.ts, generating migrations, or touching server/db.ts — any change that reaches the database must work on both dialects.
disable-model-invocation: false
---

Questarr ships SQLite as the default backend and supports Postgres as an opt-in
alternative. **Both dialects must stay working.** A change that only accounts for
SQLite will pass the default test run and still corrupt data or crash on Postgres.

## 1. Changing the schema

`shared/schema.ts` (SQLite) is the single source of TypeScript types and Zod
schemas — the client imports from it in 47 places. `shared/schema.pg.ts` is a
**runtime-only mirror**: table definitions and indexes only, never types or Zod.

Any column or table added to one file must be added to the other, using the most
native Postgres type that preserves the **exact** TypeScript type:

| `shared/schema.ts` (SQLite)                     | TS type   | `shared/schema.pg.ts` (Postgres)                     |
| ----------------------------------------------- | --------- | ---------------------------------------------------- |
| `text("x")`                                     | `string`  | `text("x")`                                          |
| `integer("x", { mode: "boolean" })`             | `boolean` | `boolean("x")`                                       |
| `integer("x", { mode: "timestamp_ms" })`        | `Date`    | `timestampMs("x")` (custom type in that file)        |
| `integer("x")` holding a **byte count or size** | `number`  | `bigint("x", { mode: "number" })`                    |
| `integer("x")` otherwise                        | `number`  | `integer("x")`                                       |
| `real("x")`                                     | `number`  | `doublePrecision("x")`                               |
| `text("x", { mode: "json" }).$type<T>()`        | `T`       | `jsonb("x").$type<T>()`                              |
| plain `text("x")` that app code `JSON.parse`s   | `string`  | `text("x")` — leave as text                          |
| `sql`(strftime('%s', 'now') * 1000)``           | —         | ``sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint` `` |

**Postgres `integer` is 32-bit (max ~2.1 GB); SQLite's is 64-bit.** Any column
holding a file size, disk capacity or byte count must be `bigint` on Postgres.
Existing examples: `file_size`, `min_file_size`, `disk_free_bytes`, `disk_total_bytes`.

Do not convert timestamps to `timestamptz`. They are deliberately epoch
milliseconds on both dialects because raw SQL compares them against `Date.now()`;
see the comment in `shared/schema.pg.ts`.

Then generate **both** migration sets:

```bash
npm run db:generate        # SQLite  -> migrations/
npm run db:generate:pg     # Postgres -> migrations-pg/
```

## 2. Writing queries in server/storage.ts

Prefer Drizzle's dialect-neutral builder over raw `sql` templates. In particular
use `count()`, `gte()`/`lt()`, `isNull()`/`isNotNull()`, `desc()` and
`eq(col, false)` rather than hand-writing the SQL.

Known traps, each of which has already caused a bug here:

- **`count(*)` and `sum()` widen to `bigint` on Postgres**, which node-postgres
  returns as a **string**. `count > 0` silently becomes `"0" > 0` === `false`.
  Use `count()` from `drizzle-orm`, or append `.mapWith(Number)` to a raw aggregate.
- **Never compare a boolean column to `0`.** Use `eq(col, false)` so Drizzle emits
  `0` on SQLite and `false` on Postgres.
- **`result.changes` is better-sqlite3 only**; node-postgres reports `rowCount`.
  Use `affectedRows()` from `server/sql-compat.ts`.
- **`LIKE` is case-insensitive on SQLite but case-sensitive on Postgres.** Use
  `containsCI()` from `server/sql-compat.ts`.
- **`group_concat` is SQLite only** (Postgres: `string_agg`). Use `distinctJoin()`
  from `server/sql-compat.ts`.
- **`.get()`, `.all()` and `.run()` are better-sqlite3 only.** For a liveness check
  use `pingDatabase()` from `server/db.ts`.

If a construct genuinely has no portable spelling, add a helper to
`server/sql-compat.ts` rather than branching at the call site.

## 3. Verify before committing

```bash
npm run check    # includes the 38 compile-time schema parity assertions
npm run lint
npm run test:run # includes shared/__tests__/schema-parity.test.ts
npm run db:generate:pg && git status --porcelain migrations-pg   # must be empty
```

`shared/schema-parity.ts` fails the build if the two schemas stop inferring
identical row and insert shapes. `shared/__tests__/schema-parity.test.ts` fails if
SQL column names, nullability, defaults or primary keys diverge — drift the type
system cannot see. **If either fails, fix the schemas; do not weaken the guard.**
