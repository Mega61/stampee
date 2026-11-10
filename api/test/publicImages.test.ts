import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, type TestRig } from './helpers/app.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };

const LOGO_PATH = '11111111-1111-1111-1111-111111111111/logo/22222222-2222-2222-2222-222222222222.png';
const BG_PATH = '11111111-1111-1111-1111-111111111111/background/33333333-3333-3333-3333-333333333333.png';

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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const png = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 192, g: 128, b: 64, alpha } } }).png().toBuffer();

const stubBucket = (objects: Record<string, Buffer>) => {
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname.slice(1);
    const body = objects[path];
    return body
      ? new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'image/png' } })
      : new Response('nope', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('GET /public/img/:ownerId/:kind/:file', () => {
  it('serves the background as WebP, at most 1200px, cacheable forever', async () => {
    const fetchMock = stubBucket({ [BG_PATH]: await png(2000, 1500) });
    for (let i = 0; i < 2; i++) {
      const res = await rig.app.inject({ method: 'GET', url: `/public/img/${BG_PATH}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      const meta = await sharp(res.rawPayload).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1200, 900]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shrinks the logo to 320px and never enlarges a small one', async () => {
    stubBucket({ [LOGO_PATH]: await png(2000, 2000, 0.5) });
    const big = await rig.app.inject({ method: 'GET', url: `/public/img/${LOGO_PATH}` });
    expect(await sharp(big.rawPayload).metadata()).toMatchObject({ format: 'webp', width: 320, hasAlpha: true });

    const small = LOGO_PATH.replace('2222-222222222222', '2222-999999999999');
    stubBucket({ [small]: await png(100, 50) });
    const res = await rig.app.inject({ method: 'GET', url: `/public/img/${small}` });
    expect(await sharp(res.rawPayload).metadata()).toMatchObject({ width: 100, height: 50 });
  });

  it('404s on malformed paths and missing objects', async () => {
    stubBucket({});
    for (const url of [
      // Not BG_PATH: rendered images stay cached in-process across tests.
      `/public/img/${BG_PATH.replace('3333-333333333333', '3333-000000000000')}`,
      '/public/img/11111111-1111-1111-1111-111111111111/other/33333333-3333-3333-3333-333333333333.png',
      '/public/img/x/logo/y.png',
    ]) {
      expect((await rig.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });
});

describe('public card image URLs', () => {
  it('points bucket images at /public/img and leaves external URLs alone', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    await db.pool.query(`update loyalty.campaigns set logo_image = $2, background_image = $3 where id = $1`, [
      campaignId,
      `https://fake-bucket.test/${LOGO_PATH}?X-Goog-Signature=old`,
      'https://example.com/bg.jpg',
    ]);
    const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
    const uniqueId = randomUUID();
    await db.pool.query(
      `insert into loyalty.issued_cards
         (id, owner_id, customer_id, campaign_id, campaign_name, unique_id, stamps, status, template_snapshot)
       values ($1, $2, $3, $4, 'Uñas', $5, 0, 'Active', $6)`,
      [`ic-${uniqueId}`, owner.userId, customerId, campaignId, uniqueId, JSON.stringify({ logoImage: BG_PATH })],
    );

    const res = await rig.app.inject({ method: 'GET', url: `/public/cards/${owner.slug}/${uniqueId}` });
    expect(res.statusCode).toBe(200);
    const { card, campaign } = res.json().data;
    expect(campaign.logoImage).toBe(`http://localhost:3001/public/img/${LOGO_PATH}`);
    expect(campaign.backgroundImage).toBe('https://example.com/bg.jpg');
    expect(card.templateSnapshot.logoImage).toBe(`http://localhost:3001/public/img/${BG_PATH}`);
  });
});
