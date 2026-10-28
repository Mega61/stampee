// Wallet pass upgrades: richer Google pass (hero, contact links, level, lucky
// stamps), notifications + budget, weekly game scheduler, save/delete
// callbacks, hero image route, "Passes in Wallet" analytics.
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { exportPKCS8, generateKeyPair } from 'jose';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, Session, type TestRig } from './helpers/app.js';
import type { GoogleWalletConfig, WalletRequest, WalletResponse } from '../src/lib/wallet/google.js';
import { cardBucket, GAME_HOLDOUT_BUCKET } from '../src/lib/holdout.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let campaignId: string;
let wallet: typeof import('../src/lib/wallet/google.js');
let events: typeof import('../src/lib/cardEvents.js');
let content: typeof import('../src/lib/wallet/passContent.js');
let scheduler: typeof import('../src/lib/wallet/scheduler.js');
let callback: typeof import('../src/lib/wallet/googleCallback.js');
let config: GoogleWalletConfig;
let logged: unknown[];

const ISSUER = '3388000000012345678';
const DAY = 24 * 60 * 60 * 1000;
const BG_PATH = '11111111-1111-1111-1111-111111111111/background/33333333-3333-3333-3333-333333333333.jpg';

// The owner's real contact details (Golden Beauty Studio, Sabaneta).
const MAPS =
  'https://www.google.com/maps/search/?api=1&query=Calle%2069%20Sur%20%2343a%20-%2041%2C%20Primer%20Piso%2C%20Sabaneta%20%C2%B7%20Antioquia%20%C2%B7%20Colombia&query_place_id=ChIJWy7PWB-DRo4RatmsIAbFvBU';
const SOCIAL = {
  instagram: '@goldenbeautystudio',
  whatsapp: '+57 301 464 8943',
  phone: '+57 301 464 8943',
  mapsUrl: MAPS,
  hours: 'Lun–Sáb 13:00–19:00 · Domingos y festivos cerrado',
};

/** Fake Wallet REST API. `calls` = object calls, `classCalls` = class upserts. */
const fakeGoogle = (respond: (req: WalletRequest) => number = () => 200) => {
  const calls: WalletRequest[] = [];
  const classCalls: WalletRequest[] = [];
  const http = async (req: WalletRequest): Promise<WalletResponse> => {
    (req.path.startsWith('/loyaltyClass') ? classCalls : calls).push(req);
    return { status: respond(req), body: {} };
  };
  const patches = () => calls.filter((c) => c.method === 'PATCH' && !('messages' in (c.body as object)));
  const messages = () =>
    calls
      .filter((c) => c.path.endsWith('/addMessage'))
      .map((c) => (c.body as { message: { header: string; body: string; messageType: string } }).message);
  return { calls, classCalls, http, patches, messages };
};

const uniqueIdFor = (holdout: boolean) => {
  for (;;) {
    const id = randomUUID();
    if ((cardBucket(id) === GAME_HOLDOUT_BUCKET) === holdout) return id;
  }
};

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
  wallet = await import('../src/lib/wallet/google.js');
  events = await import('../src/lib/cardEvents.js');
  content = await import('../src/lib/wallet/passContent.js');
  scheduler = await import('../src/lib/wallet/scheduler.js');
  callback = await import('../src/lib/wallet/googleCallback.js');
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
  await db.pool.query('truncate loyalty.wallet_job_runs');
  delete process.env.GAME_HOLDOUT;
  owner = await insertOwner(db.pool, {
    email: 'owner@example.com',
    password: 'hunter2bravo',
    businessName: 'Golden Beauty',
    slug: 'golden-beauty',
  });
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas', totalStamps: 10 });
  await db.pool.query(`update loyalty.campaigns set reward_name = 'Manicure gratis' where id = $1`, [campaignId]);
  logged = [];
  events.setCardEventsLogger({ error: (obj) => logged.push(obj) });
});

afterEach(async () => {
  await events.flushCardEvents();
  wallet.setGoogleWalletOverrides(null);
  vi.unstubAllGlobals();
});

const setSocial = (social: Record<string, string> | null, background: string | null = null) =>
  db.pool.query(`update loyalty.campaigns set social = $2::jsonb, background_image = $3 where id = $1`, [
    campaignId,
    social ? JSON.stringify(social) : null,
    background,
  ]);

const addTx = (cardId: string, type: string, timestamp = Date.now() - DAY, amount = 1) =>
  db.pool.query(
    `insert into loyalty.transactions (card_id, type, amount, date, "timestamp", title) values ($1, $2, $3, 'x', $4, 'x')`,
    [cardId, type, amount, timestamp],
  );

const insertCard = async (opts: { stamps?: number; customer?: string; uniqueId?: string; status?: string } = {}) => {
  const customer = opts.customer ?? (await insertCustomer(db.pool, owner.userId, { name: 'Ana María' }));
  const uniqueId = opts.uniqueId ?? uniqueIdFor(false);
  const id = `ic-${uniqueId}`;
  await db.pool.query(
    `insert into loyalty.issued_cards (id, owner_id, customer_id, campaign_id, campaign_name, unique_id, stamps, status)
     values ($1, $2, $3, $4, 'Uñas', $5, $6, $7)`,
    [id, owner.userId, customer, campaignId, uniqueId, opts.stamps ?? 0, opts.status ?? 'Active'],
  );
  return { id, uniqueId, customer, objectId: `${ISSUER}.stampee_${uniqueId}` };
};

/** A pass whose last sync saw `stamps` (as if issued through the save link). */
const insertPass = async (card: { id: string; objectId: string }, synced: { stamps?: number | null; level?: string | null } = {}) =>
  db.pool.query(
    `insert into loyalty.wallet_passes (card_id, provider, object_id, synced_stamps, synced_level) values ($1, 'google', $2, $3, $4)`,
    [card.id, card.objectId, synced.stamps ?? null, synced.level ?? null],
  );

const passRow = async (cardId: string) =>
  (await db.pool.query(`select * from loyalty.wallet_passes where card_id = $1 and provider = 'google'`, [cardId])).rows[0];

const notifications = async (cardId: string) =>
  (
    await db.pool.query(
      `select kind, notified, dedupe_key from loyalty.wallet_notifications where card_id = $1 order by id`,
      [cardId],
    )
  ).rows as Array<{ kind: string; notified: boolean; dedupe_key: string | null }>;

const setStamps = (cardId: string, stamps: number) =>
  db.pool.query(`update loyalty.issued_cards set stamps = $2 where id = $1`, [cardId, stamps]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('pass content (pure)', () => {
  it('levels: Bronce 0–4, Plata 5–14, Oro 15+', () => {
    expect([0, 4, 5, 14, 15, 80].map(content.levelFor)).toEqual(['bronce', 'bronce', 'plata', 'plata', 'oro', 'oro']);
  });

  it('progress text and short code', () => {
    expect(content.progressText(7, 10, 'Manicure gratis')).toBe('Te faltan 3 sellos para tu Manicure gratis');
    expect(content.progressText(9, 10, 'Manicure gratis')).toBe('Te falta 1 sello para tu Manicure gratis');
    expect(content.progressText(0, 10, '')).toBe('Te faltan 10 sellos para tu premio');
    expect(content.progressText(10, 10, 'Manicure gratis')).toBe('¡Tu Manicure gratis está listo! Muéstralo en el salón');
    expect(content.shortCode('093ead83-275e-47de-b114-0fabfa6ca8c4')).toBe('6CA8C4');
  });

  it('contact links: only those set, Colombian numbers get 57', () => {
    expect(content.contactLinks(content.contactFrom(SOCIAL))).toEqual([
      {
        id: 'whatsapp',
        uri: 'https://api.whatsapp.com/send?phone=573014648943&text=Hola.%20Quiero%20agendar!',
        description: 'Agendar por WhatsApp',
      },
      { id: 'maps', uri: MAPS, description: 'Cómo llegar' },
      { id: 'call', uri: 'tel:+573014648943', description: 'Llamar' },
      { id: 'instagram', uri: 'https://instagram.com/goldenbeautystudio', description: 'Instagram' },
    ]);
    expect(content.whatsAppBookingUrl('3014648943')).toContain('phone=573014648943');
    expect(content.contactLinks(content.contactFrom({ phone: '301 464 8943' })).map((l) => l.id)).toEqual(['call']);
    expect(content.contactLinks(content.contactFrom({ mapsUrl: 'javascript:alert(1)' }))).toEqual([]);
    expect(content.contactLinks(content.contactFrom(null))).toEqual([]);
  });

  it('planNotifications: causes, completion, level up, priority order', () => {
    const plan = content.planNotifications;
    const changes = (...causes: Array<'stamp' | 'gift' | 'bonus' | 'other'>) => ({ causes: new Set(causes), giftedStamps: 2 });
    const state = (stamps: number, level: 'bronce' | 'plata' | 'oro' = 'bronce') =>
      ({ stamps, totalStamps: 10, status: 'Active' as const, level });

    expect(plan({ stamps: 3, level: 'bronce' }, state(4), changes('stamp'))).toEqual([{ kind: 'stamp' }]);
    // No cause known (a lone PATCH): a stamp increase still counts as a stamp.
    expect(plan({ stamps: 3, level: 'bronce' }, state(4), changes())).toEqual([{ kind: 'stamp' }]);
    expect(plan({ stamps: 3, level: 'bronce' }, state(4), changes('bonus'))).toEqual([]);
    expect(plan({ stamps: 3, level: 'bronce' }, state(5), changes('gift'))).toEqual([{ kind: 'gift', stamps: 2 }]);
    expect(plan({ stamps: 9, level: 'bronce' }, state(10, 'plata'), changes('stamp'))).toEqual([
      { kind: 'reward_ready' },
      { kind: 'stamp' },
      { kind: 'level_up', level: 'plata' },
    ]);
    // Already complete before; removal; unknown previous state without a cause.
    expect(plan({ stamps: 10, level: 'bronce' }, state(11), changes('stamp'))).toEqual([{ kind: 'stamp' }]);
    expect(plan({ stamps: 4, level: 'bronce' }, state(3), changes('other'))).toEqual([]);
    expect(plan({ stamps: null, level: null }, state(4, 'oro'), changes())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Class / object payloads
// ---------------------------------------------------------------------------

const getSave = (uniqueId: string) =>
  rig.app.inject({ method: 'GET', url: `/public/cards/${owner.slug}/${uniqueId}/wallet/google` });

describe('Google pass payloads', () => {
  it('class: hero, contact links, hours and the callback URL', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    await setSocial(SOCIAL, BG_PATH);
    const card = await insertCard({ stamps: 2 });

    expect((await getSave(card.uniqueId)).statusCode).toBe(200);
    const cls = google.classCalls[0]!.body as Record<string, unknown>;
    expect(cls).toMatchObject({
      heroImage: {
        sourceUri: {
          uri: expect.stringMatching(
            new RegExp(`^http://localhost:3001/public/brand/golden-beauty/hero\\.jpg\\?c=${campaignId}&v=[0-9a-f]{10}$`),
          ),
        },
      },
      textModulesData: [{ id: 'hours', header: 'Horario', body: SOCIAL.hours }],
      callbackOptions: { url: 'http://localhost:3001/wallet/google/callback' },
    });
    expect((cls['linksModuleData'] as { uris: Array<{ id: string; description: string }> }).uris.map((u) => u.description)).toEqual([
      'Agendar por WhatsApp',
      'Cómo llegar',
      'Llamar',
      'Instagram',
    ]);
  });

  it('class: no hero, empty links/hours when the campaign has none', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    await setSocial({ instagram: '@goldenbeautystudio' });
    const card = await insertCard();

    await getSave(card.uniqueId);
    const cls = google.classCalls[0]!.body as Record<string, unknown>;
    expect(cls).not.toHaveProperty('heroImage');
    expect(cls['textModulesData']).toEqual([]);
    expect(cls['linksModuleData']).toEqual({
      uris: [{ id: 'instagram', uri: 'https://instagram.com/goldenbeautystudio', description: 'Instagram' }],
    });
  });

  it('object: level from visits on all the client cards, lucky stamps, progress, short code', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const old = await insertCard({ stamps: 10, status: 'Redeemed' });
    const card = await insertCard({ stamps: 7, customer: old.customer });
    // 5 visits on the old card + 1 on this one = 6 → Plata. Gifts/bonus don't count.
    for (let i = 0; i < 5; i++) await addTx(old.id, 'stamp_add');
    await addTx(card.id, 'stamp_add');
    await addTx(card.id, 'gift');
    await addTx(card.id, 'bonus');
    await addTx(card.id, 'bonus');

    await getSave(card.uniqueId);
    const obj = google.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(obj).toMatchObject({
      loyaltyPoints: { label: 'Sellos', balance: { string: '7/10' } },
      secondaryLoyaltyPoints: { label: 'Sellos de la suerte', balance: { int: 2 } },
      textModulesData: [
        { id: 'progress', header: 'Tu recompensa', body: 'Te faltan 3 sellos para tu Manicure gratis' },
        { id: 'level', header: 'Tu nivel', body: 'Plata' },
      ],
      barcode: { alternateText: card.uniqueId.replace(/-/g, '').slice(-6).toUpperCase() },
    });
    expect(await passRow(card.id)).toMatchObject({ synced_stamps: 7, synced_level: 'plata' });

    // 15 visits → Oro; no bonus stamps → no secondary points.
    const vip = await insertCard({ stamps: 10 });
    for (let i = 0; i < 15; i++) await addTx(vip.id, 'stamp_add');
    await getSave(vip.uniqueId);
    const vipObj = google.calls.filter((c) => c.method === 'POST').at(-1)!.body as Record<string, unknown>;
    expect(vipObj).not.toHaveProperty('secondaryLoyaltyPoints');
    expect(vipObj['textModulesData']).toEqual([
      { id: 'progress', header: 'Tu recompensa', body: '¡Tu Manicure gratis está listo! Muéstralo en el salón' },
      { id: 'level', header: 'Tu nivel', body: 'Oro' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe('Google notifications', () => {
  it('stamp: balance update with NOTIFY_ON_UPDATE; game bonus: silent', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard({ stamps: 4 });
    await insertPass(card, { stamps: 3, level: 'bronce' });

    events.onCardChanged(card.id, 'stamp');
    await events.flushCardEvents();
    expect(google.patches().at(-1)!.body).toMatchObject({ notifyPreference: 'NOTIFY_ON_UPDATE' });
    expect(await passRow(card.id)).toMatchObject({ synced_stamps: 4 });

    await setStamps(card.id, 5);
    events.onCardChanged(card.id, 'bonus');
    await events.flushCardEvents();
    expect(google.patches()).toHaveLength(2);
    expect(google.patches()[1]!.body).not.toHaveProperty('notifyPreference');
    expect(google.patches()[1]!.body).toMatchObject({ loyaltyPoints: { balance: { string: '5/10' } } });
    expect(google.messages()).toEqual([]);
    expect(await notifications(card.id)).toEqual([{ kind: 'stamp', notified: true, dedupe_key: null }]);
    expect(logged).toEqual([]);
  });

  it('reward ready: a notifying message, and the balance update stays silent', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard({ stamps: 10 });
    await insertPass(card, { stamps: 9, level: 'bronce' });

    events.onCardChanged(card.id, 'stamp');
    await events.flushCardEvents();
    expect(google.patches()[0]!.body).not.toHaveProperty('notifyPreference');
    expect(google.messages()).toEqual([
      expect.objectContaining({
        header: '🎉 ¡Tu Manicure gratis está listo!',
        body: 'Muéstralo en el salón para reclamarlo.',
        messageType: 'TEXT_AND_NOTIFY',
      }),
    ]);
    expect(google.calls.at(-1)!.path).toBe(`/loyaltyObject/${encodeURIComponent(card.objectId)}/addMessage`);
  });

  it('level up: a notifying message when the client reaches Plata', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard({ stamps: 5 });
    for (let i = 0; i < 5; i++) await addTx(card.id, 'stamp_add');
    await insertPass(card, { stamps: 5, level: 'bronce' });

    // Nothing else changed (e.g. a visit on another card): the level alone rings.
    events.onCardChanged(card.id, 'other');
    await events.flushCardEvents();
    expect(google.messages()).toEqual([expect.objectContaining({ header: '⭐ ¡Subiste a nivel Plata!', messageType: 'TEXT_AND_NOTIFY' })]);
    expect(await passRow(card.id)).toMatchObject({ synced_level: 'plata' });
  });

  it('budget: 3 notifying updates per pass per 24 h, then silent; priority keeps the last slot', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard({ stamps: 1 });
    await insertPass(card, { stamps: 0, level: 'bronce' });

    // Two stamps ring.
    for (const stamps of [1, 2]) {
      await setStamps(card.id, stamps);
      events.onCardChanged(card.id, 'stamp');
      await events.flushCardEvents();
    }
    // A gift may not take the last slot (reserved for more important ones):
    // the message still lands on the pass, as plain TEXT.
    await setStamps(card.id, 4);
    events.onCardChanged(card.id, 'gift', 2);
    await events.flushCardEvents();
    expect(google.messages().at(-1)).toMatchObject({ header: '🎁 Golden Beauty te regaló 2 sellos', messageType: 'TEXT' });

    // Reward ready may: it's the top priority.
    await setStamps(card.id, 10);
    events.onCardChanged(card.id, 'stamp');
    await events.flushCardEvents();
    expect(google.messages().at(-1)).toMatchObject({ header: '🎉 ¡Tu Manicure gratis está listo!', messageType: 'TEXT_AND_NOTIFY' });

    // Budget spent: the next stamp updates silently.
    await setStamps(card.id, 11);
    events.onCardChanged(card.id, 'stamp');
    await events.flushCardEvents();
    expect(google.patches().at(-1)!.body).not.toHaveProperty('notifyPreference');
    expect(google.patches().at(-1)!.body).toMatchObject({ loyaltyPoints: { balance: { string: '11/10' } } });

    expect((await notifications(card.id)).map((n) => [n.kind, n.notified])).toEqual([
      ['stamp', true],
      ['stamp', true],
      ['gift', false],
      ['reward_ready', true],
      ['stamp', false],
    ]);

    // A day later the budget is back.
    await db.pool.query(`update loyalty.wallet_notifications set created_at = created_at - interval '25 hours'`);
    await setStamps(card.id, 12);
    events.onCardChanged(card.id, 'stamp');
    await events.flushCardEvents();
    expect(google.patches().at(-1)!.body).toMatchObject({ notifyPreference: 'NOTIFY_ON_UPDATE' });
  });

  it('keeps the message list short: old messages are pruned to the last few before adding', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard({ stamps: 3 });
    await insertPass(card, { stamps: 3, level: 'bronce' });
    for (let i = 0; i < 5; i++) {
      await db.pool.query(
        `insert into loyalty.wallet_notifications (card_id, provider, kind, notified, message, created_at)
         values ($1, 'google', 'gift', false, $2::jsonb, now() - interval '3 days')`,
        [card.id, JSON.stringify({ id: `gift-old-${i}`, header: `h${i}`, body: 'b', messageType: 'TEXT_AND_NOTIFY' })],
      );
    }
    await setStamps(card.id, 5);
    events.onCardChanged(card.id, 'gift', 2);
    await events.flushCardEvents();
    const prune = google.calls.find((c) => c.method === 'PATCH' && 'messages' in (c.body as object))!;
    expect((prune.body as { messages: Array<{ id: string; messageType: string }> }).messages).toEqual([
      expect.objectContaining({ id: 'gift-old-1', messageType: 'TEXT' }),
      expect.objectContaining({ id: 'gift-old-2', messageType: 'TEXT' }),
      expect.objectContaining({ id: 'gift-old-3', messageType: 'TEXT' }),
      expect.objectContaining({ id: 'gift-old-4', messageType: 'TEXT' }),
    ]);
    expect(google.messages()).toHaveLength(1);
  });

  it('a failed delivery does not spend the budget', async () => {
    const google = fakeGoogle((req) => (req.path.endsWith('/addMessage') ? 500 : 200));
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard({ stamps: 10 });
    await insertPass(card, { stamps: 9, level: 'bronce' });
    events.onCardChanged(card.id, 'stamp');
    await events.flushCardEvents();
    expect(logged).toHaveLength(1);
    expect(await notifications(card.id)).toEqual([]);
  });

  it('POST /cards/gift-stamps sends the gift message', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    const card = await insertCard({ stamps: 2 });
    await insertPass(card, { stamps: 2, level: 'bronce' });
    const session = new Session();
    session.captureFromResponse(
      await rig.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'owner@example.com', password: 'hunter2bravo' },
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await rig.app.inject({
      method: 'POST',
      url: '/cards/gift-stamps',
      payload: { cardIds: [card.id], stamps: 1 },
      headers: { 'content-type': 'application/json', cookie: session.cookieJarHeader() ?? '' },
    });
    expect(res.statusCode).toBe(200);
    await events.flushCardEvents();
    expect(google.messages()).toEqual([
      expect.objectContaining({ header: '🎁 Golden Beauty te regaló 1 sello', body: 'Te esperamos pronto 💛', messageType: 'TEXT_AND_NOTIFY' }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Weekly game scheduler
// ---------------------------------------------------------------------------

describe('weekly game scheduler', () => {
  // Monday 2026-11-02, Bogota (UTC-5).
  const at = (iso: string) => new Date(iso);
  const MONDAY_10 = at('2026-11-02T15:00:00Z');

  it('window: Mondays 10:00–20:00 Bogota only', () => {
    expect(scheduler.weeklyGameWindow(at('2026-11-02T14:59:00Z'))).toBeNull(); // 09:59
    expect(scheduler.weeklyGameWindow(MONDAY_10)).toBe('2026-W45');
    expect(scheduler.weeklyGameWindow(at('2026-11-03T00:59:00Z'))).toBe('2026-W45'); // 19:59
    expect(scheduler.weeklyGameWindow(at('2026-11-03T01:00:00Z'))).toBeNull(); // 20:00
    // Monday in UTC but still Sunday in Bogota.
    expect(scheduler.weeklyGameWindow(at('2026-11-02T04:00:00Z'))).toBeNull();
    expect(scheduler.weeklyGameWindow(at('2026-11-03T15:00:00Z'))).toBeNull(); // Tuesday
  });

  it('messages only passes whose card can play, once per week even when run twice', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    await db.pool.query(`update loyalty.campaigns set game_enabled = true where id = $1`, [campaignId]);
    const visit = MONDAY_10.getTime() - 3 * DAY;

    const eligible = await insertCard({ stamps: 3 });
    await addTx(eligible.id, 'stamp_add', visit);
    await insertPass(eligible, { stamps: 3, level: 'bronce' });

    const holdout = await insertCard({ stamps: 3, uniqueId: uniqueIdFor(true) });
    await addTx(holdout.id, 'stamp_add', visit);
    await insertPass(holdout, { stamps: 3 });

    const noVisit = await insertCard({ stamps: 3 });
    await insertPass(noVisit, { stamps: 3 });

    const played = await insertCard({ stamps: 3 });
    await addTx(played.id, 'stamp_add', visit);
    await insertPass(played, { stamps: 3 });
    await db.pool.query(
      `insert into loyalty.card_plays (card_id, owner_id, period_key, played_at, won) values ($1, $2, '2026-W45', $3, false)`,
      [played.id, owner.userId, MONDAY_10],
    );

    const first = await scheduler.runWeeklyGameReminders(MONDAY_10);
    expect(first).toMatchObject({ periodKey: '2026-W45', sent: 1, failed: 0 });
    expect(google.messages()).toEqual([
      expect.objectContaining({
        header: '🎟️ Tu raspa y gana de la semana está listo',
        body: 'Ábrelo en tu tarjeta',
        messageType: 'TEXT_AND_NOTIFY',
        // Shown until the week is over.
        displayInterval: { end: { date: '2026-11-09T05:00:00.000Z' } },
      }),
    ]);
    expect(google.calls.at(-1)!.path).toBe(`/loyaltyObject/${encodeURIComponent(eligible.objectId)}/addMessage`);

    // Later ticks, a restart, a second instance: nothing more.
    expect(await scheduler.runWeeklyGameReminders(at('2026-11-02T15:01:00Z'))).toBeNull();
    await db.pool.query('truncate loyalty.wallet_job_runs'); // even a lost run record
    const again = await scheduler.runWeeklyGameReminders(at('2026-11-02T16:00:00Z'));
    expect(again).toMatchObject({ sent: 0 });
    expect(google.messages()).toHaveLength(1);
    expect(await notifications(eligible.id)).toEqual([{ kind: 'weekly_game', notified: true, dedupe_key: 'weekly_game:2026-W45' }]);

    // Outside the window: nothing at all.
    await db.pool.query('truncate loyalty.wallet_job_runs');
    expect(await scheduler.runWeeklyGameReminders(at('2026-11-03T15:00:00Z'))).toBeNull();
  });

  it('two instances at once send once', async () => {
    const google = fakeGoogle();
    wallet.setGoogleWalletOverrides({ config, http: google.http });
    await db.pool.query(`update loyalty.campaigns set game_enabled = true where id = $1`, [campaignId]);
    const card = await insertCard({ stamps: 3 });
    await addTx(card.id, 'stamp_add', MONDAY_10.getTime() - DAY);
    await insertPass(card, { stamps: 3 });

    await Promise.all([scheduler.runWeeklyGameReminders(MONDAY_10), scheduler.runWeeklyGameReminders(MONDAY_10)]);
    expect(google.messages()).toHaveLength(1);
  });

  it('does nothing when no wallet is configured', async () => {
    wallet.setGoogleWalletOverrides({ config: null });
    expect(await scheduler.runWeeklyGameReminders(MONDAY_10)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Save / delete callbacks
// ---------------------------------------------------------------------------

describe('POST /wallet/google/callback', () => {
  const ec = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const b64spki = (key: KeyObject) => key.export({ type: 'spki', format: 'der' }).toString('base64');
  const root = ec();
  const intermediate = ec();
  const keysJson = { keys: [{ keyValue: b64spki(root.publicKey), protocolVersion: 'ECv2SigningOnly' }] };

  const envelope = (msg: Record<string, unknown>, opts: { signer?: KeyObject; recipient?: string } = {}) => {
    const signedKey = JSON.stringify({ keyValue: b64spki(intermediate.publicKey), keyExpiration: String(Date.now() + DAY) });
    const keySig = sign(
      'sha256',
      callback.lengthPrefixed('GooglePayPasses', 'ECv2SigningOnly', signedKey),
      { key: root.privateKey, dsaEncoding: 'der' },
    ).toString('base64');
    const signedMessage = JSON.stringify(msg);
    const signature = sign(
      'sha256',
      callback.lengthPrefixed('GooglePayPasses', opts.recipient ?? ISSUER, 'ECv2SigningOnly', signedMessage),
      { key: opts.signer ?? intermediate.privateKey, dsaEncoding: 'der' },
    ).toString('base64');
    return { signature, intermediateSigningKey: { signedKey, signatures: [keySig] }, protocolVersion: 'ECv2SigningOnly', signedMessage };
  };

  const post = (payload: unknown) =>
    rig.app.inject({ method: 'POST', url: '/wallet/google/callback', payload: payload as object, headers: { 'content-type': 'application/json' } });

  const message = (objectId: string, eventType: 'save' | 'del', nonce = randomUUID()) => ({
    classId: `${ISSUER}.stampee_${campaignId}`,
    objectId,
    expTimeMillis: Date.now() + 60_000,
    eventType,
    nonce,
  });

  const passEvents = async () =>
    (await db.pool.query(`select card_id, provider, event from loyalty.wallet_pass_events order by id`)).rows;

  beforeEach(() => {
    callback.resetCallbackKeysCache();
    wallet.setGoogleWalletOverrides({ config, http: fakeGoogle().http, callbackKeys: async () => keysJson });
  });

  it('records verified save / delete events once per nonce', async () => {
    const card = await insertCard();
    await insertPass(card);

    const save = message(card.objectId, 'save', 'nonce-1');
    expect((await post(envelope(save))).statusCode).toBe(200);
    expect((await post(envelope(save))).statusCode).toBe(200); // retry: same nonce
    expect((await post(envelope(message(card.objectId, 'del')))).statusCode).toBe(200);
    expect(await passEvents()).toEqual([
      { card_id: card.id, provider: 'google', event: 'save' },
      { card_id: card.id, provider: 'google', event: 'delete' },
    ]);
  });

  it('rejects unknown objects, other issuers, forged or expired messages', async () => {
    const card = await insertCard();
    await insertPass(card);
    const stranger = await insertCard(); // no wallet pass

    expect((await post(envelope(message(stranger.objectId, 'save')))).statusCode).toBe(404);
    expect((await post(envelope({ ...message(card.objectId, 'save'), objectId: `999.stampee_${card.uniqueId}` }))).statusCode).toBe(404);
    expect((await post(envelope(message(card.objectId, 'save'), { signer: ec().privateKey }))).statusCode).toBe(401);
    expect((await post(envelope(message(card.objectId, 'save'), { recipient: '1234' }))).statusCode).toBe(401);
    expect((await post(envelope({ ...message(card.objectId, 'save'), expTimeMillis: Date.now() - 1 }))).statusCode).toBe(401);
    const tampered = envelope(message(card.objectId, 'save'));
    tampered.signedMessage = tampered.signedMessage.replace('"save"', '"del"');
    expect((await post(tampered)).statusCode).toBe(401);
    expect((await post({ hello: 'world' })).statusCode).toBe(401);
    expect(await passEvents()).toEqual([]);
  });

  it('404s when Google Wallet is off, 503 when Google keys are unreachable', async () => {
    const card = await insertCard();
    await insertPass(card);
    wallet.setGoogleWalletOverrides({ config: null });
    expect((await post(envelope(message(card.objectId, 'save')))).statusCode).toBe(404);

    callback.resetCallbackKeysCache();
    wallet.setGoogleWalletOverrides({
      config,
      callbackKeys: async () => {
        throw new Error('offline');
      },
    });
    expect((await post(envelope(message(card.objectId, 'save')))).statusCode).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Hero image route
// ---------------------------------------------------------------------------

describe('GET /public/brand/:slug/hero.jpg', () => {
  it('serves the campaign background cropped to 1032×336 JPEG', async () => {
    await setSocial(null, BG_PATH);
    const bg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#c08040' } }).jpeg().toBuffer();
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`https://fake-bucket.test/${BG_PATH}?signed=1`);
      return new Response(new Uint8Array(bg), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    for (const url of [`/public/brand/${owner.slug}/hero.jpg?c=${campaignId}&v=abc`, `/public/brand/${owner.slug}/hero.jpg`]) {
      const res = await rig.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
      const meta = await sharp(res.rawPayload).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1032, 336]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('404s without a background image, for other owners campaigns and unknown slugs', async () => {
    const res = await rig.app.inject({ method: 'GET', url: `/public/brand/${owner.slug}/hero.jpg?c=${campaignId}` });
    expect(res.statusCode).toBe(404);
    await insertOwner(db.pool, { email: 'o@example.com', password: 'hunter2bravo', businessName: 'Otro', slug: 'otro' });
    await setSocial(null, BG_PATH);
    expect((await rig.app.inject({ method: 'GET', url: `/public/brand/otro/hero.jpg?c=${campaignId}` })).statusCode).toBe(404);
    expect((await rig.app.inject({ method: 'GET', url: `/public/brand/nobody/hero.jpg` })).statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe('analytics: passes in Wallet', () => {
  it('current passes by provider, adds/removals in range', async () => {
    const a = await insertCard();
    const b = await insertCard();
    const c = await insertCard();
    const ev = (cardId: string, provider: string, event: string, at: string) =>
      db.pool.query(`insert into loyalty.wallet_pass_events (card_id, provider, event, at) values ($1, $2, $3, $4)`, [
        cardId,
        provider,
        event,
        at,
      ]);
    await ev(a.id, 'google', 'save', '2026-08-20T15:00:00Z'); // before range, still saved
    await ev(b.id, 'google', 'save', '2026-09-05T15:00:00Z');
    await ev(b.id, 'google', 'delete', '2026-09-06T15:00:00Z');
    await ev(c.id, 'google', 'save', '2026-09-10T15:00:00Z');
    await ev(c.id, 'apple', 'save', '2026-09-10T15:00:00Z');
    await db.pool.query(
      `insert into loyalty.wallet_devices (device_library_id, push_token, pass_type_id, serial) values ('d1', 'ff', 'pass.x', $1)`,
      [c.uniqueId],
    );

    const session = new Session();
    session.captureFromResponse(
      await rig.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'owner@example.com', password: 'hunter2bravo' },
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await rig.app.inject({
      method: 'GET',
      url: '/analytics/engagement?from=2026-09-01&to=2026-09-30',
      headers: { cookie: session.cookieJarHeader() ?? '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.walletPasses).toEqual({
      google: { current: 2, added: 2, removed: 1 },
      apple: { current: 1, added: 1, removed: 0 },
    });
  });
});
