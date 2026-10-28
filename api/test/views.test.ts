// Engagement beacon: POST /public/cards/:slug/:uniqueId/views.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCustomer, insertOwner, type TestRig } from './helpers/app.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let card: { id: string; uniqueId: string };

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
    businessName: 'Test Salon',
    slug: 'test-salon',
  });
  const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Alice' });
  card = { id: `card-${randomUUID()}`, uniqueId: randomUUID() };
  await db.pool.query(
    `insert into loyalty.issued_cards (id, unique_id, customer_id, owner_id, campaign_name)
     values ($1, $2, $3, $4, 'Nails')`,
    [card.id, card.uniqueId, customerId, owner.userId],
  );
});

const event = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'session-abc-123',
  source: 'link',
  variant: 'fx',
  durationMs: 0,
  interactions: 0,
  sawNewStamps: false,
  ...overrides,
});

const post = (payload: unknown, opts: { contentType?: string; slug?: string; uniqueId?: string; ip?: string } = {}) =>
  rig.app.inject({
    method: 'POST',
    url: `/public/cards/${opts.slug ?? owner.slug}/${opts.uniqueId ?? card.uniqueId}/views`,
    headers: { 'content-type': opts.contentType ?? 'application/json' },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    remoteAddress: opts.ip,
  });

const viewRows = async () =>
  (
    await db.pool.query(
      `select card_id, owner_id, session_id, source, variant, duration_ms, interactions, saw_new_stamps
       from loyalty.card_views order by session_id`,
    )
  ).rows;

describe('views: POST /public/cards/:slug/:uniqueId/views', () => {
  it('records a session (204, no body) with card + owner', async () => {
    const res = await post(event({ durationMs: 1200, interactions: 2 }));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const rows = await viewRows();
    expect(rows).toEqual([
      {
        card_id: card.id,
        owner_id: owner.userId,
        session_id: 'session-abc-123',
        source: 'link',
        variant: 'fx',
        duration_ms: 1200,
        interactions: 2,
        saw_new_stamps: false,
      },
    ]);
  });

  it('upserts per session: max of counters, OR of sawNewStamps, first source/variant kept', async () => {
    await post(event({ durationMs: 5000, interactions: 7, sawNewStamps: true }));
    // A late, out-of-order ping with smaller counters and a different source.
    await post(event({ durationMs: 3000, interactions: 9, sawNewStamps: false, source: 'pwa', variant: 'holdout' }));
    await post(event({ sessionId: 'session-other-1' }));
    const rows = await viewRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      session_id: 'session-abc-123',
      source: 'link',
      variant: 'fx',
      duration_ms: 5000,
      interactions: 9,
      saw_new_stamps: true,
    });
    expect(rows[1]).toMatchObject({ session_id: 'session-other-1', duration_ms: 0 });
  });

  it('caps new sessions per card per day but still updates existing ones', async () => {
    for (let i = 0; i < 31; i++) {
      expect((await post(event({ sessionId: `flood-session-${i}` }), { ip: `10.7.${i}.1` })).statusCode).toBe(204);
    }
    expect(await viewRows()).toHaveLength(30);
    await post(event({ sessionId: 'flood-session-0', durationMs: 5000 }), { ip: '10.7.99.1' });
    const { rows } = await db.pool.query(`select duration_ms from loyalty.card_views where session_id = 'flood-session-0'`);
    expect(rows[0]?.duration_ms).toBe(5000);
  });

  it('accepts sendBeacon-style text/plain JSON bodies', async () => {
    const res = await post(JSON.stringify(event({ source: 'whatsapp', variant: 'holdout', durationMs: 42 })), {
      contentType: 'text/plain;charset=UTF-8',
    });
    expect(res.statusCode).toBe(204);
    const rows = await viewRows();
    expect(rows[0]).toMatchObject({ source: 'whatsapp', variant: 'holdout', duration_ms: 42 });
  });

  it('text/plain that is not JSON → 400', async () => {
    const res = await post('not json at all', { contentType: 'text/plain' });
    expect(res.statusCode).toBe(400);
    expect(await viewRows()).toHaveLength(0);
  });

  it.each([
    ['short sessionId', { sessionId: 'abc' }],
    ['unknown source', { source: 'email' }],
    ['unknown variant', { variant: 'b' }],
    ['negative duration', { durationMs: -1 }],
    ['duration over 1h', { durationMs: 3_600_001 }],
    ['too many interactions', { interactions: 10_001 }],
    ['non-boolean sawNewStamps', { sawNewStamps: 'yes' }],
  ])('invalid body (%s) → 400', async (_label, overrides) => {
    const res = await post(event(overrides));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('unknown card → 404', async () => {
    const res = await post(event(), { uniqueId: randomUUID() });
    expect(res.statusCode).toBe(404);
  });

  it('non-uuid card id → 404 (not a DB error)', async () => {
    const res = await post(event(), { uniqueId: 'not-a-uuid' });
    expect(res.statusCode).toBe(404);
  });

  it('wrong slug → 404, and another owner cannot claim the card', async () => {
    await insertOwner(db.pool, {
      email: 'other@example.com',
      password: 'hunter2bravo',
      businessName: 'Other',
      slug: 'other-salon',
    });
    expect((await post(event(), { slug: 'no-such-salon' })).statusCode).toBe(404);
    expect((await post(event(), { slug: 'other-salon' })).statusCode).toBe(404);
    expect(await viewRows()).toHaveLength(0);
  });

  it('rate limits at 30/min per IP', async () => {
    const ip = '10.20.30.40';
    for (let i = 0; i < 30; i++) {
      const res = await post(event({ sessionId: `rate-limit-${i}` }), { ip });
      expect(res.statusCode).toBe(204);
    }
    const res = await post(event({ sessionId: 'rate-limit-31' }), { ip });
    expect(res.statusCode).toBe(429);
  });
});
