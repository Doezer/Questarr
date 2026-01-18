import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL && !process.env.SQLITE_DB_PATH) {
  // Allow fallback to default sqlite.db in current dir if no env var
  // throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SQLITE_DB_PATH || "sqlite.db",
  },
});
