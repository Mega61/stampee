import pg from 'pg';
import { env } from '../config.js';

// transactions.timestamp is bigint (epoch ms). JS Number is safe through year
// ~285616 AD, so parse as a number rather than the default string.
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

// DATE columns (issued_cards.last_visit, completed_date) — keep as YYYY-MM-DD
// strings instead of converting to a UTC-midnight JS Date that the SPA would
// have to re-format.
pg.types.setTypeParser(1082, (val: string) => val);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_SIZE,
});

// Resolve unqualified identifiers against loyalty.* on every connection.
pool.on('connect', (client) => {
  client.query('set search_path = loyalty, public').catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to set search_path on pg connection:', err);
  });
});
