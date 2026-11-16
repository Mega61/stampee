// The customer's permanent public link (migration 0018, lib/publicCustomer.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, Session, type TestRig } from './helpers/app.js';

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

const json = { 'content-type': 'application/json' };

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
    headers: json,
  });
  session.captureFromResponse(login);
});

const authed = () => ({ ...json, cookie: session.cookieJarHeader() ?? '' });

const issue = async (customerId: string, campaignId: string) => {
  const res = await rig.app.inject({ method: 'POST', url: '/cards', payload: { customerId, campaignId }, headers: authed() });
  expect(res.statusCode).toBe(200);
  return res.json().data as { id: string; uniqueId: string; customerPublicId: string };
};

const publicCard = (id: string, slug = 'test-cafe') => rig.app.inject({ method: 'GET', url: `/public/cards/${slug}/${id}` });

// Backdate so "newest" is deterministic within one test.
const setCreatedAt = (cardId: string, iso: string) =>
  db.pool.query('update loyalty.issued_cards set created_at = $2 where id = $1', [cardId, iso]);

describe('permanent customer link', () => {
  it('every customer gets a publicId, and POST /cards returns it', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Sellos' });
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
    const card = await issue(customerId, campaignId);

    const list = await rig.app.inject({ method: 'GET', url: '/customers', headers: authed() });
    const ana = list.json().data.find((c: { id: string }) => c.id === customerId);
    expect(ana.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(card.customerPublicId).toBe(ana.publicId);
  });

  it('an old card link and the permanent link open the same page, with the canonical id', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Sellos' });
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
    const card = await issue(customerId, campaignId);

    const byCard = await publicCard(card.uniqueId);
    expect(byCard.statusCode).toBe(200);
    expect(byCard.json().data.canonicalId).toBe(card.customerPublicId);
    expect(byCard.json().data.card.uniqueId).toBe(card.uniqueId);

    const byLink = await publicCard(card.customerPublicId);
    expect(byLink.statusCode).toBe(200);
    expect(byLink.json().data.card.uniqueId).toBe(card.uniqueId);
    expect(byLink.json().data.customer.name).toBe('Ana');
  });

  it('a new card after a redemption keeps the same link and shows the new card', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Sellos' });
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
    const first = await issue(customerId, campaignId);
    await setCreatedAt(first.id, '2026-05-01T12:00:00Z');
    const redeem = await rig.app.inject({
      method: 'PATCH',
      url: `/cards/${first.id}`,
      payload: { stamps: 10, status: 'Redeemed', completedDate: '2026-10-01' },
      headers: authed(),
    });
    expect(redeem.statusCode).toBe(200);
    const second = await issue(customerId, campaignId);

    const page = await publicCard(first.uniqueId);
    const data = page.json().data;
    expect(data.canonicalId).toBe(first.customerPublicId);
    expect(data.card.uniqueId).toBe(second.uniqueId);
    expect(data.otherCards).toHaveLength(1);
    expect(data.otherCards[0]).toMatchObject({ uniqueId: first.uniqueId, status: 'Redeemed' });
  });

  it('the newest Active card is the current one (the card the CRM stamps)', async () => {
    const main = await insertCampaign(db.pool, owner.userId, { name: 'Sellos' });
    const winback = await insertCampaign(db.pool, owner.userId, { name: 'Te extrañamos' });
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
    const old = await issue(customerId, main);
    await setCreatedAt(old.id, '2026-05-01T12:00:00Z');
    const newer = await issue(customerId, winback);
    await setCreatedAt(newer.id, '2026-11-10T12:00:00Z');

    const data = (await publicCard(old.uniqueId)).json().data;
    expect(data.card.uniqueId).toBe(newer.uniqueId);
    expect(data.card.campaignName).toBe('Te extrañamos');

    // An Active card wins over a newer Redeemed one.
    await rig.app.inject({
      method: 'PATCH',
      url: `/cards/${newer.id}`,
      payload: { status: 'Redeemed', completedDate: '2026-11-12' },
      headers: authed(),
    });
    const after = (await publicCard(old.customerPublicId)).json().data;
    expect(after.card.uniqueId).toBe(old.uniqueId);
  });

  it("never resolves another business's ids", async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Sellos' });
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
    const card = await issue(customerId, campaignId);
    await insertOwner(db.pool, { email: 'other@example.com', password: 'hunter2bravo', businessName: 'Otro', slug: 'otro' });

    expect((await publicCard(card.customerPublicId, 'otro')).statusCode).toBe(404);
    expect((await publicCard(card.uniqueId, 'otro')).statusCode).toBe(404);
  });

  it('a customer without cards has no page (404)', async () => {
    await insertCustomer(db.pool, owner.userId, { name: 'Sin tarjeta' });
    const { rows } = await db.pool.query<{ public_id: string }>(
      "select public_id from loyalty.customers where name = 'Sin tarjeta'",
    );
    expect((await publicCard(rows[0]!.public_id)).statusCode).toBe(404);
  });

  it('the PWA manifest scopes the installed app to the permanent link', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Sellos' });
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
    const card = await issue(customerId, campaignId);
    const res = await rig.app.inject({ method: 'GET', url: `/public/cards/test-cafe/${card.uniqueId}/manifest.webmanifest` });
    expect(res.statusCode).toBe(200);
    expect(res.json().start_url).toContain(`/test-cafe/${card.customerPublicId}`);
  });
});
