import { defineConfig } from "drizzle-kit";

/**
 * Postgres counterpart to drizzle.config.ts.
 *
 * Kept as a separate file (rather than making the default config dialect-aware)
 * so that `drizzle-kit generate` with no --config keeps meaning exactly what it
 * has always meant: regenerate the SQLite migrations. Use the db:*:pg scripts
 * for this one.
 *
 * Postgres installations are always greenfield, so migrations-pg/ starts from a
 * single baseline generated off shared/schema.pg.ts rather than replaying the
 * 30-plus SQLite migrations, most of which encode SQLite's table-rebuild
 * workaround for its missing ALTER COLUMN.
 */
export default defineConfig({
  out: "./migrations-pg",
  schema: "./shared/schema.pg.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/questarr",
  },
});
