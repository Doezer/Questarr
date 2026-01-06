import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema.js";
import { config } from "./config.js";

// ⚡ Bolt: Configure database pool with connection timeouts and limits
// to prevent resource exhaustion and hang-ups.
export const pool = new Pool({
  connectionString: config.database.url,
  connectionTimeoutMillis: 5000, // 5 seconds to connect
  idleTimeoutMillis: 30000, // 30 seconds idle before closing
  max: 20, // Maximum number of clients in the pool
});

// Add error handler for unexpected pool errors to prevent app crash
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  // Don't exit process, just log it. PG pool usually recovers.
});

export const db = drizzle({ client: pool, schema });
