import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  toIssuedCardDto,
  toTransactionDto,
  parseBody,
  type IssuedCardRow,
  type TransactionRow,
} from '../lib/dto.js';
import { IssueCardBody, UpdateCardBody, TransactionBody } from '../schemas/cards.js';
import { randomUUID } from 'node:crypto';

export const cardRoutes: FastifyPluginAsync = async (app) => {
  // GET /cards/count
  app.get('/cards/count', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const row = await db
      .selectFrom('issued_cards')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    return { ok: true, data: { count: Number(row?.count ?? 0) } };
  });

  // POST /cards — issue
  app.post('/cards', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const body = parseBody(IssueCardBody, req.body);

    // Customer + campaign must belong to current owner scope.
    const customer = await db
      .selectFrom('customers')
      .select('id')
      .where('id', '=', body.customerId)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');

    const campaign = await db
      .selectFrom('campaigns')
      .select(['id', 'name'])
      .where('id', '=', body.campaignId)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');

    const id = body.id ?? randomUUID();
    const uniqueId = body.uniqueId ?? randomUUID();
    const today = new Date().toISOString().split('T')[0]!;

    try {
      await db
        .insertInto('issued_cards')
        .values({
          id,
          unique_id: uniqueId,
          customer_id: body.customerId,
          campaign_id: body.campaignId,
          owner_id: claims.ownerScopeId,
          campaign_name: body.campaignName ?? campaign.name,
          stamps: 0,
          last_visit: today,
          status: 'Active',
          template_snapshot: body.templateSnapshot ?? null,
        })
        .execute();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('CAMPAIGN_DISABLED')) {
        throw new AppError(409, 'CAMPAIGN_DISABLED', 'This campaign is disabled and cannot issue new cards.');
      }
      throw err;
    }

    const row = await db
      .selectFrom('issued_cards')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toIssuedCardDto(row as IssuedCardRow) };
  });

  // PATCH /cards/:id
  app.patch<{ Params: { id: string } }>('/cards/:id', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const body = parseBody(UpdateCardBody, req.body);

    const existing = await db
      .selectFrom('issued_cards')
      .select('id')
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

    const updates: Record<string, unknown> = {};
    if (body.stamps !== undefined) updates['stamps'] = body.stamps;
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.completedDate !== undefined) updates['completed_date'] = body.completedDate;
    if (body.lastVisit !== undefined) updates['last_visit'] = body.lastVisit;

    if (Object.keys(updates).length > 0) {
      await db
        .updateTable('issued_cards')
        .set(updates)
        .where('id', '=', req.params.id)
        .execute();
    }

    const row = await db
      .selectFrom('issued_cards')
      .selectAll()
      .where('id', '=', req.params.id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toIssuedCardDto(row as IssuedCardRow) };
  });

  // DELETE /cards/:id — owner only
  app.delete<{ Params: { id: string } }>('/cards/:id', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const result = await db
      .deleteFrom('issued_cards')
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Card not found.');
    }
    return { ok: true, data: {} };
  });

  // POST /cards/:id/transactions — append an activity row. Server overrides
  // actor_* from the JWT (no client spoofing).
  app.post<{ Params: { id: string } }>('/cards/:id/transactions', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const body = parseBody(TransactionBody, req.body);

    const card = await db
      .selectFrom('issued_cards')
      .select('id')
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!card) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

    // Look up the actor's display name from their profile.
    const actor = await db
      .selectFrom('profiles')
      .select('business_name')
      .where('id', '=', claims.sub)
      .executeTakeFirst();

    const id = body.id ?? randomUUID();
    await db
      .insertInto('transactions')
      .values({
        id,
        card_id: req.params.id,
        type: body.type,
        amount: body.amount,
        date: body.date,
        timestamp: body.timestamp,
        title: body.title,
        remarks: body.remarks ?? null,
        actor_id: claims.sub,
        actor_name: actor?.business_name ?? null,
        actor_role: claims.role,
      })
      .execute();
    const row = await db
      .selectFrom('transactions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toTransactionDto(row as TransactionRow) };
  });

  // GET /scan/inspect/:uniqueId — replaces inspect_scanned_card RPC.
  app.get<{ Params: { uniqueId: string } }>('/scan/inspect/:uniqueId', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const row = await db
      .selectFrom('issued_cards')
      .select('owner_id')
      .where('unique_id', '=', req.params.uniqueId)
      .executeTakeFirst();
    if (!row) return { ok: true, data: { status: 'missing' as const } };
    if (row.owner_id !== claims.ownerScopeId) {
      return { ok: true, data: { status: 'foreign' as const } };
    }
    return { ok: true, data: { status: 'owned' as const } };
  });
};
