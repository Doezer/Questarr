import { defineConfig } from "drizzle-kit";

if (!process.env.SQLITE_DB_PATH) {
  // Allow fallback to default sqlite.db in current dir if no env var
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SQLITE_DB_PATH || "sqlite.db",
  },
});
