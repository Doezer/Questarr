import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema.js";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.database.url });
export const db = drizzle({ client: pool, schema });
