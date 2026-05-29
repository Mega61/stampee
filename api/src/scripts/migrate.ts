// Migration runner — applies db/migrations/*.sql in lexical order, tracks
// applied filenames in loyalty.schema_migrations. Idempotent: re-runs skip
// already-applied files. Each file runs in its own transaction; a failure
// rolls back that file and aborts the run.
//
// Used both as the one-shot `migrate` service in production compose and as
// a local dev convenience: `npm --prefix api run migrate`.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// When running from dist/scripts/migrate.js inside the container, the SQL
// files live at /app/db/migrations relative to the project root, which is
// `dist/..` from the script's vantage point. Allow override via env.
const defaultDir = resolve(__dirname, '..', '..', 'db', 'migrations');
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? defaultDir;

const log = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.log('[migrate]', ...args);
};

const run = async (): Promise<void> => {
  log(`reading migrations from ${MIGRATIONS_DIR}`);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    log('no migration files found — nothing to do');
    return;
  }

  const client = await pool.connect();
  try {
    // The migrations table lives in `loyalty` since 0001 creates that schema.
    // Bootstrap it here so first-run also works.
    await client.query(`
      create schema if not exists loyalty;
      create table if not exists loyalty.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query<{ name: string }>(
      'select name from loyalty.schema_migrations',
    );
    const applied = new Set(rows.map((r: { name: string }) => r.name));

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        log(`  skip   ${file}`);
        continue;
      }
      log(`  apply  ${file}`);
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into loyalty.schema_migrations (name) values ($1)',
          [file],
        );
        await client.query('commit');
        appliedCount += 1;
      } catch (err) {
        await client.query('rollback');
        log(`  FAILED ${file}`);
        throw err;
      }
    }
    log(`done — applied ${appliedCount}, skipped ${files.length - appliedCount}`);
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] error:', err);
  process.exit(1);
});
