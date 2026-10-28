// OWNER: agent A.
// GET /analytics/engagement?from&to (owner/admin) — does opening the card bring
// clients back? Metric definitions: docs/CARD_ENGAGEMENT_PLAN.md §4.4.
//
// Conventions (all owner-scoped):
//   - Day boundaries are America/Bogota; `from`/`to` are inclusive dates.
//   - A visit is a `stamp_add` transaction (gift/bonus/issued are not visits),
//     counted once per card per Bogota day so several stamps in one sitting
//     don't create zero-day gaps (same as the page's "Days between visits").
//   - Experiment arm per card = the shared holdout hash on unique_id.
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { db } from '../db/kysely.js';
import { parseBody } from '../lib/dto.js';
import { cardBucket, FX_HOLDOUT_BUCKET } from '../lib/holdout.js';
import { requireRole } from '../middleware/requireRole.js';
import { EngagementQuery } from '../schemas/engagement.js';

const TZ = 'America/Bogota';
const COMEBACK_WINDOW_DAYS = 45;
const REOPEN_WINDOW_DAYS = 30;
const OPEN_TO_VISIT_DAYS = 14;
/** Each experiment arm needs this many cards with a visit before we compare. */
export const MIN_CARDS_PER_ARM = 50;

type CardRow = {
  id: string;
  unique_id: string;
  status: 'Active' | 'Redeemed';
  /** ≥1 visit (Bogota day) in range. */
  visited: boolean;
  /** Some in-range visit was followed by another visit within 45 days. */
  came_back: boolean;
  /** Days since the previous visit, for every in-range visit that had one. */
  gaps: number[];
  /** Sessions started in range. */
  sessions: number;
  opened: boolean;
  reopened: boolean;
  visited_after_open: boolean;
};

type SessionAgg = {
  sessions: number;
  median_ms: number | null;
  link: number;
  pwa: number;
  wallet: number;
  whatsapp: number;
};

const DAY_MS = 86_400_000;
const shiftDate = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

// One row per card of the owner with its visit / open stats for [from, to].
// Visits and opens before the range are still read so the first in-range gap
// (and a reopen of an earlier open) is measured against real history; visits
// after the range count as comebacks.
const fetchCardRows = async (ownerId: string, from: string, to: string): Promise<CardRow[]> => {
  const { rows } = await sql<CardRow>`
    with b as (
      select (${from}::date)::timestamp at time zone ${TZ} as start_at,
             (${to}::date + 1)::timestamp at time zone ${TZ} as end_at
    ),
    visit_days as (
      select distinct t.card_id,
        (to_timestamp(t."timestamp" / 1000.0) at time zone ${TZ})::date as day
      from loyalty.transactions t
      join loyalty.issued_cards c on c.id = t.card_id
      where c.owner_id = ${ownerId} and t.type = 'stamp_add'
    ),
    visit_seq as (
      select card_id, day,
        day - lag(day) over w as gap_before,
        lead(day) over w - day as gap_after
      from visit_days
      window w as (partition by card_id order by day)
    ),
    visit_stats as (
      select card_id,
        bool_or(gap_after <= ${COMEBACK_WINDOW_DAYS}) as came_back,
        array_remove(array_agg(gap_before order by day), null) as gaps
      from visit_seq
      where day between ${from}::date and ${to}::date
      group by card_id
    ),
    -- "Reopened" = a card opened on some Bogota day in range whose previous
    -- open was on an earlier day at most 30 days before. Reloads on the same
    -- day don't count; the previous open may fall before the range.
    open_days as (
      select distinct cv.card_id, (cv.started_at at time zone ${TZ})::date as day
      from loyalty.card_views cv, b
      where cv.owner_id = ${ownerId} and cv.started_at < b.end_at
    ),
    open_stats as (
      select card_id, bool_or(gap_before <= ${REOPEN_WINDOW_DAYS}) as reopened
      from (
        select card_id, day, day - lag(day) over (partition by card_id order by day) as gap_before
        from open_days
      ) s
      where day >= ${from}::date
      group by card_id
    ),
    -- "Visited after open" = a stamp_add strictly after a session started in
    -- range and at most 14 days later (the visit may fall after the range).
    session_stats as (
      select cv.card_id,
        count(*)::int as sessions,
        bool_or(exists (
          select 1 from loyalty.transactions t
          where t.card_id = cv.card_id and t.type = 'stamp_add'
            and t."timestamp" > extract(epoch from cv.started_at) * 1000
            and t."timestamp" <= extract(epoch from cv.started_at + make_interval(days => ${OPEN_TO_VISIT_DAYS})) * 1000
        )) as visited_after_open
      from loyalty.card_views cv, b
      where cv.owner_id = ${ownerId} and cv.started_at >= b.start_at and cv.started_at < b.end_at
      group by cv.card_id
    )
    select c.id, c.unique_id::text as unique_id, c.status,
      (vs.card_id is not null) as visited,
      coalesce(vs.came_back, false) as came_back,
      coalesce(vs.gaps, '{}'::int[]) as gaps,
      coalesce(ss.sessions, 0) as sessions,
      (os.card_id is not null) as opened,
      coalesce(os.reopened, false) as reopened,
      coalesce(ss.visited_after_open, false) as visited_after_open
    from loyalty.issued_cards c
    left join visit_stats vs on vs.card_id = c.id
    left join open_stats os on os.card_id = c.id
    left join session_stats ss on ss.card_id = c.id
    where c.owner_id = ${ownerId}
  `.execute(db);
  return rows;
};

const fetchSessionAgg = async (ownerId: string, from: string, to: string): Promise<SessionAgg> => {
  const { rows } = await sql<SessionAgg>`
    with b as (
      select (${from}::date)::timestamp at time zone ${TZ} as start_at,
             (${to}::date + 1)::timestamp at time zone ${TZ} as end_at
    )
    select
      count(*)::int as sessions,
      -- Sessions whose final ping never arrived stay at 0 ms; leave them out.
      percentile_cont(0.5) within group (order by cv.duration_ms)
        filter (where cv.duration_ms > 0) as median_ms,
      count(*) filter (where cv.source = 'link')::int as link,
      count(*) filter (where cv.source = 'pwa')::int as pwa,
      count(*) filter (where cv.source = 'wallet')::int as wallet,
      count(*) filter (where cv.source = 'whatsapp')::int as whatsapp
    from loyalty.card_views cv, b
    where cv.owner_id = ${ownerId} and cv.started_at >= b.start_at and cv.started_at < b.end_at
  `.execute(db);
  return rows[0]!;
};

type WalletProviderStats = { current: number; added: number; removed: number };

// Passes in Wallet (wallet_pass_events, 0017). "current" for Google = cards
// whose latest Google event is a save (events start when the save/delete
// callback went live); for Apple = passes with a registered device right now.
// added/removed = save/delete events in range (Apple: per device).
const fetchWalletStats = async (
  ownerId: string,
  from: string,
  to: string,
): Promise<Record<'google' | 'apple', WalletProviderStats>> => {
  const { rows } = await sql<{ provider: 'google' | 'apple'; current: number; added: number; removed: number }>`
    with b as (
      select (${from}::date)::timestamp at time zone ${TZ} as start_at,
             (${to}::date + 1)::timestamp at time zone ${TZ} as end_at
    ),
    owner_events as (
      select e.* from loyalty.wallet_pass_events e
      join loyalty.issued_cards c on c.id = e.card_id
      where c.owner_id = ${ownerId}
    ),
    latest as (
      select distinct on (card_id, provider) card_id, provider, event
      from owner_events
      order by card_id, provider, at desc, id desc
    ),
    providers(provider) as (values ('google'), ('apple'))
    select p.provider,
      case when p.provider = 'apple' then (
        select count(distinct d.serial)::int from loyalty.wallet_devices d
        join loyalty.issued_cards c on c.unique_id = d.serial
        where c.owner_id = ${ownerId}
      ) else (
        select count(*)::int from latest l where l.provider = p.provider and l.event = 'save'
      ) end as current,
      (select count(*)::int from owner_events e, b
        where e.provider = p.provider and e.event = 'save' and e.at >= b.start_at and e.at < b.end_at) as added,
      (select count(*)::int from owner_events e, b
        where e.provider = p.provider and e.event = 'delete' and e.at >= b.start_at and e.at < b.end_at) as removed
    from providers p
  `.execute(db);
  const pick = (provider: 'google' | 'apple'): WalletProviderStats => {
    const r = rows.find((row) => row.provider === provider);
    return { current: Number(r?.current ?? 0), added: Number(r?.added ?? 0), removed: Number(r?.removed ?? 0) };
  };
  return { google: pick('google'), apple: pick('apple') };
};

const visitKpis = (rows: CardRow[]) => {
  const visited = rows.filter((r) => r.visited);
  return {
    cardsWithVisit: visited.length,
    comebackRate: ratio(visited.filter((r) => r.came_back).length, visited.length),
    medianDaysBetweenVisits: median(rows.flatMap((r) => r.gaps.map(Number))),
  };
};

const periodKpis = (rows: CardRow[], agg: SessionAgg, days: number) => {
  const activeCards = rows.filter((r) => r.status === 'Active').length;
  const { comebackRate, medianDaysBetweenVisits } = visitKpis(rows);
  return {
    comebackRate,
    medianDaysBetweenVisits,
    // Sessions per active card per week (active = status Active right now).
    opensPerCardPerWeek: activeCards > 0 ? agg.sessions / activeCards / (days / 7) : null,
    medianSessionSeconds: agg.median_ms === null ? null : Number(agg.median_ms) / 1000,
  };
};

export const analyticsEngagementRoutes: FastifyPluginAsync = async (app) => {
  app.get('/analytics/engagement', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const { from, to } = parseBody(EngagementQuery, req.query);
    const ownerId = claims.ownerScopeId;

    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    const prevFrom = shiftDate(from, -days);
    const prevTo = shiftDate(from, -1);

    const [rows, agg, prevRows, prevAgg, walletPasses] = await Promise.all([
      fetchCardRows(ownerId, from, to),
      fetchSessionAgg(ownerId, from, to),
      fetchCardRows(ownerId, prevFrom, prevTo),
      fetchSessionAgg(ownerId, prevFrom, prevTo),
      fetchWalletStats(ownerId, from, to),
    ]);

    // Experiment arms. `cards` = every card issued by the owner in that arm
    // (the experiment applies to all of them); the comparison only means
    // something once each arm has enough cards with a visit.
    const arm = (holdout: boolean) => {
      const armRows = rows.filter((r) => (cardBucket(r.unique_id) === FX_HOLDOUT_BUCKET) === holdout);
      const { cardsWithVisit, comebackRate, medianDaysBetweenVisits } = visitKpis(armRows);
      return { cards: armRows.length, cardsWithVisit, comebackRate, medianDaysBetweenVisits };
    };
    const fx = arm(false);
    const holdout = arm(true);

    return {
      ok: true,
      data: {
        range: { from, to },
        funnel: {
          activeCards: rows.filter((r) => r.status === 'Active').length,
          openedCards: rows.filter((r) => r.opened).length,
          reopenedCards: rows.filter((r) => r.reopened).length,
          visitedAfterOpenCards: rows.filter((r) => r.visited_after_open).length,
        },
        kpis: periodKpis(rows, agg, days),
        previous: periodKpis(prevRows, prevAgg, days),
        experiment: {
          fx,
          holdout,
          enoughData: fx.cardsWithVisit >= MIN_CARDS_PER_ARM && holdout.cardsWithVisit >= MIN_CARDS_PER_ARM,
        },
        sources: { link: agg.link, pwa: agg.pwa, wallet: agg.wallet, whatsapp: agg.whatsapp },
        walletPasses,
      },
    };
  });
};
