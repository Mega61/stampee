import { Kysely, PostgresDialect } from 'kysely';
import { pool } from './pool.js';
import type { Database } from './types.js';

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
