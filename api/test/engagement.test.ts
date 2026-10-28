// GET /analytics/engagement — funnel, KPIs, fx-vs-holdout experiment, scoping.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCustomer, insertOwner, Session, type TestRig } from './helpers/app.js';
import { cardBucket, FX_HOLDOUT_BUCKET } from '../src/lib/holdout.js';

let db: TestDb;
let rig: TestRig;

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
});

// ---- fixtures -------------------------------------------------------------

/** Epoch millis for a Bogota wall-clock time (UTC-5, no DST). */
const bogota = (date: string, time = '12:00') => Date.parse(`${date}T${time}:00-05:00`);

const uuidInArm = (holdout: boolean): string => {
  for (;;) {
    const id = randomUUID();
    if ((cardBucket(id) === FX_HOLDOUT_BUCKET) === holdout) return id;
  }
};

const insertCard = async (
  ownerId: string,
  customerId: string,
  opts: { holdout?: boolean; status?: 'Active' | 'Redeemed' } = {},
) => {
  const id = `card-${randomUUID()}`;
  await db.pool.query(
    `insert into loyalty.issued_cards (id, unique_id, customer_id, owner_id, campaign_name, status)
     values ($1, $2, $3, $4, 'Nails', $5)`,
    [id, uuidInArm(opts.holdout ?? false), customerId, ownerId, opts.status ?? 'Active'],
  );
  return id;
};

const insertTx = async (cardId: string, type: string, ts: number) => {
  await db.pool.query(
    `insert into loyalty.transactions (card_id, type, amount, date, "timestamp", title)
     values ($1, $2, 1, 'x', $3, 'x')`,
    [cardId, type, ts],
  );
};

const insertView = async (
  cardId: string,
  ownerId: string,
  startedAt: number,
  opts: { source?: string; durationMs?: number; variant?: string } = {},
) => {
  await db.pool.query(
    `insert into loyalty.card_views (card_id, owner_id, session_id, source, started_at, duration_ms, variant)
     values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7)`,
    [cardId, ownerId, randomUUID(), opts.source ?? 'link', startedAt, opts.durationMs ?? 0, opts.variant ?? 'fx'],
  );
};

const login = async (email: string, password = 'hunter2bravo') => {
  const session = new Session();
  const res = await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
    headers: { 'content-type': 'application/json' },
  });
  session.captureFromResponse(res);
  return session;
};

const getEngagement = (session: Session | null, query = 'from=2026-09-01&to=2026-09-30') =>
  rig.app.inject({
    method: 'GET',
    url: `/analytics/engagement?${query}`,
    headers: session ? { cookie: session.cookieJarHeader() ?? '' } : {},
  });

// Range under test: 2026-09-01..2026-09-30 (30 days); previous: 08-02..08-31.
const seedOwnerA = async () => {
  const owner = await insertOwner(db.pool, {
    email: 'owner@example.com',
    password: 'hunter2bravo',
    businessName: 'Salon A',
    slug: 'salon-a',
  });
  const o = owner.userId;
  const cust = await insertCustomer(db.pool, o, { name: 'Alice' });

  // c1 (fx): visits Aug 20, Sep 5, Sep 20 → in-range gaps 16, 15; comes back.
  // Opens Sep 3 + Sep 10 → reopened; Sep 3 open → Sep 5 visit (visited after open).
  const c1 = await insertCard(o, cust);
  await insertTx(c1, 'stamp_add', bogota('2026-08-20'));
  await insertTx(c1, 'stamp_add', bogota('2026-09-05', '10:00'));
  await insertTx(c1, 'stamp_add', bogota('2026-09-05', '10:01')); // same sitting: one visit
  await insertTx(c1, 'stamp_add', bogota('2026-09-20'));
  await insertView(c1, o, bogota('2026-09-03', '09:00'), { durationMs: 10_000 });
  await insertView(c1, o, bogota('2026-09-10'), { source: 'whatsapp', durationMs: 20_000 });

  // c2 (fx): single visit Sep 25 (no comeback). Two opens on the same day
  // (reload, not a reopen); the 0 ms one is excluded from the median.
  // Sep 2 open → Sep 25 visit is > 14 days, so not "visited after open".
  const c2 = await insertCard(o, cust);
  await insertTx(c2, 'stamp_add', bogota('2026-09-25'));
  await insertView(c2, o, bogota('2026-09-02', '08:00'), { durationMs: 4_000 });
  await insertView(c2, o, bogota('2026-09-02', '18:00'), { durationMs: 0 });

  // c3 (holdout): visit Sep 1, next visit Oct 10 (39 days later → comeback).
  // Opens Jul 25 (out of both ranges) + Sep 15 (52 days later → not a reopen).
  const c3 = await insertCard(o, cust, { holdout: true });
  await insertTx(c3, 'stamp_add', bogota('2026-09-01'));
  await insertTx(c3, 'stamp_add', bogota('2026-10-10'));
  await insertView(c3, o, bogota('2026-07-25'), { variant: 'holdout' });
  await insertView(c3, o, bogota('2026-09-15'), { source: 'pwa', durationMs: 6_000, variant: 'holdout' });

  // c4 (holdout, redeemed): one visit Sep 10; gift/issued are not visits.
  const c4 = await insertCard(o, cust, { holdout: true, status: 'Redeemed' });
  await insertTx(c4, 'issued', bogota('2026-09-08'));
  await insertTx(c4, 'stamp_add', bogota('2026-09-10'));
  await insertTx(c4, 'gift', bogota('2026-09-12'));

  // c5 (fx): Bogota day boundaries. Visit at 2026-09-01 02:00 UTC is still
  // Aug 31 in Bogota (previous period); open at 2026-10-01 03:00 UTC is
  // Sep 30 in Bogota (current period).
  const c5 = await insertCard(o, cust);
  await insertTx(c5, 'stamp_add', Date.parse('2026-09-01T02:00:00Z'));
  await insertView(c5, o, Date.parse('2026-10-01T03:00:00Z'), { source: 'wallet', durationMs: 8_000 });

  return owner;
};

// ---- tests ----------------------------------------------------------------

describe('engagement: GET /analytics/engagement', () => {
  it('computes funnel, KPIs, previous period, experiment arms and source mix', async () => {
    await seedOwnerA();

    // Another owner's data in the same range must not leak in.
    const other = await insertOwner(db.pool, {
      email: 'other@example.com',
      password: 'hunter2bravo',
      businessName: 'Salon B',
      slug: 'salon-b',
    });
    const otherCust = await insertCustomer(db.pool, other.userId, { name: 'Bob' });
    const otherCard = await insertCard(other.userId, otherCust);
    await insertTx(otherCard, 'stamp_add', bogota('2026-09-04'));
    await insertTx(otherCard, 'stamp_add', bogota('2026-09-06'));
    await insertView(otherCard, other.userId, bogota('2026-09-03'), { durationMs: 999_000 });
    await insertView(otherCard, other.userId, bogota('2026-09-05'), { source: 'wallet' });

    const res = await getEngagement(await login('owner@example.com'));
    expect(res.statusCode).toBe(200);
    const data = res.json().data;

    expect(data.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(data.funnel).toEqual({
      activeCards: 4, // c4 is redeemed
      openedCards: 4, // c1, c2, c3, c5
      reopenedCards: 1, // c1
      visitedAfterOpenCards: 1, // c1
    });
    expect(data.kpis.comebackRate).toBe(0.5); // c1 + c3 of c1..c4
    expect(data.kpis.medianDaysBetweenVisits).toBe(15.5); // gaps 16, 15
    expect(data.kpis.opensPerCardPerWeek).toBeCloseTo(6 / 4 / (30 / 7), 6);
    expect(data.kpis.medianSessionSeconds).toBe(8); // 4, 6, 8, 10, 20 s
    expect(data.sources).toEqual({ link: 3, pwa: 1, wallet: 1, whatsapp: 1 });

    // Previous period: c1 (Aug 20 → back Sep 5) and c5 (Aug 31, never back).
    expect(data.previous).toEqual({
      comebackRate: 0.5,
      medianDaysBetweenVisits: null,
      opensPerCardPerWeek: 0,
      medianSessionSeconds: null,
    });

    expect(data.experiment).toEqual({
      fx: { cards: 3, cardsWithVisit: 2, comebackRate: 0.5, medianDaysBetweenVisits: 15.5 },
      holdout: { cards: 2, cardsWithVisit: 2, comebackRate: 0.5, medianDaysBetweenVisits: null },
      enoughData: false,
    });
  });

  it('returns null rates (not NaN) for an owner with no data', async () => {
    await insertOwner(db.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Empty',
      slug: 'empty',
    });
    const res = await getEngagement(await login('owner@example.com'));
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.funnel).toEqual({ activeCards: 0, openedCards: 0, reopenedCards: 0, visitedAfterOpenCards: 0 });
    expect(data.kpis).toEqual({
      comebackRate: null,
      medianDaysBetweenVisits: null,
      opensPerCardPerWeek: null,
      medianSessionSeconds: null,
    });
    expect(data.sources).toEqual({ link: 0, pwa: 0, wallet: 0, whatsapp: 0 });
    expect(data.experiment.enoughData).toBe(false);
  });

  it('enoughData once both arms have 50 cards with a visit', async () => {
    const owner = await insertOwner(db.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Busy',
      slug: 'busy',
    });
    const cust = await insertCustomer(db.pool, owner.userId, { name: 'Many' });
    const ids: string[] = [];
    const uniqueIds: string[] = [];
    for (const holdout of [true, false]) {
      for (let i = 0; i < 50; i++) {
        ids.push(`card-${randomUUID()}`);
        uniqueIds.push(uuidInArm(holdout));
      }
    }
    await db.pool.query(
      `insert into loyalty.issued_cards (id, unique_id, customer_id, owner_id, campaign_name)
       select id, uid::uuid, $3, $4, 'Nails' from unnest($1::text[], $2::text[]) as t(id, uid)`,
      [ids, uniqueIds, cust, owner.userId],
    );
    await db.pool.query(
      `insert into loyalty.transactions (card_id, type, amount, date, "timestamp", title)
       select id, 'stamp_add', 1, 'x', $2, 'x' from unnest($1::text[]) as id`,
      [ids, bogota('2026-09-10')],
    );

    const session = await login('owner@example.com');
    const data = (await getEngagement(session)).json().data;
    expect(data.experiment.fx.cardsWithVisit).toBe(50);
    expect(data.experiment.holdout.cardsWithVisit).toBe(50);
    expect(data.experiment.enoughData).toBe(true);

    // Drop one holdout visit → not enough again.
    await db.pool.query(`delete from loyalty.transactions where card_id = $1`, [ids[0]]);
    const after = (await getEngagement(session)).json().data;
    expect(after.experiment.holdout.cardsWithVisit).toBe(49);
    expect(after.experiment.enoughData).toBe(false);
  });

  it('auth: anonymous → 401, staff → 403', async () => {
    const owner = await insertOwner(db.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Salon A',
      slug: 'salon-a',
    });
    expect((await getEngagement(null)).statusCode).toBe(401);

    const ownerSession = await login('owner@example.com');
    await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'Sam', email: 'sam@example.com', pin: '1234' },
      headers: { 'content-type': 'application/json', cookie: ownerSession.cookieJarHeader() ?? '' },
    });
    const staffSession = new Session();
    staffSession.captureFromResponse(
      await rig.app.inject({
        method: 'POST',
        url: '/auth/staff-login',
        payload: { email: 'sam@example.com', pin: '1234', orgId: owner.slug },
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(staffSession.get('access')).toBeTruthy();
    expect((await getEngagement(staffSession)).statusCode).toBe(403);
  });

  it.each([
    ['missing to', 'from=2026-09-01'],
    ['bad format', 'from=2026-9-1&to=2026-09-30'],
    ['impossible date', 'from=2026-02-30&to=2026-03-10'],
    ['from after to', 'from=2026-09-30&to=2026-09-01'],
    ['range too long', 'from=2020-01-01&to=2026-09-30'],
  ])('invalid query (%s) → 400', async (_label, query) => {
    await insertOwner(db.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Salon A',
      slug: 'salon-a',
    });
    const res = await getEngagement(await login('owner@example.com'), query);
    expect(res.statusCode).toBe(400);
  });
});
