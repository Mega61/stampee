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
});

describe('public: GET /public/cards', () => {
  it('returns the card + customer + campaign for the right slug', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, {
      name: 'Coffee',
      totalStamps: 10,
    });
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Alice', email: 'a@x.com' });
    const session = new Session();
    const login = await rig.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'owner@example.com', password: 'hunter2bravo' },
      headers: { 'content-type': 'application/json' },
    });
    session.captureFromResponse(login);
    const issue = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: {
        'content-type': 'application/json',
        cookie: session.cookieJarHeader() ?? '',
      },
    });
    const uniqueId = issue.json().data.uniqueId as string;

    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/${owner.slug}/${uniqueId}`,
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.card.uniqueId).toBe(uniqueId);
    expect(data.customer.name).toBe('Alice');
    expect(data.campaign.name).toBe('Coffee');
  });

  it('wrong slug → 404 (no existence leak)', async () => {
    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/no-such-business/00000000-0000-0000-0000-000000000099`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('wrong uniqueId → 404', async () => {
    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/${owner.slug}/00000000-0000-0000-0000-000000000099`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('public: GET /public/signup context', () => {
  it('returns context for an enabled campaign', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Coffee' });
    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/signup/${owner.slug}/${campaignId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.campaign.isEnabled).toBe(true);
  });

  it('returns context for a DISABLED campaign too (with isEnabled:false)', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, {
      name: 'Old Promo',
      isEnabled: false,
    });
    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/signup/${owner.slug}/${campaignId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.campaign.isEnabled).toBe(false);
  });
});

describe('public: POST /public/signup outcome matrix', () => {
  it('new customer + enabled campaign → outcome:issued', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Coffee' });
    const res = await rig.app.inject({
      method: 'POST',
      url: `/public/signup/${owner.slug}/${campaignId}`,
      payload: { name: 'New', email: 'new@example.com' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.outcome).toBe('issued');
  });

  it('same email second time → outcome:redirect_existing with the same uniqueId', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Coffee' });
    const first = await rig.app.inject({
      method: 'POST',
      url: `/public/signup/${owner.slug}/${campaignId}`,
      payload: { name: 'A', email: 'dup@example.com' },
      headers: { 'content-type': 'application/json' },
    });
    const second = await rig.app.inject({
      method: 'POST',
      url: `/public/signup/${owner.slug}/${campaignId}`,
      payload: { name: 'A Again', email: 'dup@example.com' },
      headers: { 'content-type': 'application/json' },
    });
    expect(first.json().data.outcome).toBe('issued');
    expect(second.json().data.outcome).toBe('redirect_existing');
    expect(second.json().data.uniqueId).toBe(first.json().data.uniqueId);
  });

  it('disabled campaign + new customer → outcome:campaign_disabled_no_existing', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, {
      name: 'Old Promo',
      isEnabled: false,
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: `/public/signup/${owner.slug}/${campaignId}`,
      payload: { name: 'Ghost', email: 'ghost@example.com' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.outcome).toBe('campaign_disabled_no_existing');
  });

  it('unknown business → 404', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: `/public/signup/no-such-business/whatever-id`,
      payload: { name: 'X' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(404);
  });
});
