import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import 'dotenv/config';

async function debug() {
  console.log('--- Questarr Debug Information ---');
  console.log('Date:', new Date().toISOString());
  console.log('CWD:', process.cwd());
  console.log('Node Version:', process.version);
  console.log('Platform:', process.platform);
  
  console.log('\n--- Environment Variables (Sanitized) ---');
  const envVars = ['NODE_ENV', 'PORT', 'DATABASE_URL', 'LOG_LEVEL'];
  envVars.forEach(v => {
    let val = process.env[v] || 'NOT SET';
    if (v === 'DATABASE_URL' && val !== 'NOT SET') {
      try {
        const url = new URL(val);
        val = `${url.protocol}//${url.username}:****@${url.host}${url.pathname}`;
      } catch (e) {
        val = 'INVALID URL FORMAT';
      }
    }
    console.log(`${v}: ${val}`);
  });

  console.log('\n--- Directory Structure Check ---');
  const pathsToCheck = [
    './migrations',
    './migrations/meta',
    './dist',
    './dist/server',
    './shared'
  ];

  pathsToCheck.forEach(p => {
    const exists = fs.existsSync(p);
    const stats = exists ? fs.statSync(p) : null;
    console.log(`${p}: ${exists ? (stats.isDirectory() ? 'DIR' : 'FILE') : 'MISSING'}`);
    if (exists && stats.isDirectory()) {
      const files = fs.readdirSync(p).filter(f => !f.startsWith('.'));
      console.log(`  Contents: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
    }
  });

  console.log('\n--- Database Connectivity ---');
  if (!process.env.DATABASE_URL) {
    console.log('Skipping DB check: DATABASE_URL not set');
  } else {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000 
    });
    
    try {
      const start = Date.now();
      const res = await pool.query('SELECT current_database(), version()');
      console.log('Connection: SUCCESS');
      console.log('Latency:', Date.now() - start, 'ms');
      console.log('DB Name:', res.rows[0].current_database);
      console.log('DB Version:', res.rows[0].version.split(',')[0]);

      // Check for migrations table
      const migCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = '__drizzle_migrations'
        );
      `);
      console.log('Migrations table exists:', migCheck.rows[0].exists);

      // List tables
      const tables = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      console.log('Existing Tables:', tables.rows.map(r => r.table_name).join(', ') || 'none');

    } catch (err) {
      console.error('Connection: FAILED');
      console.error('Error Code:', err.code);
      console.error('Error Message:', err.message);
    } finally {
      await pool.end();
    }
  }

  console.log('\n--- End of Debug Info ---');
}

debug().catch(err => {
  console.error('Fatal debug script error:', err);
  process.exit(1);
});
