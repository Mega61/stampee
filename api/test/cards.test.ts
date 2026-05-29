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
