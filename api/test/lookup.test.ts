import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import {
  buildTestRig,
  insertCampaign,
  insertCustomer,
  insertOwner,
  Session,
  type TestRig,
} from './helpers/app.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let key: string;
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

const auth = () => ({ authorization: `Bearer ${key}` });
const json = { 'content-type': 'application/json' };

beforeEach(async () => {
  await db.reset();
  owner = await insertOwner(db.pool, {
    email: 'owner@example.com',
    password: 'hunter2bravo',
    businessName: 'Golden',
    slug: 'golden',
  });
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Manicure Club', totalStamps: 10, bonusStamps: 2 });
  customerId = await insertCustomer(db.pool, owner.userId, { name: 'Laura Gómez', email: 'Laura@X.com', mobile: '300 123 4567' });

  const session = new Session();
  session.captureFromResponse(await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'owner@example.com', password: 'hunter2bravo' },
    headers: json,
  }));
  const minted = await rig.app.inject({
    method: 'POST',
    url: '/api-keys',
    payload: { name: 'Admin panel' },
    headers: { ...json, cookie: session.cookieJarHeader() ?? '' },
  });
  key = minted.json().data.key;

  // Issue (gift of 2 applies), one visit, one win-back gift.
  const card = await rig.app.inject({ method: 'POST', url: '/cards', payload: { customerId, campaignId }, headers: { ...json, ...auth() } });
  const cardId = card.json().data.id as string;
  await rig.app.inject({
    method: 'POST', url: `/cards/${cardId}/transactions`, headers: { ...json, ...auth() },
    payload: { type: 'stamp_add', amount: 1, date: 'x', timestamp: 1_700_000_000_000, title: 'Stamp' },
  });
  await db.pool.query(`update loyalty.issued_cards set stamps = 3 where id = $1`, [cardId]);
  await rig.app.inject({ method: 'POST', url: '/cards/gift-stamps', payload: { cardIds: [cardId], stamps: 2 }, headers: { ...json, ...auth() } });
});

describe('lookup: GET /customers/lookup', () => {
  it('finds by phone in any format and summarizes the card', async () => {
    for (const phone of ['3001234567', '+57 300 123 4567', '573001234567']) {
      const res = await rig.app.inject({ method: 'GET', url: `/customers/lookup?phone=${encodeURIComponent(phone)}`, headers: auth() });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    }
    const res = await rig.app.inject({ method: 'GET', url: '/customers/lookup?phone=3001234567', headers: auth() });
    const client = res.json().data[0];
    expect(client).toMatchObject({ id: customerId, name: 'Laura Gómez', totals: { activeCards: 1, readyToRedeem: 0, activeStamps: 5 } });
    expect(client.cards[0]).toMatchObject({
      campaignName: 'Manicure Club',
      campaignEnabled: true,
      status: 'Active',
      stamps: 5,
      totalStamps: 10,
      stampsRemaining: 5,
      readyToRedeem: false,
      giftedStamps: { welcome: 2, winBack: 2 },
      stampsFromVisits: 1,
    });
    expect(client.cards[0].publicUrl).toMatch(/\/golden\/[0-9a-f-]{36}$/);
    expect(client.cards[0].lastVisitAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('finds by email (case-insensitive), id and free text', async () => {
    const byEmail = await rig.app.inject({ method: 'GET', url: '/customers/lookup?email=laura@x.com', headers: auth() });
    expect(byEmail.json().data).toHaveLength(1);
    const byId = await rig.app.inject({ method: 'GET', url: `/customers/lookup?id=${customerId}`, headers: auth() });
    expect(byId.json().data).toHaveLength(1);
    const byText = await rig.app.inject({ method: 'GET', url: '/customers/lookup?q=gómez', headers: auth() });
    expect(byText.json().data).toHaveLength(1);
    const miss = await rig.app.inject({ method: 'GET', url: '/customers/lookup?phone=3109999999', headers: auth() });
    expect(miss.json().data).toEqual([]);
  });

  it('hides redeemed cards unless includeRedeemed=true', async () => {
    await db.pool.query(`update loyalty.issued_cards set status = 'Redeemed'`);
    const hidden = await rig.app.inject({ method: 'GET', url: '/customers/lookup?phone=3001234567', headers: auth() });
    expect(hidden.json().data[0].cards).toEqual([]);
    const shown = await rig.app.inject({ method: 'GET', url: '/customers/lookup?phone=3001234567&includeRedeemed=true', headers: auth() });
    expect(shown.json().data[0].cards[0].status).toBe('Redeemed');
  });

  it('requires a search parameter, and auth', async () => {
    expect((await rig.app.inject({ method: 'GET', url: '/customers/lookup', headers: auth() })).statusCode).toBe(400);
    expect((await rig.app.inject({ method: 'GET', url: '/customers/lookup?phone=12', headers: auth() })).statusCode).toBe(400);
    expect((await rig.app.inject({ method: 'GET', url: '/customers/lookup?phone=3001234567' })).statusCode).toBe(401);
  });

  it("never returns another business's clients", async () => {
    const other = await insertOwner(db.pool, { email: 'b@example.com', password: 'hunter2bravo', businessName: 'B', slug: 'b' });
    await insertCustomer(db.pool, other.userId, { name: 'Laura Other', mobile: '3001234567' });
    const res = await rig.app.inject({ method: 'GET', url: '/customers/lookup?phone=3001234567', headers: auth() });
    expect(res.json().data.map((c: { id: string }) => c.id)).toEqual([customerId]);
  });
});

describe('lookup: GET /customers/:id/loyalty', () => {
  it('returns one client summary, 404 for unknown', async () => {
    const res = await rig.app.inject({ method: 'GET', url: `/customers/${customerId}/loyalty`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.cards[0].stampsRemaining).toBe(5);
    const missing = await rig.app.inject({ method: 'GET', url: '/customers/nope/loyalty', headers: auth() });
    expect(missing.statusCode).toBe(404);
  });
});
