import { randomUUID } from 'node:crypto';
import { decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify, type KeyLike } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, type TestRig } from './helpers/app.js';
import type { GoogleWalletConfig, WalletRequest, WalletResponse } from '../src/lib/wallet/google.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let wallet: typeof import('../src/lib/wallet/google.js');
let publicKey: KeyLike;
let config: GoogleWalletConfig;

const ISSUER = '3388000000012345678';
const SA_EMAIL = 'wallet@stampee-test.iam.gserviceaccount.com';

/** Fake Wallet REST API: records calls; `respond` decides each status. */
const fakeGoogle = (respond: (req: WalletRequest) => number = () => 200) => {
  const calls: WalletRequest[] = [];
  const http = async (req: WalletRequest): Promise<WalletResponse> => {
    calls.push(req);
    const status = respond(req);
    return { status, body: status < 300 ? (req.body ?? {}) : { error: { code: status } } };
  };
  return { calls, http };
};

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
  wallet = await import('../src/lib/wallet/google.js');
  const keys = await generateKeyPair('RS256', { extractable: true });
  publicKey = keys.publicKey;
  config = {
    issuerId: ISSUER,
    serviceAccountEmail: SA_EMAIL,
    privateKey: await exportPKCS8(keys.privateKey),
    classPrefix: 'stampee',
    appPublicUrl: 'http://localhost:3000',
    apiPublicUrl: 'http://localhost:3001',
  };
}, 120_000);

afterAll(async () => {
  wallet?.setGoogleWalletOverrides(null);
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
  wallet.setGoogleWalletOverrides(null);
});

const insertCard = async (params: {
  campaignId: string;
  stamps?: number;
  status?: 'Active' | 'Redeemed';
  customerName?: string;
  snapshot?: Record<string, unknown> | null;
}) => {
  const customerId = await insertCustomer(db.pool, owner.userId, { name: params.customerName ?? 'Ana María Pérez' });
  const uniqueId = randomUUID();
  const id = `ic-${uniqueId}`;
  await db.pool.query(
    `insert into loyalty.issued_cards
       (id, owner_id, customer_id, campaign_id, campaign_name, unique_id, stamps, status, template_snapshot)
     values ($1, $2, $3, $4, 'Uñas', $5, $6, $7, $8)`,
    [
      id,
      owner.userId,
      customerId,
      params.campaignId,
      uniqueId,
      params.stamps ?? 0,
      params.status ?? 'Active',
      params.snapshot ? JSON.stringify(params.snapshot) : null,
    ],
  );
  return { id, uniqueId };
};

const getConfig = () => rig.app.inject({ method: 'GET', url: '/public/wallet/config' });
const getSave = (slug: string, uniqueId: string) =>
  rig.app.inject({ method: 'GET', url: `/public/cards/${slug}/${uniqueId}/wallet/google` });

describe('Google Wallet: not configured', () => {
  it('reports google=false and 404s the save link without calling Google', async () => {
    const google = fakeGoogle();
    // Env has no GOOGLE_WALLET_* in tests: the env-derived config is off.
    wallet.setGoogleWalletOverrides({ http: google.http });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });

    const cfg = await getConfig();
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json()).toEqual({ ok: true, data: { google: false, apple: false } });

    const save = await getSave(owner.slug, card.uniqueId);
    expect(save.statusCode).toBe(404);
    expect(google.calls).toHaveLength(0);
    const { rows } = await db.pool.query('select * from loyalty.wallet_passes');
    expect(rows).toHaveLength(0);
  });
});

describe('Google Wallet: configured', () => {
  it('reports google=true', async () => {
    wallet.setGoogleWalletOverrides({ config, http: fakeGoogle().http });
    expect((await getConfig()).json()).toEqual({ ok: true, data: { google: true, apple: false } });
  });

  it('upserts class + object, records the pass and returns a signed save link', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas felices', totalStamps: 10 });
    const card = await insertCard({ campaignId, stamps: 4, snapshot: { totalStamps: 10, colors: { background: 'bg-[#F4E1D2]' } } });

    const res = await getSave(owner.slug, card.uniqueId);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { saveUrl } = res.json().data as { saveUrl: string };
    expect(saveUrl.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);

    // JWT: RS256, signed by the service account, for this object only.
    const token = saveUrl.slice('https://pay.google.com/gp/v/save/'.length);
    expect(decodeProtectedHeader(token).alg).toBe('RS256');
    const { payload } = await jwtVerify(token, publicKey, { issuer: SA_EMAIL, audience: 'google' });
    const objectId = `${ISSUER}.stampee_${card.uniqueId}`;
    expect(payload).toMatchObject({
      typ: 'savetowallet',
      origins: ['http://localhost:3000'],
      payload: { loyaltyObjects: [{ id: objectId }] },
    });

    // Class then object, each inserted.
    expect(google.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /loyaltyClass', 'POST /loyaltyObject']);
    const classId = `${ISSUER}.stampee_${campaignId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    expect(google.calls[0]!.body).toMatchObject({
      id: classId,
      issuerName: 'Golden Beauty',
      programName: 'Uñas felices',
      hexBackgroundColor: '#f4e1d2',
      reviewStatus: 'UNDER_REVIEW',
      programLogo: { sourceUri: { uri: 'http://localhost:3001/public/brand/golden-beauty/icon-512.png?bg=f4e1d2' } },
    });
    expect(google.calls[1]!.body).toEqual({
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountName: 'Ana',
      loyaltyPoints: { label: 'Sellos', balance: { string: '4/10' } },
      barcode: { type: 'QR_CODE', value: `http://localhost:3000/golden-beauty/scan/${card.uniqueId}` },
      linksModuleData: {
        uris: [
          { id: 'card', uri: `http://localhost:3000/golden-beauty/${card.uniqueId}?src=wallet`, description: 'Ver mi tarjeta' },
        ],
      },
    });

    const { rows } = await db.pool.query('select * from loyalty.wallet_passes');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ card_id: card.id, provider: 'google', object_id: objectId });
    expect(rows[0].last_synced_at).toBeInstanceOf(Date);
  });

  it('patches on 409, skips an unchanged class, and keeps a single pass row', async () => {
    const google = fakeGoogle((req) => (req.method === 'POST' ? 409 : 200));
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId, stamps: 9, status: 'Redeemed' });

    expect((await getSave(owner.slug, card.uniqueId)).statusCode).toBe(200);
    expect((await getSave(owner.slug, card.uniqueId)).statusCode).toBe(200);

    const objectPath = `/loyaltyObject/${encodeURIComponent(`${ISSUER}.stampee_${card.uniqueId}`)}`;
    expect(google.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /loyaltyClass',
      expect.stringMatching(/^PATCH \/loyaltyClass\//),
      'POST /loyaltyObject',
      `PATCH ${objectPath}`,
      // Second call: the class payload is unchanged, so only the object.
      'POST /loyaltyObject',
      `PATCH ${objectPath}`,
    ]);
    // Redeemed card → inactive pass; no snapshot → campaign total.
    expect(google.calls[3]!.body).toMatchObject({
      state: 'INACTIVE',
      loyaltyPoints: { balance: { string: '9/10' } },
    });
    const { rows } = await db.pool.query('select * from loyalty.wallet_passes');
    expect(rows).toHaveLength(1);
  });

  it('404s for unknown cards and for cards of another business', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });
    await insertOwner(db.pool, { email: 'other@example.com', password: 'hunter2bravo', businessName: 'Other', slug: 'other' });

    expect((await getSave(owner.slug, randomUUID())).statusCode).toBe(404);
    expect((await getSave('other', card.uniqueId)).statusCode).toBe(404);
    expect(google.calls).toHaveLength(0);
  });

  it('answers 502 when Google fails, without recording a pass', async () => {
    const google = fakeGoogle(() => 500);
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });

    const res = await getSave(owner.slug, card.uniqueId);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('WALLET_UNAVAILABLE');
    const { rows } = await db.pool.query('select * from loyalty.wallet_passes');
    expect(rows).toHaveLength(0);
  });
});
