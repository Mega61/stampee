import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCustomer, insertOwner, Session, type TestRig } from './helpers/app.js';

// Per-campaign card animation style (docs/CARD_ENGAGEMENT_PLAN.md §5.0).

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let session: Session;

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
  session = new Session();
  const login = await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'owner@example.com', password: 'hunter2bravo' },
    headers: { 'content-type': 'application/json' },
  });
  session.captureFromResponse(login);
});

const headers = () => ({ 'content-type': 'application/json', cookie: session.cookieJarHeader() ?? '' });

const campaignPayload = (overrides: Record<string, unknown> = {}) => ({
  name: 'Facial',
  rewardName: '15% off',
  iconKey: 'Sparkles',
  colors: { background: '#ffffff' },
  totalStamps: 10,
  ...overrides,
});

const put = (id: string, payload: Record<string, unknown>) =>
  rig.app.inject({ method: 'PUT', url: `/campaigns/${id}`, payload, headers: headers() });

describe('campaigns: fxStyle', () => {
  it('defaults to elegant when omitted on create', async () => {
    const res = await rig.app.inject({ method: 'POST', url: '/campaigns', payload: campaignPayload(), headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.fxStyle).toBe('elegant');
  });

  it('persists fxStyle on create and update, and lists it', async () => {
    const created = await put('fx-campaign', campaignPayload({ fxStyle: 'playful' }));
    expect(created.statusCode).toBe(200);
    expect(created.json().data.fxStyle).toBe('playful');

    const updated = await put('fx-campaign', campaignPayload({ fxStyle: 'minimal' }));
    expect(updated.json().data.fxStyle).toBe('minimal');

    const list = await rig.app.inject({ method: 'GET', url: '/campaigns', headers: headers() });
    const row = (list.json().data as Array<{ id: string; fxStyle: string }>).find((c) => c.id === 'fx-campaign');
    expect(row?.fxStyle).toBe('minimal');
  });

  it('keeps the stored value when an update omits fxStyle', async () => {
    await put('fx-campaign', campaignPayload({ fxStyle: 'playful' }));
    const res = await put('fx-campaign', campaignPayload({ name: 'Renamed' }));
    expect(res.json().data.name).toBe('Renamed');
    expect(res.json().data.fxStyle).toBe('playful');
  });

  it('rejects an unknown fxStyle with 400', async () => {
    const res = await put('fx-campaign', campaignPayload({ fxStyle: 'rainbow' }));
    expect(res.statusCode).toBe(400);
  });

  it('the database rejects an unknown fx_style', async () => {
    await put('fx-campaign', campaignPayload());
    await expect(
      db.pool.query(`update loyalty.campaigns set fx_style = 'loud' where id = 'fx-campaign'`),
    ).rejects.toThrow(/campaigns_fx_style_check/);
  });

  it('the public card carries the live campaign fxStyle', async () => {
    await put('fx-campaign', campaignPayload({ fxStyle: 'playful' }));
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Alice', email: 'a@x.com' });
    const issue = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId: 'fx-campaign' },
      headers: headers(),
    });
    expect(issue.statusCode).toBe(200);
    const uniqueId = issue.json().data.uniqueId as string;
    // Changing the live campaign applies to cards already issued.
    await put('fx-campaign', campaignPayload({ fxStyle: 'minimal' }));
    const res = await rig.app.inject({ method: 'GET', url: `/public/cards/${owner.slug}/${uniqueId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.campaign.fxStyle).toBe('minimal');
  });
});
