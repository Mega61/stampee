// Gift cards ("tarjetas regalo") — authenticated surface. The lifecycle rules
// live in lib/giftCards.ts; these handlers parse, scope to the owner and shape
// responses. Payment confirmation and redemption are called by the studio
// panel (API key), which is where the money is booked.
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { parseBody } from '../lib/dto.js';
import { requireRole } from '../middleware/requireRole.js';
import { resolveActor } from '../lib/giftStamps.js';
import {
  activateGiftCard,
  bogotaDate,
  issueGiftCard,
  normalizeGiftCode,
  publicBaseFor,
  redeemGiftCard,
  sqlBogotaToday,
  toGiftCardDto,
  unredeemGiftCard,
  updateGiftCard,
  upsertCustomerByPhone,
  voidGiftCard,
  type GiftCardRow,
  type GiftCardRules,
} from '../lib/giftCards.js';
import {
  ActivateGiftCardBody,
  CreateGiftCardBody,
  CreateTierBody,
  GiftCardListQuery,
  RedeemGiftCardBody,
  TierListQuery,
  UnredeemGiftCardBody,
  UpdateGiftCardBody,
  UpdateTierBody,
  VoidGiftCardBody,
} from '../schemas/giftCards.js';
import type { GiftCardTiersTable } from '../db/types.js';
import type { Selectable } from 'kysely';

type TierRow = Selectable<GiftCardTiersTable>;

export const toTierDto = (t: TierRow) => ({
  id: t.id,
  name: t.name,
  amountCop: t.amount_cop,
  description: t.description,
  validityDays: t.validity_days,
  isEnabled: t.is_enabled,
  sort: t.sort,
  design: t.design ?? null,
  createdAt: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
});

const publicBase = async (ownerId: string) =>
  publicBaseFor((await db.selectFrom('profiles').select('slug').where('id', '=', ownerId).executeTakeFirst())?.slug);

/** Bare dates are payments recorded for a day: take noon in Bogota. */
const parsePaidAt = (value: string | undefined): Date => {
  if (!value) return new Date();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-05:00`) : new Date(value);
};

const escapeLike = (v: string) => v.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`);

export const giftCardRoutes: FastifyPluginAsync = async (app) => {
  // ------------------------------------------------------------ tiers

  app.get('/gift-card-tiers', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const query = parseBody(TierListQuery, req.query);
    let q = db.selectFrom('gift_card_tiers').selectAll().where('owner_id', '=', claims.ownerScopeId);
    if (query.enabled === '1' || query.enabled === 'true') q = q.where('is_enabled', '=', true);
    const rows = await q.orderBy('sort', 'asc').orderBy('amount_cop', 'asc').execute();
    return { ok: true, data: rows.map(toTierDto) };
  });

  app.post('/gift-card-tiers', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const body = parseBody(CreateTierBody, req.body);
    const row = await db
      .insertInto('gift_card_tiers')
      .values({
        owner_id: claims.ownerScopeId,
        name: body.name,
        amount_cop: body.amountCop,
        description: body.description ?? '',
        validity_days: body.validityDays ?? 365,
        is_enabled: body.isEnabled ?? true,
        sort: body.sort ?? 0,
        design: body.design ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { ok: true, data: toTierDto(row) };
  });

  app.patch<{ Params: { id: string } }>('/gift-card-tiers/:id', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const body = parseBody(UpdateTierBody, req.body);
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set['name'] = body.name;
    if (body.amountCop !== undefined) set['amount_cop'] = body.amountCop;
    if (body.description !== undefined) set['description'] = body.description;
    if (body.validityDays !== undefined) set['validity_days'] = body.validityDays;
    if (body.isEnabled !== undefined) set['is_enabled'] = body.isEnabled;
    if (body.sort !== undefined) set['sort'] = body.sort;
    if (body.design !== undefined) set['design'] = body.design;
    if (Object.keys(set).length > 0) {
      await db
        .updateTable('gift_card_tiers')
        .set(set)
        .where('id', '=', req.params.id)
        .where('owner_id', '=', claims.ownerScopeId)
        .execute();
    }
    const q = db.selectFrom('gift_card_tiers').selectAll().where('id', '=', req.params.id).where('owner_id', '=', claims.ownerScopeId);
    const row = await q.executeTakeFirst();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Tier not found.');
    return { ok: true, data: toTierDto(row) };
  });

  // Soft delete: issued cards keep pointing at the tier (name/amount snapshot).
  app.delete<{ Params: { id: string } }>('/gift-card-tiers/:id', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const row = await db
      .updateTable('gift_card_tiers')
      .set({ is_enabled: false })
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Tier not found.');
    return { ok: true, data: toTierDto(row) };
  });

  // ------------------------------------------------------------ cards

  // GET /gift-cards?status=&q=&source=&limit=&offset= — newest first. `status`
  // is the effective status ('active' excludes expired cards). The total
  // matching count is in the X-Total-Count header.
  app.get('/gift-cards', async (req, reply) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const query = parseBody(GiftCardListQuery, req.query);
    let q = db.selectFrom('gift_cards').where('owner_id', '=', claims.ownerScopeId);
    if (query.status === 'expired') {
      q = q.where('status', '=', 'active').where('valid_to', '<', sqlBogotaToday);
    } else if (query.status === 'active') {
      q = q.where('status', '=', 'active').where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', sqlBogotaToday)]));
    } else if (query.status) {
      q = q.where('status', '=', query.status);
    }
    if (query.source) q = q.where('source', '=', query.source);
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      const digits = query.q.replace(/\D+/g, '');
      const codeLike = `%${escapeLike(normalizeGiftCode(query.q))}%`;
      q = q.where((eb) =>
        eb.or([
          eb(sql`lower(code::text)`, 'like', like),
          eb(sql`lower(code::text)`, 'like', codeLike),
          eb(sql`lower(buyer_name)`, 'like', like),
          eb(sql`lower(coalesce(recipient_name, ''))`, 'like', like),
          ...(digits.length >= 4
            ? [
                eb(sql`regexp_replace(buyer_phone, '[^0-9]+', '', 'g')`, 'like', `%${digits.slice(-10)}%`),
                eb(sql`regexp_replace(coalesce(recipient_phone, ''), '[^0-9]+', '', 'g')`, 'like', `%${digits.slice(-10)}%`),
              ]
            : []),
        ]),
      );
    }
    const [rows, total] = await Promise.all([
      q.selectAll().orderBy('created_at', 'desc').limit(query.limit).offset(query.offset).execute(),
      q.select(({ fn }) => fn.countAll<number>().as('n')).executeTakeFirst(),
    ]);
    const base = await publicBase(claims.ownerScopeId);
    const today = bogotaDate();
    reply.header('X-Total-Count', String(Number(total?.n ?? 0)));
    return { ok: true, data: (rows as GiftCardRow[]).map((r) => toGiftCardDto(r, base, today)) };
  });

  app.get('/gift-cards/stats', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const ownerId = claims.ownerScopeId;
    const { rows: [totals] } = await sql<{
      sold_n: number; sold_cop: number;
      pending_n: number; pending_cop: number;
      active_n: number; active_cop: number;
      redeemed_n: number; redeemed_cop: number;
      expired_n: number; expired_cop: number;
      liability_cop: number;
      avg_days: number | null;
      views_without_recipient: number;
    }>`
      with t as (select (now() at time zone 'America/Bogota')::date as today),
      c as (
        select g.*,
          (g.status = 'active' and g.valid_to is not null and g.valid_to < t.today) as is_expired
        from loyalty.gift_cards g, t
        where g.owner_id = ${ownerId}
      )
      select
        count(*) filter (where funded and paid_at is not null and status <> 'void')::int as sold_n,
        coalesce(sum(amount_cop) filter (where funded and paid_at is not null and status <> 'void'), 0)::int as sold_cop,
        count(*) filter (where status = 'pending_payment')::int as pending_n,
        coalesce(sum(amount_cop) filter (where status = 'pending_payment'), 0)::int as pending_cop,
        count(*) filter (where status = 'active' and not is_expired)::int as active_n,
        coalesce(sum(amount_cop) filter (where status = 'active' and not is_expired), 0)::int as active_cop,
        count(*) filter (where status = 'redeemed')::int as redeemed_n,
        coalesce(sum(amount_cop) filter (where status = 'redeemed'), 0)::int as redeemed_cop,
        count(*) filter (where is_expired)::int as expired_n,
        coalesce(sum(amount_cop) filter (where is_expired), 0)::int as expired_cop,
        coalesce(sum(amount_cop) filter (where funded and status = 'active' and not is_expired), 0)::int as liability_cop,
        (avg(extract(epoch from (redeemed_at - coalesce(paid_at, created_at))) / 86400)
          filter (where status = 'redeemed' and redeemed_at is not null))::float8 as avg_days,
        count(*) filter (
          where status in ('pending_payment', 'active') and not is_expired and recipient_name is null
            and exists (select 1 from loyalty.gift_card_events e where e.gift_card_id = c.id and e.type = 'viewed')
        )::int as views_without_recipient
      from c
    `.execute(db);

    const { rows: byTier } = await sql<{ tier_id: string | null; name: string; count: number; amount_cop: number }>`
      select tier_id, tier_name as name, count(*)::int as count, coalesce(sum(amount_cop), 0)::int as amount_cop
      from loyalty.gift_cards
      where owner_id = ${ownerId} and funded and paid_at is not null and status <> 'void'
      group by tier_id, tier_name
      order by amount_cop desc
    `.execute(db);

    const { rows: bySource } = await sql<{ source: string; count: number; amount_cop: number }>`
      select source, count(*)::int as count, coalesce(sum(amount_cop), 0)::int as amount_cop
      from loyalty.gift_cards
      where owner_id = ${ownerId} and status <> 'void'
      group by source
      order by source
    `.execute(db);

    // Sales per Bogota day (paid date), last 30 days including today, zero-filled.
    const { rows: daily } = await sql<{ date: string; count: number; amount_cop: number }>`
      with days as (
        select generate_series(
          (now() at time zone 'America/Bogota')::date - 29,
          (now() at time zone 'America/Bogota')::date,
          interval '1 day'
        )::date as d
      )
      select to_char(days.d, 'YYYY-MM-DD') as date,
        count(g.id)::int as count,
        coalesce(sum(g.amount_cop), 0)::int as amount_cop
      from days
      left join loyalty.gift_cards g
        on g.owner_id = ${ownerId} and g.funded and g.status <> 'void' and g.paid_at is not null
        and (g.paid_at at time zone 'America/Bogota')::date = days.d
      group by days.d
      order by days.d
    `.execute(db);

    const t = totals!;
    return {
      ok: true,
      data: {
        sold: { count: t.sold_n, amountCop: t.sold_cop },
        pending: { count: t.pending_n, amountCop: t.pending_cop },
        active: { count: t.active_n, amountCop: t.active_cop },
        redeemed: { count: t.redeemed_n, amountCop: t.redeemed_cop },
        expired: { count: t.expired_n, amountCop: t.expired_cop },
        outstandingLiabilityCop: t.liability_cop,
        byTier: byTier.map((r) => ({ tierId: r.tier_id, name: r.name, count: r.count, amountCop: r.amount_cop })),
        bySource: bySource.map((r) => ({ source: r.source, count: r.count, amountCop: r.amount_cop })),
        last30d: daily.map((r) => ({ date: r.date, count: r.count, amountCop: r.amount_cop })),
        avgDaysToRedeem: t.avg_days === null ? null : Math.round(t.avg_days * 10) / 10,
        viewsWithoutRecipient: t.views_without_recipient,
      },
    };
  });

  // POST /gift-cards — new order / manual card. Sale orders must name an
  // enabled tier and always take its amount; manual cards (owner/admin) may
  // set any amount and may be promotional (funded=false → active at once).
  app.post('/gift-cards', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const body = parseBody(CreateGiftCardBody, req.body);
    const ownerId = claims.ownerScopeId;

    let amountCop: number;
    let tierId: string | null = null;
    const funded = body.funded ?? true;
    if (body.source === 'sale') {
      if (!body.tierId) throw new AppError(400, 'TIER_REQUIRED', 'Sale orders must reference a gift card tier.');
      const tier = await db
        .selectFrom('gift_card_tiers')
        .select(['id', 'amount_cop', 'is_enabled'])
        .where('id', '=', body.tierId)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!tier || !tier.is_enabled) throw new AppError(400, 'TIER_UNAVAILABLE', 'That gift card tier is not available.');
      if (!funded) throw new AppError(400, 'VALIDATION', 'funded: sale orders are always funded.');
      amountCop = tier.amount_cop;
      tierId = tier.id;
    } else {
      if (claims.role === 'staff') throw new AppError(403, 'FORBIDDEN', 'Only owners and admins can issue manual gift cards.');
      if (body.tierId) {
        const tier = await db
          .selectFrom('gift_card_tiers')
          .select(['id', 'amount_cop'])
          .where('id', '=', body.tierId)
          .where('owner_id', '=', ownerId)
          .executeTakeFirst();
        if (!tier) throw new AppError(400, 'TIER_UNAVAILABLE', 'That gift card tier does not exist.');
        tierId = tier.id;
        amountCop = body.amountCop ?? tier.amount_cop;
      } else if (body.amountCop) {
        amountCop = body.amountCop;
      } else {
        throw new AppError(400, 'VALIDATION', 'amountCop: required when no tier is given.');
      }
    }

    const actor = await resolveActor(db, claims);
    const rules: GiftCardRules = { ...(body.rules ?? {}) };
    if (body.ref) rules.ref = body.ref;

    const result = await db.transaction().execute(async (trx) => {
      const buyerCustomerId = await upsertCustomerByPhone(trx, ownerId, body.buyer);
      if (!buyerCustomerId) throw new AppError(400, 'VALIDATION', 'buyer.phone: must contain at least 7 digits.');
      return issueGiftCard(trx, {
        ownerId,
        buyerCustomerId,
        buyerName: body.buyer.name,
        buyerPhone: body.buyer.phone,
        amountCop,
        tierId,
        source: body.source,
        funded,
        rules,
        message: body.message,
        recipientName: body.recipientName,
        minTicketCop: body.minTicketCop ?? null,
        externalRef: body.externalRef,
        actorName: actor.name,
      });
    });
    const row = (await db.selectFrom('gift_cards').selectAll().where('id', '=', result.giftCardId).executeTakeFirstOrThrow()) as GiftCardRow;
    return { ok: true, data: toGiftCardDto(row, await publicBase(ownerId)) };
  });

  app.get<{ Params: { code: string } }>('/gift-cards/by-code/:code', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const row = (await db
      .selectFrom('gift_cards')
      .selectAll()
      .where('owner_id', '=', claims.ownerScopeId)
      .where('code', '=', normalizeGiftCode(req.params.code))
      .executeTakeFirst()) as GiftCardRow | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Gift card not found.');
    return { ok: true, data: toGiftCardDto(row, await publicBase(claims.ownerScopeId)) };
  });

  // GET /gift-cards/:id — the DTO plus its events (audit trail, newest last).
  app.get<{ Params: { id: string } }>('/gift-cards/:id', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const row = (await db
      .selectFrom('gift_cards')
      .selectAll()
      .where('owner_id', '=', claims.ownerScopeId)
      .where('id', '=', req.params.id)
      .executeTakeFirst()) as GiftCardRow | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Gift card not found.');
    const events = await db
      .selectFrom('gift_card_events')
      .selectAll()
      .where('gift_card_id', '=', row.id)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return {
      ok: true,
      data: {
        ...toGiftCardDto(row, await publicBase(claims.ownerScopeId)),
        events: events.map((e) => ({
          id: Number(e.id),
          type: e.type,
          data: e.data,
          actorName: e.actor_name,
          createdAt: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
      },
    };
  });

  app.post<{ Params: { id: string } }>('/gift-cards/:id/activate', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const body = parseBody(ActivateGiftCardBody, req.body);
    const actor = await resolveActor(db, claims);
    const { card } = await activateGiftCard(
      db,
      claims.ownerScopeId,
      req.params.id,
      { paidAt: parsePaidAt(body.paidAt), method: body.method, paidAmountCop: body.paidAmountCop, paidRef: body.paidRef },
      actor,
    );
    return { ok: true, data: toGiftCardDto(card, await publicBase(claims.ownerScopeId)) };
  });

  app.patch<{ Params: { id: string } }>('/gift-cards/:id', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const body = parseBody(UpdateGiftCardBody, req.body);
    const actor = await resolveActor(db, claims);
    const card = await updateGiftCard(db, claims.ownerScopeId, req.params.id, body, actor);
    return { ok: true, data: toGiftCardDto(card, await publicBase(claims.ownerScopeId)) };
  });

  app.post<{ Params: { id: string } }>('/gift-cards/:id/void', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const body = parseBody(VoidGiftCardBody, req.body);
    const actor = await resolveActor(db, claims);
    const card = await voidGiftCard(db, claims.ownerScopeId, req.params.id, body.reason, actor);
    return { ok: true, data: toGiftCardDto(card, await publicBase(claims.ownerScopeId)) };
  });

  app.post<{ Params: { code: string } }>('/gift-cards/by-code/:code/redeem', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const body = parseBody(RedeemGiftCardBody, req.body);
    const actor = await resolveActor(db, claims);
    const { card, alreadyRedeemed } = await redeemGiftCard(
      db,
      claims.ownerScopeId,
      { code: req.params.code, externalRef: body.externalRef, amountUsedCop: body.amountUsedCop, customer: body.customer, date: body.date },
      actor,
    );
    return { ok: true, data: { ...toGiftCardDto(card, await publicBase(claims.ownerScopeId)), alreadyRedeemed } };
  });

  app.post<{ Params: { code: string } }>('/gift-cards/by-code/:code/unredeem', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const body = parseBody(UnredeemGiftCardBody, req.body);
    const actor = await resolveActor(db, claims);
    const { card } = await unredeemGiftCard(db, claims.ownerScopeId, req.params.code, body.externalRef, actor);
    return { ok: true, data: toGiftCardDto(card, await publicBase(claims.ownerScopeId)) };
  });
};
