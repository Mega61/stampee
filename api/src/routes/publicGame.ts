// OWNER: agent G. Weekly scratch game "Raspa y gana" (state + play) and the
// owner's cost estimate — see docs/CARD_ENGAGEMENT_PLAN.md §8.
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { parseBody } from '../lib/dto.js';
import { normalizeSlug } from '../lib/slug.js';
import { requireRole } from '../middleware/requireRole.js';
import { EngagementQuery } from '../schemas/engagement.js';
import {
  computeGameState,
  estimateGame,
  GAME_ELIGIBILITY_MS,
  isGameHoldout,
  loadGameCampaign,
  playGame,
  type GameCard,
  type GameUnavailableReason,
} from '../lib/game.js';

const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const PUBLIC_PLAY = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

const UNAVAILABLE_MESSAGES: Record<GameUnavailableReason, string> = {
  DISABLED: 'The game is not enabled for this card.',
  HOLDOUT: 'The game is not available for this card yet.',
  NOT_ACTIVE: 'The card is not active.',
  NO_RECENT_VISIT: 'The card needs a visit in the last 60 days to play.',
};

const EstimateQuery = z.object({
  winPct: z.coerce.number().int().min(0).max(100).optional(),
  cap: z.coerce.number().int().min(0).max(100_000).optional(),
});

const resolveOwnerId = async (rawSlug: string) => {
  const owner = await db
    .selectFrom('profiles')
    .select('id')
    .where('slug', '=', normalizeSlug(rawSlug))
    .where('role', '=', 'owner')
    .executeTakeFirst();
  if (!owner) throw new AppError(404, 'NOT_FOUND', 'Card not found.');
  return owner.id;
};

// ---- GET /analytics/game ----------------------------------------------------
//
// Unit of comparison: a card-week (ISO week, Monday 00:00 Bogota). A card-week
// counts when the card played that week, or was eligible at the week's start
// (a stamp_add in the 60 days before). Its anchor is the play time, or the
// week start for non-players; it "converted" when a real visit (stamp_add)
// happened strictly after the anchor and within 14 days. Only matured
// windows (anchor + 14 d already passed) are counted, so recent weeks don't
// drag the rates down. Weeks before the business's first ever play are left
// out (nobody could play yet). Holdout cards (§8.10) form their own group.

const TZ = 'America/Bogota';
export const GAME_VISIT_WINDOW_DAYS = 14;
/** Card-weeks each group needs before the comparison means something. */
export const MIN_GAME_CARD_WEEKS = 30;

type GameCardStats = {
  unique_id: string;
  played: number;
  played_visited: number;
  idle: number;
  idle_visited: number;
};

const fetchGameCardStats = async (ownerId: string, from: string, to: string): Promise<GameCardStats[]> => {
  const { rows } = await sql<GameCardStats>`
    with launch as (
      select min(played_at) as first_play from loyalty.card_plays where owner_id = ${ownerId}
    ),
    weeks as (
      select (d at time zone ${TZ}) as w_start, to_char(d, 'IYYY-"W"IW') as period_key
      from launch,
        generate_series(date_trunc('week', ${from}::timestamp), ${to}::timestamp, interval '1 week') d
      where launch.first_play is not null
        and d >= date_trunc('week', launch.first_play at time zone ${TZ})
    ),
    cards as (
      select c.id, c.unique_id::text as unique_id
      from loyalty.issued_cards c
      left join loyalty.campaigns k on k.id = c.campaign_id and k.owner_id = c.owner_id
      where c.owner_id = ${ownerId}
        and (coalesce(k.game_enabled, false)
             or exists (select 1 from loyalty.card_plays p where p.card_id = c.id))
    ),
    card_weeks as (
      select c.id as card_id, c.unique_id, (p.id is not null) as played,
        coalesce(p.played_at, w.w_start) as anchor
      from cards c
      cross join weeks w
      left join loyalty.card_plays p on p.card_id = c.id and p.period_key = w.period_key
      where p.id is not null or exists (
        select 1 from loyalty.transactions t
        where t.card_id = c.id and t.type = 'stamp_add'
          and t."timestamp" >= extract(epoch from w.w_start - interval '60 days') * 1000
          and t."timestamp" < extract(epoch from w.w_start) * 1000
      )
    ),
    scored as (
      select cw.*, exists (
        select 1 from loyalty.transactions t
        where t.card_id = cw.card_id and t.type = 'stamp_add'
          and t."timestamp" > extract(epoch from cw.anchor) * 1000
          and t."timestamp" <= extract(epoch from cw.anchor + make_interval(days => ${GAME_VISIT_WINDOW_DAYS})) * 1000
      ) as visited
      from card_weeks cw
      where cw.anchor + make_interval(days => ${GAME_VISIT_WINDOW_DAYS}) <= now()
    )
    select unique_id,
      count(*) filter (where played)::int as played,
      count(*) filter (where played and visited)::int as played_visited,
      count(*) filter (where not played)::int as idle,
      count(*) filter (where not played and visited)::int as idle_visited
    from scored
    group by card_id, unique_id
  `.execute(db);
  return rows;
};

type GameTotals = { plays: number; wins: number; stamps_awarded: number; players: number };
type GameMonth = { month: string; plays: number; wins: number; stamps_awarded: number };

const gameReport = async (ownerId: string, from: string, to: string) => {
  const range = sql`
    played_at >= (${from}::date)::timestamp at time zone ${TZ}
    and played_at < (${to}::date + 1)::timestamp at time zone ${TZ}`;
  const [totals, months, settings, cardStats] = await Promise.all([
    sql<GameTotals>`
      select count(*)::int as plays,
        count(*) filter (where won)::int as wins,
        coalesce(sum(stamps_awarded), 0)::int as stamps_awarded,
        count(distinct card_id)::int as players
      from loyalty.card_plays
      where owner_id = ${ownerId} and ${range}
    `.execute(db),
    sql<GameMonth>`
      select to_char(played_at at time zone ${TZ}, 'YYYY-MM') as month,
        count(*)::int as plays,
        count(*) filter (where won)::int as wins,
        coalesce(sum(stamps_awarded), 0)::int as stamps_awarded
      from loyalty.card_plays
      where owner_id = ${ownerId} and ${range}
      group by 1 order by 1
    `.execute(db),
    db
      .selectFrom('campaigns')
      .select(({ fn }) => [fn.max('game_monthly_cap').as('cap'), fn.countAll<number>().as('enabled')])
      .where('owner_id', '=', ownerId)
      .where('game_enabled', '=', true)
      .executeTakeFirst(),
    fetchGameCardStats(ownerId, from, to),
  ]);

  const t = totals.rows[0]!;
  const enabled = Number(settings?.enabled ?? 0) > 0;
  // The budget is per business; with several campaigns the largest cap rules
  // (each play checks its own campaign's cap against the business total).
  const cap = enabled && settings?.cap != null ? Number(settings.cap) : null;

  const group = () => ({ cardWeeks: 0, visited: 0, rate: null as number | null });
  const players = group();
  const nonPlayers = group();
  const holdout = group();
  for (const row of cardStats) {
    players.cardWeeks += row.played;
    players.visited += row.played_visited;
    const target = isGameHoldout(row.unique_id) ? holdout : nonPlayers;
    target.cardWeeks += row.idle;
    target.visited += row.idle_visited;
  }
  for (const g of [players, nonPlayers, holdout]) g.rate = g.cardWeeks > 0 ? g.visited / g.cardWeeks : null;

  return {
    range: { from, to },
    enabled,
    cap,
    totals: {
      plays: t.plays,
      wins: t.wins,
      stampsAwarded: t.stamps_awarded,
      players: t.players,
      winRate: t.plays > 0 ? t.wins / t.plays : null,
    },
    months: months.rows.map((m) => ({
      month: m.month,
      plays: m.plays,
      wins: m.wins,
      stampsAwarded: m.stamps_awarded,
      cap,
    })),
    comparison: {
      windowDays: GAME_VISIT_WINDOW_DAYS,
      players,
      nonPlayers,
      holdout,
      enoughData: players.cardWeeks >= MIN_GAME_CARD_WEEKS && nonPlayers.cardWeeks >= MIN_GAME_CARD_WEEKS,
    },
  };
};

export const publicGameRoutes: FastifyPluginAsync = async (app) => {
  // GET /public/cards/:slug/:uniqueId/game — this week's game state.
  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/game',
    PUBLIC_GET,
    async (req) => {
      const ownerId = await resolveOwnerId(req.params.slug);
      const card = (await db
        .selectFrom('issued_cards')
        .select(['id', 'unique_id', 'owner_id', 'status', 'stamps', 'template_snapshot', 'campaign_id'])
        .where('unique_id', '=', req.params.uniqueId)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst()) as (GameCard & { campaign_id: string | null }) | undefined;
      if (!card) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      const campaign = await loadGameCampaign(db, card.campaign_id, ownerId);
      return { ok: true, data: await computeGameState(db, card, campaign) };
    },
  );

  // POST /public/cards/:slug/:uniqueId/game/play — the server decides the
  // result (§8.3); the ticket only animates it. Idempotent per card and week.
  app.post<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/game/play',
    PUBLIC_PLAY,
    async (req, reply) => {
      const ownerId = await resolveOwnerId(req.params.slug);
      const outcome = await playGame(db, ownerId, req.params.uniqueId);
      if (outcome.ok) return { ok: true, data: outcome.result };
      if (outcome.reason === 'NOT_FOUND') throw new AppError(404, 'NOT_FOUND', 'Card not found.');
      return reply.status(409).send({
        ok: false,
        error: {
          code: 'GAME_UNAVAILABLE',
          message: UNAVAILABLE_MESSAGES[outcome.reason],
          reason: outcome.reason,
        },
      });
    },
  );

  // GET /analytics/game?from&to (owner/admin) — does the game pay off? (§8.8,
  // §8.10). Plays/wins/cost for plays in range, monthly cap usage, and the
  // share of "card-weeks" followed by a real visit within 14 days for
  // players vs eligible non-players vs the game holdout.
  app.get('/analytics/game', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const { from, to } = parseBody(EngagementQuery, req.query);
    return { ok: true, data: await gameReport(claims.ownerScopeId, from, to) };
  });

  // GET /campaigns/:id/game-estimate?winPct=&cap= — owner preview of what the
  // game costs per month (§8.4). Query params let the editor preview unsaved
  // settings; they default to the campaign's current values.
  app.get<{ Params: { id: string } }>('/campaigns/:id/game-estimate', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const query = parseBody(EstimateQuery, req.query);
    const campaign = await db
      .selectFrom('campaigns')
      .select(['id', 'total_stamps', 'game_win_pct', 'game_monthly_cap'])
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');

    const since = Date.now() - GAME_ELIGIBILITY_MS;
    const row = await db
      .selectFrom('issued_cards')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('campaign_id', '=', campaign.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .where('status', '=', 'Active')
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom('transactions')
            .select('transactions.id')
            .whereRef('transactions.card_id', '=', 'issued_cards.id')
            .where('transactions.type', '=', 'stamp_add')
            .where('transactions.timestamp', '>=', since),
        ),
      )
      .executeTakeFirst();

    return {
      ok: true,
      data: estimateGame({
        eligibleCards: Number(row?.count ?? 0),
        winPct: query.winPct ?? campaign.game_win_pct,
        cap: query.cap ?? campaign.game_monthly_cap,
        totalStamps: campaign.total_stamps,
      }),
    };
  });
};
