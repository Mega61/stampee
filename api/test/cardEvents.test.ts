import { randomUUID } from 'node:crypto';
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import {
  buildTestRig,
  insertCampaign,
  insertCustomer,
  insertOwner,
  Session,
  type TestRig,
} from './helpers/app.js';
import type { GoogleWalletConfig, WalletRequest, WalletResponse } from '../src/lib/wallet/google.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let session: Session;
let campaignId: string;
let wallet: typeof import('../src/lib/wallet/google.js');
let events: typeof import('../src/lib/cardEvents.js');
let config: GoogleWalletConfig;
let logged: unknown[];

const ISSUER = '3388000000012345678';

const fakeGoogle = (respond: (req: WalletRequest) => number | Error = () => 200) => {
  const calls: WalletRequest[] = [];
  const http = async (req: WalletRequest): Promise<WalletResponse> => {
    calls.push(req);
    const out = respond(req);
    if (out instanceof Error) throw out;
    return { status: out, body: {} };
  };
  return { calls, http };
};

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
  wallet = await import('../src/lib/wallet/google.js');
  events = await import('../src/lib/cardEvents.js');
  const keys = await generateKeyPair('RS256', { extractable: true });
  config = {
    issuerId: ISSUER,
    serviceAccountEmail: 'wallet@stampee-test.iam.gserviceaccount.com',
    privateKey: await exportPKCS8(keys.privateKey),
    classPrefix: 'stampee',
    appPublicUrl: 'http://localhost:3000',
    apiPublicUrl: 'http://localhost:3001',
  };
}, 120_000);

afterAll(async () => {
  wallet?.setGoogleWalletOverrides(null);
  events?.setCardEventsLogger(null);
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
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas', totalStamps: 10 });
  logged = [];
  events.setCardEventsLogger({ error: (obj) => logged.push(obj) });

  session = new Session();
  const login = await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'owner@example.com', password: 'hunter2bravo' },
    headers: { 'content-type': 'application/json' },
  });
  session.captureFromResponse(login);
});

afterEach(async () => {
  await events.flushCardEvents();
  wallet.setGoogleWalletOverrides(null);
});

const insertCard = async (stamps = 0) => {
  const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana' });
  const uniqueId = randomUUID();
  const id = `ic-${uniqueId}`;
  await db.pool.query(
    `insert into loyalty.issued_cards
       (id, owner_id, customer_id, campaign_id, campaign_name, unique_id, stamps, status)
     values ($1, $2, $3, $4, 'Uñas', $5, $6, 'Active')`,
    [id, owner.userId, customerId, campaignId, uniqueId, stamps],
  );
  return { id, uniqueId, objectId: `${ISSUER}.stampee_${uniqueId}` };
};

const insertPass = async (card: { id: string; objectId: string }) => {
  await db.pool.query(
    `insert into loyalty.wallet_passes (card_id, provider, object_id) values ($1, 'google', $2)`,
    [card.id, card.objectId],
  );
};

const lastSynced = async (cardId: string) => {
  const { rows } = await db.pool.query('select last_synced_at from loyalty.wallet_passes where card_id = $1', [cardId]);
  return rows[0]?.last_synced_at as Date | null | undefined;
};

const headers = () => ({ 'content-type': 'application/json', cookie: session.cookieJarHeader() ?? '' });

describe('onCardChanged', () => {
  it('does nothing (no timer, no calls) when Google Wallet is off', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ http: google.http });
    const card = await insertCard();
    await insertPass(card);

    events.onCardChanged(card.id);
    expect(events.pendingCardEvents()).toEqual([]);
    await events.flushCardEvents();
    expect(google.calls).toHaveLength(0);
  });

  it('patches only cards that have a pass, debounced per card', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const withPass = await insertCard(3);
    const withoutPass = await insertCard(5);
    await insertPass(withPass);

    events.onCardChanged(withPass.id);
    events.onCardChanged(withPass.id);
    events.onCardChanged(withoutPass.id);
    // Returns synchronously; nothing sent until the debounce fires.
    expect(google.calls).toHaveLength(0);
    expect(events.pendingCardEvents().sort()).toEqual([withPass.id, withoutPass.id].sort());

    await events.flushCardEvents();
    expect(google.calls).toEqual([
      {
        method: 'PATCH',
        path: `/loyaltyObject/${encodeURIComponent(withPass.objectId)}`,
        body: { state: 'ACTIVE', loyaltyPoints: { label: 'Sellos', balance: { string: '3/10' } } },
      },
    ]);
    expect(await lastSynced(withPass.id)).toBeInstanceOf(Date);
    expect(logged).toEqual([]);
  });

  it('fires on its own after the debounce window', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard(1);
    await insertPass(card);

    events.onCardChanged(card.id);
    await new Promise((r) => setTimeout(r, events.CARD_EVENT_DEBOUNCE_MS + 300));
    await events.flushCardEvents();
    expect(google.calls).toHaveLength(1);
  });

  it('logs Google failures instead of throwing', async () => {
    const card = await insertCard(2);
    await insertPass(card);

    wallet.setGoogleWalletOverrides({ config, http: fakeGoogle(() => 500).http });
    expect(() => events.onCardChanged(card.id)).not.toThrow();
    await expect(events.flushCardEvents()).resolves.toBeUndefined();

    wallet.setGoogleWalletOverrides({ config, http: fakeGoogle(() => new Error('socket hang up')).http });
    events.onCardChanged(card.id);
    await events.flushCardEvents();

    expect(logged).toHaveLength(2);
    expect(await lastSynced(card.id)).toBeNull();
  });

  it('treats a pass deleted at Google (404) as a no-op', async () => {
    const google = fakeGoogle(() => 404);
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard(2);
    await insertPass(card);

    events.onCardChanged(card.id);
    await events.flushCardEvents();
    expect(google.calls).toHaveLength(1);
    expect(logged).toEqual([]);
    expect(await lastSynced(card.id)).toBeNull();
  });
});

describe('cards routes call onCardChanged', () => {
  it('PATCH /cards/:id and POST /cards/:id/transactions sync the pass once', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard(3);
    await insertPass(card);

    const patch = await rig.app.inject({
      method: 'PATCH',
      url: `/cards/${card.id}`,
      payload: { stamps: 4 },
      headers: headers(),
    });
    expect(patch.statusCode).toBe(200);
    const tx = await rig.app.inject({
      method: 'POST',
      url: `/cards/${card.id}/transactions`,
      payload: { type: 'stamp_add', amount: 1, date: 'Jan 1, 2026 12:00 PM', timestamp: Date.now(), title: 'Stamp #4' },
      headers: headers(),
    });
    expect(tx.statusCode).toBe(200);
    expect(events.pendingCardEvents()).toEqual([card.id]);

    await events.flushCardEvents();
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0]!.body).toMatchObject({ loyaltyPoints: { balance: { string: '4/10' } } });
  });

  it('POST /cards/gift-stamps syncs each gifted card', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const a = await insertCard(1);
    const b = await insertCard(2);
    const full = await insertCard(9); // nearly full → not gifted
    await insertPass(a);
    await insertPass(b);
    await insertPass(full);

    const res = await rig.app.inject({
      method: 'POST',
      url: '/cards/gift-stamps',
      payload: { cardIds: [a.id, b.id, full.id], stamps: 2 },
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect(events.pendingCardEvents().sort()).toEqual([a.id, b.id].sort());

    await events.flushCardEvents();
    const balances = Object.fromEntries(
      google.calls.map((c) => [c.path, (c.body as { loyaltyPoints: { balance: { string: string } } }).loyaltyPoints.balance.string]),
    );
    expect(balances).toEqual({
      [`/loyaltyObject/${encodeURIComponent(a.objectId)}`]: '3/10',
      [`/loyaltyObject/${encodeURIComponent(b.objectId)}`]: '4/10',
    });
  });

  it('routes respond normally while Google is failing', async () => {
    wallet.setGoogleWalletOverrides({ config, http: fakeGoogle(() => new Error('boom')).http });
    const card = await insertCard(3);
    await insertPass(card);

    const patch = await rig.app.inject({
      method: 'PATCH',
      url: `/cards/${card.id}`,
      payload: { stamps: 0, status: 'Redeemed' },
      headers: headers(),
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.status).toBe('Redeemed');
    await events.flushCardEvents();
    expect(logged).toHaveLength(1);
  });
});

describe('onCardChanged: Apple Wallet', () => {
  const PASS_TYPE = 'pass.com.goldenbeauty.loyalty';
  let apple: typeof import('../src/lib/wallet/apple.js');
  // notifyApplePass never signs, so placeholder PEMs are enough here.
  const appleConfig = {
    passTypeId: PASS_TYPE,
    teamId: 'ABCDE12345',
    signerCert: 'cert',
    signerKey: 'key',
    wwdr: 'wwdr',
    apnsHost: 'api.push.apple.invalid',
    appPublicUrl: 'http://localhost:3000',
    apiPublicUrl: 'http://localhost:3001',
  };

  const fakeApns = (respond: (token: string) => number | Error = () => 200) => {
    const calls: string[][] = [];
    const push = async (_cfg: unknown, tokens: string[]) => {
      calls.push([...tokens].sort());
      return tokens.map((pushToken) => {
        const out = respond(pushToken);
        if (out instanceof Error) throw out;
        return { pushToken, status: out };
      });
    };
    return { calls, push };
  };

  const insertApplePass = async (card: { id: string; uniqueId: string }, devices: Array<[string, string]>) => {
    await db.pool.query(
      `insert into loyalty.wallet_passes (card_id, provider, object_id, auth_token, updated_at)
       values ($1, 'apple', $2, $3, now() - interval '1 hour')`,
      [card.id, card.uniqueId, 'a'.repeat(64)],
    );
    for (const [device, token] of devices) {
      await db.pool.query(
        `insert into loyalty.wallet_devices (device_library_id, push_token, pass_type_id, serial) values ($1, $2, $3, $4)`,
        [device, token, PASS_TYPE, card.uniqueId],
      );
    }
  };

  const appleUpdatedAt = async (cardId: string) => {
    const { rows } = await db.pool.query(
      `select updated_at from loyalty.wallet_passes where card_id = $1 and provider = 'apple'`,
      [cardId],
    );
    return rows[0]?.updated_at as Date;
  };

  beforeAll(async () => {
    apple = await import('../src/lib/wallet/apple.js');
  });

  afterEach(async () => {
    await events.flushCardEvents();
    apple.setAppleWalletOverrides(null);
  });

  it('bumps the pass and pushes every device of that pass only (Google off)', async () => {
    const apns = fakeApns();
    apple.setAppleWalletOverrides({ config: appleConfig, push: apns.push });
    const card = await insertCard(3);
    const other = await insertCard(1);
    await insertApplePass(card, [['d1', '1'.repeat(64)], ['d2', '2'.repeat(64)]]);
    await insertApplePass(other, [['d3', '3'.repeat(64)]]);
    const before = await appleUpdatedAt(card.id);

    events.onCardChanged(card.id);
    expect(events.pendingCardEvents()).toEqual([card.id]);
    expect(apns.calls).toHaveLength(0);
    await events.flushCardEvents();

    expect(apns.calls).toEqual([['1'.repeat(64), '2'.repeat(64)]]);
    expect((await appleUpdatedAt(card.id)).getTime()).toBeGreaterThan(before.getTime());
    expect((await appleUpdatedAt(other.id)).getTime()).toBeLessThan(Date.now() - 30 * 60_000);
    expect(logged).toEqual([]);
  });

  it('drops devices APNs reports as gone (410) and logs other failures', async () => {
    const apns = fakeApns((t) => (t.startsWith('1') ? 410 : t.startsWith('2') ? 500 : 200));
    apple.setAppleWalletOverrides({ config: appleConfig, push: apns.push });
    const card = await insertCard(3);
    await insertApplePass(card, [['d1', '1'.repeat(64)], ['d2', '2'.repeat(64)], ['d3', '3'.repeat(64)]]);

    events.onCardChanged(card.id);
    await events.flushCardEvents();

    const { rows } = await db.pool.query('select device_library_id from loyalty.wallet_devices order by 1');
    expect(rows.map((r) => r.device_library_id)).toEqual(['d2', 'd3']);
    expect(logged).toHaveLength(1);
  });

  it('never throws when APNs blows up, and Google still syncs', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    apple.setAppleWalletOverrides({ config: appleConfig, push: fakeApns(() => new Error('tls handshake')).push });
    const card = await insertCard(4);
    await insertPass(card);
    await insertApplePass(card, [['d1', '1'.repeat(64)]]);

    expect(() => events.onCardChanged(card.id)).not.toThrow();
    await expect(events.flushCardEvents()).resolves.toBeUndefined();

    expect(google.calls).toHaveLength(1);
    expect(google.calls[0]!.body).toMatchObject({ loyaltyPoints: { balance: { string: '4/10' } } });
    // Push failures are reported, never thrown; the device stays registered.
    expect(logged).toHaveLength(1);
    expect((await db.pool.query('select * from loyalty.wallet_devices')).rows).toHaveLength(1);
  });

  it('a Google failure does not stop the Apple push', async () => {
    const apns = fakeApns();
    wallet.setGoogleWalletOverrides({ config, http: fakeGoogle(() => 500).http });
    apple.setAppleWalletOverrides({ config: appleConfig, push: apns.push });
    const card = await insertCard(2);
    await insertPass(card);
    await insertApplePass(card, [['d1', '1'.repeat(64)]]);

    events.onCardChanged(card.id);
    await events.flushCardEvents();
    expect(apns.calls).toHaveLength(1);
    expect(logged).toHaveLength(1);
  });

  it('PATCH /cards/:id pushes the Apple pass', async () => {
    const apns = fakeApns();
    apple.setAppleWalletOverrides({ config: appleConfig, push: apns.push });
    const card = await insertCard(3);
    await insertApplePass(card, [['d1', '1'.repeat(64)]]);

    const patch = await rig.app.inject({
      method: 'PATCH',
      url: `/cards/${card.id}`,
      payload: { stamps: 4 },
      headers: headers(),
    });
    expect(patch.statusCode).toBe(200);
    await events.flushCardEvents();
    expect(apns.calls).toEqual([['1'.repeat(64)]]);
  });
});
