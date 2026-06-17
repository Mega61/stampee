import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { requireHuman } from '../middleware/requireRole.js';
import { parseBody } from '../lib/dto.js';
import { generateApiKey } from '../lib/apiKeys.js';
import { CreateApiKeyBody } from '../schemas/apiKeys.js';

// Maximum live (non-revoked) keys per owner. Generous for current scale; keeps
// a runaway integration from minting unbounded credentials.
const MAX_ACTIVE_KEYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

type ApiKeyRow = {
  id: string;
  owner_id: string;
  created_by: string | null;
  name: string;
  key_prefix: string;
  token_hash: string;
  capabilities: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date | string;
};

const iso = (d: Date | string | null): string | undefined => {
  if (!d) return undefined;
  return d instanceof Date ? d.toISOString() : d;
};

// Never returns token_hash. `status` is derived for the UI badge.
const toApiKeyDto = (r: ApiKeyRow) => {
  const expired = !!r.expires_at && r.expires_at.getTime() < Date.now();
  const status: 'active' | 'revoked' | 'expired' = r.revoked_at
    ? 'revoked'
    : expired
      ? 'expired'
      : 'active';
  return {
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    capabilities: r.capabilities,
    status,
    lastUsedAt: iso(r.last_used_at),
    expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at),
    createdAt: iso(r.created_at),
  };
};

export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  // GET /api-keys — list the owner scope's keys (owner + admin, humans only).
  app.get('/api-keys', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const rows = await db
      .selectFrom('api_keys')
      .selectAll()
      .where('owner_id', '=', claims.ownerScopeId)
      .orderBy('created_at', 'asc')
      .execute();
    return { ok: true, data: (rows as ApiKeyRow[]).map(toApiKeyDto) };
  });

  // POST /api-keys { name, expiresInDays? } — mint a key. The plaintext secret
  // is returned exactly once, here, and never again.
  app.post('/api-keys', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const body = parseBody(CreateApiKeyBody, req.body);

    const active = await db
      .selectFrom('api_keys')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('owner_id', '=', claims.ownerScopeId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (Number(active?.count ?? 0) >= MAX_ACTIVE_KEYS) {
      throw new AppError(
        409,
        'API_KEY_LIMIT',
        `You can have at most ${MAX_ACTIVE_KEYS} active API keys. Revoke one first.`,
      );
    }

    const { full, prefix, hash } = generateApiKey();
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * DAY_MS)
      : null;

    const row = await db
      .insertInto('api_keys')
      .values({
        owner_id: claims.ownerScopeId,
        created_by: claims.sub,
        name: body.name,
        key_prefix: prefix,
        token_hash: hash,
        expires_at: expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // `key` is the only time the plaintext secret ever leaves the server.
    return { ok: true, data: { ...toApiKeyDto(row as ApiKeyRow), key: full } };
  });

  // DELETE /api-keys/:id — soft-revoke (instant, auditable).
  app.delete<{ Params: { id: string } }>('/api-keys/:id', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const result = await db
      .updateTable('api_keys')
      .set({ revoked_at: new Date() })
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) {
      // 404 covers both "not found" and "not in your scope" — no existence leak.
      throw new AppError(404, 'NOT_FOUND', 'API key not found.');
    }
    return { ok: true, data: {} };
  });
};
