import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../shared/schema.js";
import path from "path";

// In production, the database file should be in a persistent location
// For development, it's in the project root
const dbPath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), "sqlite.db");

// Initialize the database connection
const sqlite = new Database(dbPath);

// Create the drizzle database instance
export const db = drizzle(sqlite, { schema });
