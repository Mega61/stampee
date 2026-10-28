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
import { IssueCardBody, UpdateCardBody, TransactionBody, GiftStampsBody } from '../schemas/cards.js';
import { randomUUID } from 'node:crypto';
import { onCardChanged } from '../lib/cardEvents.js';

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
      .select(['id', 'name', 'bonus_stamps'])
      .where('id', '=', body.campaignId)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');

    const id = body.id ?? randomUUID();
    const uniqueId = body.uniqueId ?? randomUUID();
    const today = new Date().toISOString().split('T')[0]!;
    // Gift stamps come from the live campaign, not the client, so a stale or
    // tampered snapshot can't pre-fill a card.
    const bonusStamps = campaign.bonus_stamps;
    const templateSnapshot = body.templateSnapshot
      ? { ...body.templateSnapshot, bonusStamps }
      : null;

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
          stamps: bonusStamps,
          last_visit: today,
          status: 'Active',
          template_snapshot: templateSnapshot,
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
      onCardChanged(req.params.id);
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

    // Resolve the actor's display name. Human actors map to their profile; an
    // API-key actor has no profile row, so attribute the activity to the key.
    let actorId: string | null = claims.sub;
    let actorName: string | null;
    if (claims.role === 'api') {
      actorId = null;
      actorName = `API: ${claims.email}`;
    } else {
      const actor = await db
        .selectFrom('profiles')
        .select('business_name')
        .where('id', '=', claims.sub)
        .executeTakeFirst();
      actorName = actor?.business_name ?? null;
    }

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
        actor_id: actorId,
        actor_name: actorName,
        actor_role: claims.role,
      })
      .execute();
    onCardChanged(req.params.id);
    const row = await db
      .selectFrom('transactions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toTransactionDto(row as TransactionRow) };
  });

  // POST /cards/gift-stamps — win-back gift. Adds up to `stamps` to each
  // active card, but always leaves at least one stamp to earn so a gift never
  // hands out a reward without a visit. Recorded as type 'gift' (not
  // 'stamp_add') so analytics never count it as a visit. Owner/admin only.
  app.post('/cards/gift-stamps', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const body = parseBody(GiftStampsBody, req.body);
    const cardIds = Array.from(new Set(body.cardIds));

    let actorId: string | null = claims.sub;
    let actorName: string | null;
    if (claims.role === 'api') {
      actorId = null;
      actorName = `API: ${claims.email}`;
    } else {
      const actor = await db
        .selectFrom('profiles')
        .select('business_name')
        .where('id', '=', claims.sub)
        .executeTakeFirst();
      actorName = actor?.business_name ?? null;
    }

    const now = new Date();
    const date = now.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const results = await db.transaction().execute(async (trx) => {
      const cards = await trx
        .selectFrom('issued_cards')
        .leftJoin('campaigns', 'campaigns.id', 'issued_cards.campaign_id')
        .select([
          'issued_cards.id as id',
          'issued_cards.stamps as stamps',
          'issued_cards.status as status',
          'issued_cards.template_snapshot as snapshot',
          'campaigns.total_stamps as campaignTotal',
        ])
        .where('issued_cards.id', 'in', cardIds)
        .where('issued_cards.owner_id', '=', claims.ownerScopeId)
        .forUpdate('issued_cards')
        .execute();

      const out: Array<{ cardId: string; added: number; stamps: number; reason?: string }> = [];
      for (const card of cards) {
        // The card's own snapshot is what the customer sees, so it wins.
        const snapshotTotal = Number((card.snapshot as Record<string, unknown> | null)?.['totalStamps']);
        const total = Number.isFinite(snapshotTotal) && snapshotTotal > 0 ? snapshotTotal : card.campaignTotal;
        if (card.status !== 'Active') {
          out.push({ cardId: card.id, added: 0, stamps: card.stamps, reason: 'REDEEMED' });
          continue;
        }
        if (!total) {
          out.push({ cardId: card.id, added: 0, stamps: card.stamps, reason: 'UNKNOWN_TOTAL' });
          continue;
        }
        const added = Math.max(0, Math.min(body.stamps, total - 1 - card.stamps));
        if (added === 0) {
          out.push({ cardId: card.id, added: 0, stamps: card.stamps, reason: 'NEARLY_FULL' });
          continue;
        }
        const stamps = card.stamps + added;
        await trx.updateTable('issued_cards').set({ stamps }).where('id', '=', card.id).execute();
        await trx
          .insertInto('transactions')
          .values({
            id: randomUUID(),
            card_id: card.id,
            type: 'gift',
            amount: added,
            date,
            timestamp: now.getTime(),
            title: 'Gift Stamps',
            remarks: body.remarks ?? null,
            actor_id: actorId,
            actor_name: actorName,
            actor_role: claims.role,
          })
          .execute();
        out.push({ cardId: card.id, added, stamps });
      }
      const found = new Set(cards.map((c) => c.id));
      for (const id of cardIds) {
        if (!found.has(id)) out.push({ cardId: id, added: 0, stamps: 0, reason: 'NOT_FOUND' });
      }
      return out;
    });
    for (const r of results) if (r.added > 0) onCardChanged(r.cardId);

    return {
      ok: true,
      data: {
        results,
        giftedCount: results.filter((r) => r.added > 0).length,
      },
    };
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
