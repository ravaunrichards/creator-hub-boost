import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(projectRoot, 'db', 'migrations');
const trackingTable = 'creator_hub_boost_schema_migrations';

function databaseSsl() {
  if (process.env.PGSSL === 'false') return false;
  if (process.env.PGSSL === 'true') return { rejectUnauthorized: false };
  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
}

async function applyTrackedFile(client, name, content) {
  const checksum = createHash('sha256').update(content).digest('hex');
  const previous = await client.query(
    `SELECT checksum FROM ${trackingTable} WHERE name = $1`,
    [name]
  );
  if (previous.rows[0]) {
    if (previous.rows[0].checksum !== checksum) {
      throw new Error(`Applied database file "${name}" was edited. Add a new forward migration instead of rewriting it.`);
    }
    return false;
  }

  await client.query('BEGIN');
  try {
    await client.query(content);
    await client.query(
      `INSERT INTO ${trackingTable} (name, checksum) VALUES ($1, $2)`,
      [name, checksum]
    );
    await client.query('COMMIT');
    console.log(`Database migration applied: ${name}`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`Database migration "${name}" failed: ${error.message}`, { cause: error });
  }
}

export async function runMigrations(pool) {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['creator-hub-boost:migrations']);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${trackingTable} (
        name TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const schemaPath = join(projectRoot, 'db', 'schema.sql');
    const schema = await readFile(schemaPath, 'utf8');
    await applyTrackedFile(client, 'schema.sql', schema);

    const files = (await readdir(migrationDirectory))
      .filter(name => /^\\d+_[a-z0-9_]+\\.sql$/i.test(name))
      .sort((a, b) => a.localeCompare(b, 'en'));
    for (const name of files) {
      const sql = await readFile(join(migrationDirectory, name), 'utf8');
      await applyTrackedFile(client, name, sql);
    }
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['creator-hub-boost:migrations']).catch(() => {});
    }
    client.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to run Creator Hub Boost migrations.');
    process.exitCode = 1;
  } else {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: databaseSsl(),
      connectionTimeoutMillis: 10_000
    });
    runMigrations(pool)
      .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
      })
      .finally(() => pool.end());
  }
}
