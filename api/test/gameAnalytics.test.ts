// GET /analytics/game — plays/wins/cost, monthly cap usage and the
// "visit within 14 days" comparison (docs/CARD_ENGAGEMENT_PLAN.md §8.8, §8.10).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, Session, type TestRig } from './helpers/app.js';
import { cardBucket, GAME_HOLDOUT_BUCKET } from '../src/lib/holdout.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let campaignId: string;
let customerId: string;

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
}, 120_000);

afterAll(async () => {
  await rig?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.reset();
  owner = await insertOwner(db.pool, {
    email: 'owner@example.com',
    password: 'hunter2bravo',
    businessName: 'Golden Beauty',
    slug: 'golden-beauty',
  });
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas', totalStamps: 10 });
  await db.pool.query(
    'update loyalty.campaigns set game_enabled = true, game_monthly_cap = 30 where id = $1',
    [campaignId],
  );
  customerId = await insertCustomer(db.pool, owner.userId, { name: 'Laura' });
});

afterEach(() => {
  delete process.env.GAME_HOLDOUT;
});

/** Epoch millis for a Bogota wall-clock time (UTC-5, no DST). */
const bogota = (date: string, time = '12:00') => Date.parse(`${date}T${time}:00-05:00`);

const uniqueIdFor = (holdout: boolean) => {
  for (;;) {
    const id = randomUUID();
    if ((cardBucket(id) === GAME_HOLDOUT_BUCKET) === holdout) return id;
  }
};

const makeCard = async (opts: { holdout?: boolean; ownerId?: string; campaign?: string; customer?: string } = {}) => {
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into loyalty.issued_cards (unique_id, customer_id, campaign_id, owner_id, campaign_name, stamps)
     values ($1, $2, $3, $4, 'Uñas', 3) returning id`,
    [uniqueIdFor(opts.holdout ?? false), opts.customer ?? customerId, opts.campaign ?? campaignId, opts.ownerId ?? owner.userId],
  );
  return rows[0]!.id;
};

const visit = (cardId: string, ts: number) =>
  db.pool.query(
    `insert into loyalty.transactions (card_id, type, amount, date, "timestamp", title)
     values ($1, 'stamp_add', 1, 'x', $2, 'x')`,
    [cardId, ts],
  );

const playAt = (cardId: string, periodKey: string, ts: number, won: boolean, ownerId = owner.userId) =>
  db.pool.query(
    `insert into loyalty.card_plays (card_id, owner_id, period_key, played_at, won, stamps_awarded)
     values ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6)`,
    [cardId, ownerId, periodKey, ts, won, won ? 1 : 0],
  );

const login = async (email: string) => {
  const s = new Session();
  s.captureFromResponse(
    await rig.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'hunter2bravo' },
      headers: { 'content-type': 'application/json' },
    }),
  );
  return s;
};

const getReport = async (session: Session | null, query = 'from=2026-02-09&to=2026-02-22') =>
  rig.app.inject({
    method: 'GET',
    url: `/analytics/game?${query}`,
    headers: session ? { cookie: session.cookieJarHeader() ?? '' } : {},
  });

describe('GET /analytics/game', () => {
  // Range = ISO weeks 2026-W07 (Mon 9 Feb) and 2026-W08 (Mon 16 Feb).
  const seed = async () => {
    // A: visited, played W07 (won), came back 5 days later; idle in W08.
    const a = await makeCard();
    await visit(a, bogota('2026-02-05'));
    await playAt(a, '2026-W07', bogota('2026-02-10'), true);
    await visit(a, bogota('2026-02-15'));
    // A also plays outside the range (excluded everywhere).
    await playAt(a, '2026-W10', bogota('2026-03-03'), true);

    // B: eligible both weeks, never plays; visits on 12 Feb.
    const b = await makeCard();
    await visit(b, bogota('2026-02-01'));
    await visit(b, bogota('2026-02-12'));

    // C: holdout bucket, eligible both weeks, no visit after.
    const c = await makeCard({ holdout: true });
    await visit(c, bogota('2026-02-03'));

    // D: never visited, never played: not counted.
    await makeCard();

    // E: stale card (not eligible in W07), plays W08 and loses, no visit after.
    const e = await makeCard();
    await visit(e, bogota('2025-10-01'));
    await playAt(e, '2026-W08', bogota('2026-02-17'), false);

    // Another business's plays never leak in.
    const other = await insertOwner(db.pool, {
      email: 'other@example.com',
      password: 'hunter2bravo',
      businessName: 'Other',
      slug: 'other-biz',
    });
    const otherCampaign = await insertCampaign(db.pool, other.userId, { name: 'X' });
    const otherCustomer = await insertCustomer(db.pool, other.userId, { name: 'Y' });
    const x = await makeCard({ ownerId: other.userId, campaign: otherCampaign, customer: otherCustomer });
    await visit(x, bogota('2026-02-05'));
    await playAt(x, '2026-W07', bogota('2026-02-10'), true, other.userId);
  };

  it('reports plays, wins, cost, cap usage and the 14-day visit comparison', async () => {
    await seed();
    const res = await getReport(await login('owner@example.com'));
    expect(res.statusCode).toBe(200);
    const data = res.json().data;

    expect(data.range).toEqual({ from: '2026-02-09', to: '2026-02-22' });
    expect(data.enabled).toBe(true);
    expect(data.cap).toBe(30);
    expect(data.totals).toEqual({ plays: 2, wins: 1, stampsAwarded: 1, players: 2, winRate: 0.5 });
    expect(data.months).toEqual([{ month: '2026-02', plays: 2, wins: 1, stampsAwarded: 1, cap: 30 }]);

    expect(data.comparison.windowDays).toBe(14);
    // Players: A (W07, visited) + E (W08, not).
    expect(data.comparison.players).toEqual({ cardWeeks: 2, visited: 1, rate: 0.5 });
    // Eligible non-players: A in W08 (no visit after 16 Feb) + B in W07 (visit 12 Feb) and W08 (none).
    expect(data.comparison.nonPlayers).toMatchObject({ cardWeeks: 3, visited: 1 });
    expect(data.comparison.nonPlayers.rate).toBeCloseTo(1 / 3);
    expect(data.comparison.holdout).toEqual({ cardWeeks: 2, visited: 0, rate: 0 });
    expect(data.comparison.enoughData).toBe(false);
  });

  it('weeks before the first ever play are left out of the comparison', async () => {
    await seed();
    // W05–W06 precede the first play (10 Feb): nothing to compare.
    const res = await getReport(await login('owner@example.com'), 'from=2026-01-26&to=2026-02-08');
    const data = res.json().data;
    expect(data.totals.plays).toBe(0);
    expect(data.totals.winRate).toBeNull();
    expect(data.months).toEqual([]);
    expect(data.comparison.players.cardWeeks).toBe(0);
    expect(data.comparison.nonPlayers.cardWeeks).toBe(0);
    expect(data.comparison.players.rate).toBeNull();
  });

  it('a game that is off reports enabled=false and no cap', async () => {
    await db.pool.query('update loyalty.campaigns set game_enabled = false where id = $1', [campaignId]);
    const data = (await getReport(await login('owner@example.com'))).json().data;
    expect(data.enabled).toBe(false);
    expect(data.cap).toBeNull();
    expect(data.totals.plays).toBe(0);
  });

  it('auth: anonymous → 401; invalid range → 400', async () => {
    expect((await getReport(null)).statusCode).toBe(401);
    const session = await login('owner@example.com');
    expect((await getReport(session, 'from=2026-02-30&to=2026-03-01')).statusCode).toBe(400);
    expect((await getReport(session, 'from=2026-03-01&to=2026-02-01')).statusCode).toBe(400);
  });
});
