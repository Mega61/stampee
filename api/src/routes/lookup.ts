import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../db/kysely.js';
import { env } from '../config.js';
import { AppError } from '../lib/errors.js';
import { requireRole } from '../middleware/requireRole.js';
import { parseBody, type CustomerRow, type IssuedCardRow, type TransactionRow } from '../lib/dto.js';

// Read-only loyalty lookups for external panels (API key) and the SPA.
// Unlike GET /customers?include=cards, these find ONE client by phone/email/id
// and return each card pre-summarized (stamps to go, reward, gifts, dates), so
// a consumer never has to re-derive loyalty logic from raw rows.

const LookupQuery = z
  .object({
    phone: z.string().trim().max(50).optional(),
    email: z.string().trim().max(254).optional(),
    id: z.string().trim().max(120).optional(),
    q: z.string().trim().min(2).max(120).optional(),
    includeRedeemed: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine((v) => v.phone || v.email || v.id || v.q, {
    message: 'Provide one of phone, email, id or q.',
    path: ['phone'],
  });

const SummaryQuery = z.object({
  includeRedeemed: z.enum(['true', 'false']).optional(),
});

/** Mobiles are matched on their last 10 digits so "+57 300…", "300…" and "57300…" all hit. */
const phoneKey = (value: string) => value.replace(/\D+/g, '').slice(-10);

type CampaignInfo = { id: string; name: string; is_enabled: boolean; total_stamps: number; bonus_stamps: number; reward_name: string };

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const iso = (ts: number | null) => (ts === null ? null : new Date(ts).toISOString());
const dateOnly = (value: Date | string | null) =>
  value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export const summarizeCard = (
  card: IssuedCardRow,
  history: TransactionRow[],
  campaign: CampaignInfo | undefined,
  publicBase: string | null,
) => {
  const snapshot = card.template_snapshot ?? {};
  // The snapshot is what the customer actually sees on their card.
  const totalStamps = num(snapshot['totalStamps']) ?? campaign?.total_stamps ?? card.stamps;
  let winBackGift = 0;
  let gameBonus = 0;
  let issuedAmount: number | undefined;
  let issuedAt: number | null = null;
  let lastVisitAt: number | null = null;
  let lastActivityAt: number | null = null;
  let redeemedAt: number | null = null;
  for (const tx of history) {
    const ts = Number(tx.timestamp);
    if (lastActivityAt === null || ts > lastActivityAt) lastActivityAt = ts;
    if (tx.type === 'issued' && (issuedAt === null || ts < issuedAt)) {
      issuedAt = ts;
      issuedAmount = tx.amount;
    }
    if (tx.type === 'stamp_add' && (lastVisitAt === null || ts > lastVisitAt)) lastVisitAt = ts;
    if (tx.type === 'redeem' && (redeemedAt === null || ts > redeemedAt)) redeemedAt = ts;
    if (tx.type === 'gift') winBackGift += tx.amount;
    // Weekly scratch game stamps are never visits either.
    if (tx.type === 'bonus') gameBonus += tx.amount;
  }

  // Welcome gift: snapshot first, then the amount recorded on the 'issued'
  // row, then (cards issued via API with neither) the campaign's setting.
  const welcomeGift = Math.min(
    num(snapshot['bonusStamps']) ?? issuedAmount ?? campaign?.bonus_stamps ?? 0,
    Math.max(totalStamps - 1, 0),
  );
  const remaining = Math.max(totalStamps - card.stamps, 0);
  return {
    id: card.id,
    uniqueId: card.unique_id,
    campaignId: card.campaign_id,
    campaignName: card.campaign_name,
    campaignEnabled: campaign ? campaign.is_enabled : false,
    rewardName: str(snapshot['rewardName']) ?? campaign?.reward_name ?? '',
    status: card.status,
    stamps: card.stamps,
    totalStamps,
    stampsRemaining: remaining,
    readyToRedeem: card.status === 'Active' && remaining === 0,
    giftedStamps: { welcome: welcomeGift, winBack: winBackGift, game: gameBonus },
    stampsFromVisits: Math.max(card.stamps - welcomeGift - winBackGift - gameBonus, 0),
    issuedAt: iso(issuedAt) ?? (card.created_at ? new Date(card.created_at).toISOString() : null),
    lastVisitAt: iso(lastVisitAt),
    lastActivityAt: iso(lastActivityAt) ?? dateOnly(card.last_visit),
    redeemedAt: iso(redeemedAt) ?? dateOnly(card.completed_date),
    publicUrl: publicBase ? `${publicBase}/${card.unique_id}` : null,
  };
};

const buildSummaries = async (
  ownerId: string,
  customers: CustomerRow[],
  includeRedeemed: boolean,
) => {
  if (customers.length === 0) return [];

  const owner = await db.selectFrom('profiles').select('slug').where('id', '=', ownerId).executeTakeFirst();
  const publicBase = owner?.slug ? `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/${owner.slug}` : null;

  let cardQuery = db
    .selectFrom('issued_cards')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('customer_id', 'in', customers.map((c) => c.id));
  if (!includeRedeemed) cardQuery = cardQuery.where('status', '=', 'Active');
  const cards = (await cardQuery.orderBy('created_at', 'desc').execute()) as IssuedCardRow[];

  const history = cards.length
    ? ((await db
        .selectFrom('transactions')
        .selectAll()
        .where('card_id', 'in', cards.map((c) => c.id))
        .execute()) as TransactionRow[])
    : [];
  const historyByCard = new Map<string, TransactionRow[]>();
  history.forEach((tx) => historyByCard.set(tx.card_id, [...(historyByCard.get(tx.card_id) ?? []), tx]));

  const campaignIds = [...new Set(cards.map((c) => c.campaign_id).filter((id): id is string => Boolean(id)))];
  const campaigns = campaignIds.length
    ? await db
        .selectFrom('campaigns')
        .select(['id', 'name', 'is_enabled', 'total_stamps', 'bonus_stamps', 'reward_name'])
        .where('owner_id', '=', ownerId)
        .where('id', 'in', campaignIds)
        .execute()
    : [];
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));

  return customers.map((customer) => {
    const customerCards = cards
      .filter((card) => card.customer_id === customer.id)
      .map((card) =>
        summarizeCard(card, historyByCard.get(card.id) ?? [], card.campaign_id ? campaignById.get(card.campaign_id) : undefined, publicBase),
      );
    const active = customerCards.filter((c) => c.status === 'Active');
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email || null,
      mobile: customer.mobile,
      status: customer.status,
      totals: {
        activeCards: active.length,
        readyToRedeem: active.filter((c) => c.readyToRedeem).length,
        activeStamps: active.reduce((sum, c) => sum + c.stamps, 0),
      },
      cards: customerCards,
    };
  });
};

export const lookupRoutes: FastifyPluginAsync = async (app) => {
  // GET /customers/lookup?phone=|email=|id=|q= — find clients + their loyalty.
  app.get('/customers/lookup', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const query = parseBody(LookupQuery, req.query);

    let customerQuery = db.selectFrom('customers').selectAll().where('owner_id', '=', claims.ownerScopeId);
    if (query.id) customerQuery = customerQuery.where('id', '=', query.id);
    if (query.email) customerQuery = customerQuery.where(sql`lower(trim(email))`, '=', query.email.toLowerCase());
    if (query.phone) {
      const key = phoneKey(query.phone);
      if (key.length < 7) throw new AppError(400, 'VALIDATION', 'phone: Must contain at least 7 digits.');
      customerQuery = customerQuery.where(
        sql`right(regexp_replace(coalesce(mobile, ''), '[^0-9]+', '', 'g'), 10)`,
        '=',
        key,
      );
    }
    if (query.q) {
      const like = `%${query.q.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const digits = phoneKey(query.q);
      customerQuery = customerQuery.where((eb) =>
        eb.or([
          eb(sql`lower(name)`, 'like', like),
          eb(sql`lower(email)`, 'like', like),
          ...(digits.length >= 4
            ? [eb(sql`regexp_replace(coalesce(mobile, ''), '[^0-9]+', '', 'g')`, 'like', `%${digits}%`)]
            : []),
        ]),
      );
    }

    const customers = (await customerQuery.orderBy('created_at', 'asc').limit(query.limit).execute()) as CustomerRow[];
    const data = await buildSummaries(claims.ownerScopeId, customers, query.includeRedeemed === 'true');
    return { ok: true, data };
  });

  // GET /customers/:id/loyalty — one client's loyalty summary.
  app.get<{ Params: { id: string } }>('/customers/:id/loyalty', async (req) => {
    const claims = await requireRole(req, 'owner', 'staff', 'admin');
    const query = parseBody(SummaryQuery, req.query);
    const customer = (await db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst()) as CustomerRow | undefined;
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');
    const [summary] = await buildSummaries(claims.ownerScopeId, [customer], query.includeRedeemed === 'true');
    return { ok: true, data: summary };
  });
};
