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
let session: Session;
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
    businessName: 'Test Cafe',
    slug: 'test-cafe',
  });
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Coffee', totalStamps: 10 });
  customerId = await insertCustomer(db.pool, owner.userId, { name: 'Alice', email: 'alice@x.com' });

  session = new Session();
  const login = await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'owner@example.com', password: 'hunter2bravo' },
    headers: { 'content-type': 'application/json' },
  });
  session.captureFromResponse(login);
});

const withSession = (s: Session) => ({ cookie: s.cookieJarHeader() ?? '' });

describe('cards: issue + stamp + redeem lifecycle', () => {
  it('POST /cards issues a card with stamps=0 and status=Active', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(res.statusCode).toBe(200);
    const card = res.json().data;
    expect(card.stamps).toBe(0);
    expect(card.status).toBe('Active');
    expect(card.uniqueId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('POST /cards/:id/transactions overrides actor_* from JWT', async () => {
    const issueRes = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    const cardId = issueRes.json().data.id as string;

    // Client tries to spoof actor_id/actor_role — they should be ignored.
    const txRes = await rig.app.inject({
      method: 'POST',
      url: `/cards/${cardId}/transactions`,
      payload: {
        type: 'stamp_add',
        amount: 1,
        date: 'Jan 1, 2026 12:00 PM',
        timestamp: Date.now(),
        title: 'Stamp #1',
        actorId: 'malicious-spoofed-id',
        actorRole: 'admin',
      },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(txRes.statusCode).toBe(200);

    const { rows } = await db.pool.query<{ actor_id: string; actor_role: string }>(
      `select actor_id, actor_role from loyalty.transactions where card_id = $1`,
      [cardId],
    );
    expect(rows[0]?.actor_id).toBe(owner.userId); // not 'malicious-spoofed-id'
    expect(rows[0]?.actor_role).toBe('owner'); // not 'admin'
  });

  it('PATCH /cards/:id can mark the card Redeemed', async () => {
    const issueRes = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    const cardId = issueRes.json().data.id as string;

    const res = await rig.app.inject({
      method: 'PATCH',
      url: `/cards/${cardId}`,
      payload: { stamps: 10, status: 'Redeemed', completedDate: '2026-01-15' },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(res.statusCode).toBe(200);
    const card = res.json().data;
    expect(card.stamps).toBe(10);
    expect(card.status).toBe('Redeemed');
    expect(card.completedDate).toBe('2026-01-15');
  });

  it('PATCH /cards/:id stampsDelta applies on top of concurrent changes', async () => {
    const issueRes = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    const cardId = issueRes.json().data.id as string;
    // Someone else (e.g. a scratch-game win) bumps the card to 3 meanwhile.
    await db.pool.query('update loyalty.issued_cards set stamps = 3 where id = $1', [cardId]);

    const patch = (payload: object) =>
      rig.app.inject({
        method: 'PATCH',
        url: `/cards/${cardId}`,
        payload,
        headers: { 'content-type': 'application/json', ...withSession(session) },
      });
    const res = await patch({ stampsDelta: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stamps).toBe(4);
    // Never below zero.
    expect((await patch({ stampsDelta: -10 })).json().data.stamps).toBe(0);
  });

  it('POST /cards on a disabled campaign → 409 CAMPAIGN_DISABLED', async () => {
    const disabledId = await insertCampaign(db.pool, owner.userId, {
      name: 'Old Promo',
      isEnabled: false,
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId: disabledId },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CAMPAIGN_DISABLED');
  });
});

describe('cards: gift (bonus) stamps', () => {
  const campaignPayload = (overrides: Record<string, unknown> = {}) => ({
    name: 'Facial',
    rewardName: '15% off',
    iconKey: 'Sparkles',
    colors: { background: '#ffffff' },
    totalStamps: 10,
    bonusStamps: 2,
    ...overrides,
  });

  it('PUT /campaigns/:id persists bonusStamps and returns it', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/campaigns/gift-campaign',
      payload: campaignPayload(),
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.bonusStamps).toBe(2);
    expect(res.json().data.totalStamps).toBe(10);
  });

  it('rejects bonusStamps >= totalStamps with 400', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/campaigns/gift-campaign',
      payload: campaignPayload({ totalStamps: 8, bonusStamps: 8 }),
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('bonusStamps');
  });

  it('campaigns without bonusStamps default to 0', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/campaigns/plain-campaign',
      payload: campaignPayload({ bonusStamps: undefined }),
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(res.json().data.bonusStamps).toBe(0);
  });

  it('POST /cards pre-fills stamps from the campaign, ignoring the client snapshot', async () => {
    const giftCampaignId = await insertCampaign(db.pool, owner.userId, {
      name: 'Facial',
      totalStamps: 10,
      bonusStamps: 2,
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: {
        customerId,
        campaignId: giftCampaignId,
        // A stale/tampered snapshot must not change the gift.
        templateSnapshot: { name: 'Facial', totalStamps: 10, bonusStamps: 7 },
      },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    expect(res.statusCode).toBe(200);
    const card = res.json().data;
    expect(card.stamps).toBe(2);
    expect(card.templateSnapshot.bonusStamps).toBe(2);
  });
});

describe('cards: win-back gift stamps', () => {
  const issue = async (campaign = campaignId) => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId: campaign },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    return res.json().data.id as string;
  };
  const setStamps = (id: string, stamps: number, status = 'Active') =>
    db.pool.query(`update loyalty.issued_cards set stamps = $2, status = $3 where id = $1`, [id, stamps, status]);
  const gift = (cardIds: string[], stamps: number, remarks?: string) =>
    rig.app.inject({
      method: 'POST',
      url: '/cards/gift-stamps',
      payload: { cardIds, stamps, remarks },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });

  it('adds stamps and records a gift transaction (not a visit)', async () => {
    const cardId = await issue();
    await setStamps(cardId, 4);
    const res = await gift([cardId], 2, 'Te extrañamos');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.giftedCount).toBe(1);
    expect(res.json().data.results[0]).toMatchObject({ cardId, added: 2, stamps: 6 });

    const { rows } = await db.pool.query<{ type: string; amount: number; remarks: string; actor_id: string }>(
      `select type, amount, remarks, actor_id from loyalty.transactions where card_id = $1`,
      [cardId],
    );
    expect(rows).toEqual([{ type: 'gift', amount: 2, remarks: 'Te extrañamos', actor_id: owner.userId }]);
  });

  it('never fills the card: always leaves one stamp to earn', async () => {
    const nearly = await issue();
    await setStamps(nearly, 8); // 10-stamp campaign
    const full = await issue();
    await setStamps(full, 9);
    const res = await gift([nearly, full], 5);
    const byId = Object.fromEntries(res.json().data.results.map((r: { cardId: string }) => [r.cardId, r]));
    expect(byId[nearly]).toMatchObject({ added: 1, stamps: 9 });
    expect(byId[full]).toMatchObject({ added: 0, reason: 'NEARLY_FULL' });
  });

  it('skips redeemed cards and cards from another business', async () => {
    const redeemed = await issue();
    await setStamps(redeemed, 3, 'Redeemed');
    const otherOwner = await insertOwner(db.pool, {
      email: 'other@example.com', password: 'hunter2bravo', businessName: 'Other', slug: 'other',
    });
    const otherCampaign = await insertCampaign(db.pool, otherOwner.userId, { name: 'X' });
    const otherCustomer = await insertCustomer(db.pool, otherOwner.userId, { name: 'Bob' });
    await db.pool.query(
      `insert into loyalty.issued_cards (id, customer_id, campaign_id, owner_id, campaign_name, stamps)
       values ('foreign-card', $1, $2, $3, 'X', 3)`,
      [otherCustomer, otherCampaign, otherOwner.userId],
    );

    const res = await gift([redeemed, 'foreign-card'], 2);
    expect(res.json().data.giftedCount).toBe(0);
    const reasons = res.json().data.results.map((r: { reason: string }) => r.reason).sort();
    expect(reasons).toEqual(['NOT_FOUND', 'REDEEMED']);
    const { rows } = await db.pool.query(`select stamps from loyalty.issued_cards where id = 'foreign-card'`);
    expect(rows[0].stamps).toBe(3);
  });

  it('validates the gift size', async () => {
    const cardId = await issue();
    expect((await gift([cardId], 0)).statusCode).toBe(400);
    expect((await gift([], 2)).statusCode).toBe(400);
  });
});

describe('cards: scan/inspect', () => {
  it('returns "owned" for a card in the caller\'s tenant', async () => {
    const issueRes = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    const uniqueId = issueRes.json().data.uniqueId as string;

    const res = await rig.app.inject({
      method: 'GET',
      url: `/scan/inspect/${uniqueId}`,
      headers: withSession(session),
    });
    expect(res.json().data.status).toBe('owned');
  });

  it('returns "missing" for an unknown uniqueId', async () => {
    const res = await rig.app.inject({
      method: 'GET',
      url: `/scan/inspect/00000000-0000-0000-0000-000000000099`,
      headers: withSession(session),
    });
    expect(res.json().data.status).toBe('missing');
  });

  it('returns "foreign" for a card owned by another tenant', async () => {
    // Issue a card in owner A's tenant.
    const issueRes = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { 'content-type': 'application/json', ...withSession(session) },
    });
    const uniqueId = issueRes.json().data.uniqueId as string;

    // Sign in as owner B and inspect — should see "foreign".
    await insertOwner(db.pool, {
      email: 'b@example.com',
      password: 'hunter2bravo',
      businessName: 'B',
      slug: 'b-shop',
    });
    const sB = new Session();
    const loginB = await rig.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'b@example.com', password: 'hunter2bravo' },
      headers: { 'content-type': 'application/json' },
    });
    sB.captureFromResponse(loginB);

    const res = await rig.app.inject({
      method: 'GET',
      url: `/scan/inspect/${uniqueId}`,
      headers: withSession(sB),
    });
    expect(res.json().data.status).toBe('foreign');
  });
});
