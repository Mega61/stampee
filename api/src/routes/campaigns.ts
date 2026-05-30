import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { requireRole } from '../middleware/requireRole.js';
import { toCampaignDtoSigned, parseBody, type CampaignRow } from '../lib/dto.js';
import { CampaignBody, UpdateEnabledBody } from '../schemas/campaigns.js';
import { signedReadUrl, toStoredAssetRef } from '../storage/gcs.js';
import { randomUUID } from 'node:crypto';

const campaignValuesFromBody = (body: CampaignBody, ownerId: string, id: string) => ({
  id,
  owner_id: ownerId,
  name: body.name,
  is_enabled: body.isEnabled ?? true,
  description: body.description,
  reward_name: body.rewardName,
  tagline: body.tagline ?? null,
  background_image: toStoredAssetRef(body.backgroundImage),
  background_opacity: body.backgroundOpacity ?? 100,
  logo_image: toStoredAssetRef(body.logoImage),
  show_logo: body.showLogo ?? true,
  title_size: body.titleSize ?? null,
  icon_key: body.iconKey,
  colors: body.colors,
  total_stamps: body.totalStamps,
  social: body.social ?? null,
});

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  // GET /campaigns — owner's campaigns OR staff's owner's campaigns
  app.get('/campaigns', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff');
    const rows = await db
      .selectFrom('campaigns')
      .selectAll()
      .where('owner_id', '=', claims.ownerScopeId)
      .orderBy('created_at', 'asc')
      .execute();
    const dtos = await Promise.all(
      (rows as CampaignRow[]).map((r) => toCampaignDtoSigned(r, signedReadUrl)),
    );
    return { ok: true, data: dtos };
  });

  // GET /campaigns/count
  app.get('/campaigns/count', async (req) => {
    const claims = await requireRole(req, 'owner');
    const row = await db
      .selectFrom('campaigns')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    return { ok: true, data: { count: Number(row?.count ?? 0) } };
  });

  // POST /campaigns
  app.post('/campaigns', async (req) => {
    const claims = await requireRole(req, 'owner');
    const body = parseBody(CampaignBody, req.body);
    const id = body.id ?? randomUUID();
    const values = campaignValuesFromBody(body, claims.ownerScopeId, id);
    await db.insertInto('campaigns').values(values).execute();
    const row = await db
      .selectFrom('campaigns')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: await toCampaignDtoSigned(row as CampaignRow, signedReadUrl) };
  });

  // PUT /campaigns/:id — full replace, upsert semantics. The SPA mints the
  // campaign id client-side (`custom-<ts>`) and PUTs it for both create and
  // update, so a PUT to an id this owner doesn't have yet is a create — not a
  // 404.
  app.put<{ Params: { id: string } }>('/campaigns/:id', async (req) => {
    const claims = await requireRole(req, 'owner');
    const body = parseBody(CampaignBody, req.body);
    const id = req.params.id;
    const existing = await db
      .selectFrom('campaigns')
      .select('id')
      .where('id', '=', id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    const values = campaignValuesFromBody(body, claims.ownerScopeId, id);
    if (existing) {
      const { id: _omit, owner_id: _omit2, ...updateValues } = values;
      await db
        .updateTable('campaigns')
        .set(updateValues)
        .where('id', '=', id)
        .where('owner_id', '=', claims.ownerScopeId)
        .execute();
    } else {
      await db.insertInto('campaigns').values(values).execute();
    }
    const row = await db
      .selectFrom('campaigns')
      .selectAll()
      .where('id', '=', id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirstOrThrow();
    return { ok: true, data: await toCampaignDtoSigned(row as CampaignRow, signedReadUrl) };
  });

  // PATCH /campaigns/:id/enabled
  app.patch<{ Params: { id: string } }>('/campaigns/:id/enabled', async (req) => {
    const claims = await requireRole(req, 'owner');
    const body = parseBody(UpdateEnabledBody, req.body);
    const result = await db
      .updateTable('campaigns')
      .set({ is_enabled: body.isEnabled })
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');
    }
    return { ok: true, data: { isEnabled: body.isEnabled } };
  });

  // DELETE /campaigns/:id — calls the kept DB function so the snapshot +
  // cascade nullify is one atomic transaction.
  app.delete<{ Params: { id: string } }>('/campaigns/:id', async (req) => {
    const claims = await requireRole(req, 'owner');
    try {
      await sql`
        select loyalty.delete_campaign_preserve_cards(
          ${req.params.id}::text,
          ${claims.ownerScopeId}::uuid
        )
      `.execute(db);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Campaign not found')) {
        throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');
      }
      throw err;
    }
    return { ok: true, data: {} };
  });
};
