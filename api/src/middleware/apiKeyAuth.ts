import type { FastifyRequest } from 'fastify';
import { db } from '../db/kysely.js';
import { hashToken } from '../lib/tokens.js';
import type { AccessClaims } from '../lib/jwt.js';

// Resolve an `Authorization: Bearer stmp_...` header into an `api` principal.
// Returns undefined when there is no usable key so the cookie path can take
// over (and protected routes raise 401 via requireUser). Unknown / revoked /
// expired keys also return undefined — we never reveal *why* a key failed.

const BEARER = /^Bearer\s+(stmp_[a-f0-9]+)$/i;

export const authenticateApiKey = async (
  req: FastifyRequest,
): Promise<AccessClaims | undefined> => {
  const header = req.headers['authorization'];
  if (!header) return undefined;
  const match = BEARER.exec(header);
  if (!match) return undefined;

  const row = await db
    .selectFrom('api_keys')
    .selectAll()
    .where('token_hash', '=', hashToken(match[1]!))
    .executeTakeFirst();

  if (!row) return undefined;
  if (row.revoked_at) return undefined;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return undefined;

  // Best-effort last-used stamp — never block or fail the request on it.
  void db
    .updateTable('api_keys')
    .set({ last_used_at: new Date() })
    .where('id', '=', row.id)
    .execute()
    .catch(() => {});

  return {
    sub: row.id,
    email: row.name,
    role: 'api',
    ownerScopeId: row.owner_id,
    apiKeyId: row.id,
  };
};
