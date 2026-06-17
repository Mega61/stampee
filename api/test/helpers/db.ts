import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Path resolution from api/test/helpers/db.ts → repo-root db/.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', 'db', 'migrations');
export const SEED_FILE = resolve(__dirname, '..', '..', '..', 'db', 'seed', 'dev.sql');

export interface TestDb {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  /** Apply db/seed/dev.sql in addition to the migrations. */
  seed(): Promise<void>;
  /** TRUNCATE every loyalty table — use in beforeEach for test isolation. */
  reset(): Promise<void>;
  /** Drop the running container + pool. Call from `afterAll`. */
  stop(): Promise<void>;
}

/**
 * Spin a Postgres container, apply all migrations, return a pool whose every
 * connection has `search_path = loyalty, public` set automatically.
 *
 * Pure SQL — pg.Pool's multi-statement support lets us run each .sql file
 * verbatim, including the $$-delimited PL/pgSQL bodies in 0006.
 */
export const setupTestDb = async (): Promise<TestDb> => {
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('appdb')
    .withUsername('loyalty_user')
    .withPassword('loyalty_pw')
    .start();

  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pool.on('connect', (client) => {
    void client.query('set search_path = loyalty, public').catch(() => {});
  });

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    await pool.query(sql);
  }

  return {
    container,
    pool,
    async seed() {
      const sql = readFileSync(SEED_FILE, 'utf-8');
      await pool.query(sql);
    },
    async reset() {
      // RESTART IDENTITY is a no-op on uuid PKs but harmless. CASCADE not
      // needed since we list every table; keeping the order tidy regardless.
      await pool.query(`
        truncate
          loyalty.api_keys,
          loyalty.transactions,
          loyalty.issued_cards,
          loyalty.customers,
          loyalty.campaigns,
          loyalty.refresh_tokens,
          loyalty.password_reset_tokens,
          loyalty.email_verification_tokens,
          loyalty.profiles,
          loyalty.users
        restart identity cascade
      `);
    },
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
};
