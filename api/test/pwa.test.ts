import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, type TestRig } from './helpers/app.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };

const LOGO_PATH = '11111111-1111-1111-1111-111111111111/logo/22222222-2222-2222-2222-222222222222.png';

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
    businessName: 'Éclat Studio',
    slug: 'eclat-studio',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const insertCard = async (params: { campaignId: string; snapshotBackground?: string }) => {
  const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
  const uniqueId = randomUUID();
  const snapshot = params.snapshotBackground ? { colors: { background: params.snapshotBackground } } : null;
  await db.pool.query(
    `insert into loyalty.issued_cards
       (id, owner_id, customer_id, campaign_id, campaign_name, unique_id, stamps, status, template_snapshot)
     values ($1, $2, $3, $4, 'Uñas', $5, 0, 'Active', $6)`,
    [`ic-${uniqueId}`, owner.userId, customerId, params.campaignId, uniqueId, snapshot ? JSON.stringify(snapshot) : null],
  );
  return uniqueId;
};

const setCampaignBrand = async (campaignId: string, colors: Record<string, string>, logo: string | null) => {
  await db.pool.query(`update loyalty.campaigns set colors = $2::jsonb, logo_image = $3 where id = $1`, [
    campaignId,
    JSON.stringify(colors),
    logo,
  ]);
};

describe('GET /public/cards/:slug/:uniqueId/manifest.webmanifest', () => {
  it('returns a per-card manifest scoped to the card on the SPA origin', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const uniqueId = await insertCard({ campaignId, snapshotBackground: 'bg-[#F4E1D2]' });

    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/${owner.slug}/${uniqueId}/manifest.webmanifest`,
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/manifest+json');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const manifest = res.json();
    const scope = `http://localhost:3000/${owner.slug}/${uniqueId}`;
    expect(manifest).toMatchObject({
      id: scope,
      name: 'Éclat Studio',
      short_name: 'Éclat Studio',
      start_url: `${scope}?src=pwa`,
      scope,
      display: 'standalone',
      background_color: '#f4e1d2',
      theme_color: '#f4e1d2',
    });
    expect(manifest.icons).toEqual([
      expect.objectContaining({ sizes: '192x192', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
    ]);
    expect(manifest.icons[0].src).toBe(`http://localhost:3001/public/brand/${owner.slug}/icon-192.png?bg=f4e1d2`);
    expect(manifest.icons[2].src).toContain('maskable=1');
  });

  it('falls back to the campaign background when the snapshot has none', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    await setCampaignBrand(campaignId, { background: '#112233' }, null);
    const uniqueId = await insertCard({ campaignId });
    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/${owner.slug}/${uniqueId}/manifest.webmanifest`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().theme_color).toBe('#112233');
  });

  it('404s for an unknown card or business', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const uniqueId = await insertCard({ campaignId });
    const unknownCard = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/${owner.slug}/${randomUUID()}/manifest.webmanifest`,
    });
    expect(unknownCard.statusCode).toBe(404);
    const wrongSlug = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/other-biz/${uniqueId}/manifest.webmanifest`,
    });
    expect(wrongSlug.statusCode).toBe(404);
  });
});

describe('GET /public/brand/:slug/icon-:size.png', () => {
  const pixel = async (png: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };

  it('renders the initial on the brand color when there is no logo', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    await setCampaignBrand(campaignId, { background: '#7a2e4d' }, null);

    for (const size of [180, 192, 512]) {
      const res = await rig.app.inject({ method: 'GET', url: `/public/brand/${owner.slug}/icon-${size}.png` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      const meta = await sharp(res.rawPayload).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
      // Corner is the brand color; the "E" glyph is light ink on it.
      expect(await pixel(res.rawPayload, 2, 2)).toEqual([0x7a, 0x2e, 0x4d]);
      const stats = await sharp(res.rawPayload).stats();
      expect(stats.channels[0]!.max).toBeGreaterThan(240);
    }
  });

  it('works for a business with no campaigns at all (white, dark initial)', async () => {
    const res = await rig.app.inject({ method: 'GET', url: `/public/brand/${owner.slug}/icon-192.png` });
    expect(res.statusCode).toBe(200);
    expect(await pixel(res.rawPayload, 0, 0)).toEqual([255, 255, 255]);
    const stats = await sharp(res.rawPayload).stats();
    expect(stats.channels[0]!.min).toBeLessThan(40);
  });

  it('composites the signed logo onto the background, padded for maskable', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    await setCampaignBrand(campaignId, { background: '#ffffff' }, LOGO_PATH);
    const logo = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`https://fake-bucket.test/${LOGO_PATH}?signed=1`);
      return new Response(new Uint8Array(logo), { status: 200, headers: { 'content-type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await rig.app.inject({ method: 'GET', url: `/public/brand/${owner.slug}/icon-512.png?maskable=1` });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await sharp(res.rawPayload).metadata()).width).toBe(512);
    expect(await pixel(res.rawPayload, 256, 256)).toEqual([255, 0, 0]);
    // Outside the 56% safe box it's the background.
    expect(await pixel(res.rawPayload, 100, 256)).toEqual([255, 255, 255]);

    // `bg` overrides the brand color (the manifest passes the card's).
    const tinted = await rig.app.inject({ method: 'GET', url: `/public/brand/${owner.slug}/icon-192.png?bg=000000` });
    expect(await pixel(tinted.rawPayload, 1, 1)).toEqual([0, 0, 0]);
    expect(await pixel(tinted.rawPayload, 96, 96)).toEqual([255, 0, 0]);
  });

  it('falls back to the initial when the logo cannot be fetched', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    await setCampaignBrand(campaignId, { background: '#123456' }, LOGO_PATH);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const res = await rig.app.inject({ method: 'GET', url: `/public/brand/${owner.slug}/icon-180.png` });
    expect(res.statusCode).toBe(200);
    expect(await pixel(res.rawPayload, 0, 0)).toEqual([0x12, 0x34, 0x56]);
  });

  it('404s for unsupported sizes, bad file names and unknown businesses', async () => {
    for (const url of [
      `/public/brand/${owner.slug}/icon-64.png`,
      `/public/brand/${owner.slug}/logo.png`,
      `/public/brand/no-such-biz/icon-192.png`,
    ]) {
      const res = await rig.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
    }
  });
});
