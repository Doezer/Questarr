import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Allow running without a database for development/testing with MemStorage
if (!process.env.DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL not set - using in-memory storage (data will not persist)");
}

export const pool = process.env.DATABASE_URL 
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null as any;

export const db = process.env.DATABASE_URL 
  ? drizzle({ client: pool, schema })
  : null as any;
