import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, Session, type TestRig } from './helpers/app.js';

type GiftLib = typeof import('../src/lib/giftCards.js');
type Kdb = typeof import('../src/db/kysely.js')['db'];

let db: TestDb;
let rig: TestRig;
let lib: GiftLib;
let kdb: Kdb;
let owner: { userId: string; slug: string };
let key: string;
let ownerSession: Session;
let detalle: string;
let consentida: string;

const json = { 'content-type': 'application/json' };
const auth = () => ({ authorization: `Bearer ${key}` });

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
  lib = await import('../src/lib/giftCards.js');
  kdb = (await import('../src/db/kysely.js')).db;
}, 120_000);

afterAll(async () => {
  await rig?.close();
  await db?.stop();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = auth()) =>
  rig.app.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers: { ...json, ...headers } });
const get = (url: string, headers: Record<string, string> = auth()) => rig.app.inject({ method: 'GET', url, headers });

const order = async (overrides: Record<string, unknown> = {}) => {
  const res = await post('/gift-cards', {
    tierId: detalle,
    buyer: { name: 'Ana María Ruiz', phone: '+57 300 111 2233' },
    message: 'Feliz Navidad',
    ...overrides,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data;
};

const activate = (id: string, payload: Record<string, unknown> = {}) =>
  post(`/gift-cards/${id}/activate`, { method: 'transferencia', paidAmountCop: 50000, paidAt: '2026-11-10', paidRef: 'bono:x', ...payload });

const redeem = (code: string, payload: Record<string, unknown> = {}) =>
  post(`/gift-cards/by-code/${code}/redeem`, { externalRef: 'ea-appt:1', amountUsedCop: 50000, ...payload });

beforeEach(async () => {
  await db.reset();
  owner = await insertOwner(db.pool, { email: 'owner@example.com', password: 'hunter2bravo', businessName: 'Golden', slug: 'golden' });
  ownerSession = new Session();
  ownerSession.captureFromResponse(
    await rig.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@example.com', password: 'hunter2bravo' }, headers: json }),
  );
  const minted = await rig.app.inject({
    method: 'POST',
    url: '/api-keys',
    payload: { name: 'Panel' },
    headers: { ...json, cookie: ownerSession.cookieJarHeader() ?? '' },
  });
  key = minted.json().data.key;
  detalle = (await post('/gift-card-tiers', { name: 'Detalle', amountCop: 50000, sort: 1 })).json().data.id;
  consentida = (await post('/gift-card-tiers', { name: 'Consentida', amountCop: 100000, sort: 2, validityDays: 30 })).json().data.id;
});

describe('gift card tiers', () => {
  it('lists, filters enabled and soft-deletes', async () => {
    await rig.app.inject({ method: 'DELETE', url: `/gift-card-tiers/${consentida}`, headers: auth() });
    const all = (await get('/gift-card-tiers')).json().data;
    expect(all.map((t: { name: string }) => t.name)).toEqual(['Detalle', 'Consentida']);
    expect(all[1].isEnabled).toBe(false);
    const enabled = (await get('/gift-card-tiers?enabled=1')).json().data;
    expect(enabled).toHaveLength(1);
    const pub = (await get('/public/gift-tiers/golden', {})).json().data;
    expect(pub).toEqual([{ id: detalle, name: 'Detalle', amountCop: 50000, description: '', validityDays: 365, design: null }]);
  });
});

describe('POST /gift-cards', () => {
  it('creates a pending sale order from the tier and upserts the buyer by phone', async () => {
    const existing = await insertCustomer(db.pool, owner.userId, { name: 'Ana', mobile: '3001112233' });
    const card = await order({ amountCop: 1, ref: 'adviento' });
    expect(card).toMatchObject({
      status: 'pending_payment',
      effectiveStatus: 'pending_payment',
      amountCop: 50000, // tier amount, the client's amountCop is ignored
      tierName: 'Detalle',
      funded: true,
      source: 'sale',
      buyerCustomerId: existing,
      buyerName: 'Ana María Ruiz',
      validFrom: null,
      validTo: null,
      rules: { ref: 'adviento' },
    });
    expect(card.code).toMatch(/^TR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(card.publicUrl).toBe(`http://localhost:3000/golden/regalo/${card.uniqueId}`);

    // A new phone creates a customer.
    const other = await order({ buyer: { name: 'Luisa', phone: '310 999 8877' } });
    const { rows } = await db.pool.query('select name, mobile from loyalty.customers where id = $1', [other.buyerCustomerId]);
    expect(rows[0]).toEqual({ name: 'Luisa', mobile: '310 999 8877' });
  });

  it('enforces tiers on sale orders', async () => {
    expect((await post('/gift-cards', { buyer: { name: 'A', phone: '3001112233' }, amountCop: 50000 })).json().error.code).toBe('TIER_REQUIRED');
    await rig.app.inject({ method: 'DELETE', url: `/gift-card-tiers/${detalle}`, headers: auth() });
    const res = await post('/gift-cards', { tierId: detalle, buyer: { name: 'A', phone: '3001112233' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TIER_UNAVAILABLE');
    expect((await post('/gift-cards', { tierId: 'nope', buyer: { name: 'A', phone: '3001112233' } })).json().error.code).toBe('TIER_UNAVAILABLE');
    expect((await post('/gift-cards', { tierId: consentida, funded: false, buyer: { name: 'A', phone: '3001112233' } })).statusCode).toBe(400);
  });

  it('manual cards: any amount, promotional ones are active at once', async () => {
    const card = await order({ tierId: undefined, source: 'manual', amountCop: 80000, funded: false });
    expect(card).toMatchObject({ status: 'active', funded: false, source: 'manual', amountCop: 80000, tierId: null });
    expect(card.validFrom).toBe(lib.bogotaDate());
    expect(card.validTo).toBe(lib.addDays(card.validFrom, 365));
  });

  it('rejects a phone with too few digits', async () => {
    const res = await post('/gift-cards', { tierId: detalle, buyer: { name: 'A', phone: 'abc-12-34-5' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('issueGiftCard (in-process)', () => {
  it('is idempotent on externalRef', async () => {
    const input = {
      ownerId: owner.userId,
      buyerCustomerId: null,
      amountCop: 30000,
      source: 'advent' as const,
      funded: false,
      externalRef: 'advent:2026:24:client-1',
      minTicketCop: 60000,
      rules: { recipient: 'new_or_dormant' as const },
      transferable: false,
    };
    const first = await lib.issueGiftCard(kdb, input);
    const second = await lib.issueGiftCard(kdb, { ...input, amountCop: 99999 });
    expect(second).toEqual(first);
    expect(first).toMatchObject({ amountCop: 30000, status: 'active', transferable: false });
    expect(first.publicUrl).toMatch(/\/golden\/regalo\/[0-9a-f-]{36}$/);
    const { rows } = await db.pool.query('select count(*)::int as n from loyalty.gift_cards');
    expect(rows[0].n).toBe(1);

    // Works inside a caller's transaction too.
    const inTrx = await kdb.transaction().execute((trx) => lib.issueGiftCard(trx, { ...input, externalRef: 'advent:2026:24:client-2' }));
    expect(inTrx.code).not.toBe(first.code);
  });

  it('defaults funded cards to pending_payment', async () => {
    const res = await lib.issueGiftCard(kdb, { ownerId: owner.userId, buyerCustomerId: null, amountCop: 50000, tierId: detalle, source: 'sale', funded: true });
    expect(res.status).toBe('pending_payment');
    expect(res.validTo).toBeNull();
  });

  it('normalizes typed codes', () => {
    expect(lib.normalizeGiftCode(' tr-ab1o-xyzl ')).toBe('TR-AB10-XYZ1');
    expect(lib.normalizeGiftCode('trab12cd34')).toBe('TR-AB12-CD34');
    expect(lib.normalizeGiftCode('gb-1234')).toBe('GB-1234');
  });
});

describe('activate', () => {
  it('pending → active with validity from the paid date (Bogota); idempotent on paidRef', async () => {
    const card = await order({ tierId: consentida });
    const res = await activate(card.id, { paidAt: '2026-11-10T03:00:00Z', paidAmountCop: 100000, paidRef: `bono:${card.code}` });
    expect(res.statusCode, res.body).toBe(200);
    // 03:00 UTC on the 10th is still the 9th in Bogota.
    expect(res.json().data).toMatchObject({ status: 'active', paidMethod: 'transferencia', paidAmountCop: 100000, validFrom: '2026-11-09', validTo: '2026-12-09' });

    const again = await activate(card.id, { paidAmountCop: 100000, paidRef: `bono:${card.code}` });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.validFrom).toBe('2026-11-09');

    const other = await activate(card.id, { paidRef: 'bono:other' });
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe('ALREADY_ACTIVE');
  });

  it('buyerStampOnPaid gifts one stamp to the buyer newest active card', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Club', totalStamps: 10 });
    const buyer = await insertCustomer(db.pool, owner.userId, { name: 'Ana', mobile: '3001112233' });
    const issued = await post('/cards', { customerId: buyer, campaignId });
    const cardId = issued.json().data.id;
    const gift = await order({ rules: { buyerStampOnPaid: true } });
    expect((await activate(gift.id)).statusCode).toBe(200);
    const { rows } = await db.pool.query(`select stamps from loyalty.issued_cards where id = $1`, [cardId]);
    expect(rows[0].stamps).toBe(1);
    const { rows: tx } = await db.pool.query(`select type, amount, remarks from loyalty.transactions where card_id = $1 and type = 'gift'`, [cardId]);
    expect(tx).toEqual([{ type: 'gift', amount: 1, remarks: `Tarjeta regalo ${gift.code}` }]);
    // Idempotent activation does not stamp again.
    await activate(gift.id);
    const { rows: after } = await db.pool.query(`select stamps from loyalty.issued_cards where id = $1`, [cardId]);
    expect(after[0].stamps).toBe(1);
  });
});

describe('redeem / unredeem', () => {
  const activeCard = async (overrides: Record<string, unknown> = {}) => {
    const card = await order(overrides);
    await activate(card.id, { paidAt: lib.bogotaDate() });
    return card;
  };

  it('rejects pending and voided cards', async () => {
    const pending = await order();
    const res = await redeem(pending.code);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_PAID');
    await post(`/gift-cards/${pending.id}/void`, { reason: 'Cliente desistió' });
    expect((await redeem(pending.code)).json().error.code).toBe('VOID');
  });

  it('redeems once, links the client, is idempotent on externalRef and 409s on another', async () => {
    const card = await activeCard();
    const res = await redeem(card.code.toLowerCase(), { amountUsedCop: 45000, customer: { name: 'Laura Gómez', phone: '+57 301 555 6677' } });
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ status: 'redeemed', redeemedRef: 'ea-appt:1', redeemedAmountCop: 45000, recipientName: 'Laura Gómez', alreadyRedeemed: false });
    expect(data.recipientCustomerId).toBeTruthy();

    const again = await redeem(card.code, { amountUsedCop: 45000 });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.alreadyRedeemed).toBe(true);

    const other = await redeem(card.code, { externalRef: 'ea-appt:2' });
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe('ALREADY_REDEEMED');

    // Can't void a redeemed card.
    expect((await post(`/gift-cards/${card.id}/void`, { reason: 'x' })).statusCode).toBe(409);
  });

  it('unredeem only with the matching ref; retry is a no-op', async () => {
    const card = await activeCard();
    await redeem(card.code);
    const wrong = await post(`/gift-cards/by-code/${card.code}/unredeem`, { externalRef: 'ea-appt:9' });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error.code).toBe('REF_MISMATCH');
    const ok = await post(`/gift-cards/by-code/${card.code}/unredeem`, { externalRef: 'ea-appt:1' });
    expect(ok.json().data).toMatchObject({ status: 'active', redeemedRef: null, redeemedAt: null });
    expect((await post(`/gift-cards/by-code/${card.code}/unredeem`, { externalRef: 'ea-appt:1' })).statusCode).toBe(200);
    // And it can be redeemed again (another visit).
    expect((await redeem(card.code, { externalRef: 'ea-appt:2' })).json().data.status).toBe('redeemed');
  });

  it('checks the validity window and rejects amounts above the card', async () => {
    const card = await activeCard();
    expect((await redeem(card.code, { amountUsedCop: 60000 })).statusCode).toBe(400);
    const early = await redeem(card.code, { date: '2020-01-01' });
    expect(early.json().error.code).toBe('NOT_YET_VALID');
    const late = await redeem(card.code, { date: lib.addDays(lib.bogotaDate(), 400) });
    expect(late.json().error.code).toBe('EXPIRED');
  });

  it('giverStampOnRedeem: stamps the buyer once, never completing their card', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Club', totalStamps: 10 });
    const buyer = await insertCustomer(db.pool, owner.userId, { name: 'Ana', mobile: '3001112233' });
    const loyalty = (await post('/cards', { customerId: buyer, campaignId })).json().data.id;
    await db.pool.query(`update loyalty.issued_cards set stamps = 8 where id = $1`, [loyalty]);

    const card = await activeCard({ rules: { giverStampOnRedeem: true } });
    await redeem(card.code);
    const stamps = async () => (await db.pool.query(`select stamps from loyalty.issued_cards where id = $1`, [loyalty])).rows[0].stamps;
    expect(await stamps()).toBe(9);

    // unredeem + redeem again: no second stamp.
    await post(`/gift-cards/by-code/${card.code}/unredeem`, { externalRef: 'ea-appt:1' });
    await redeem(card.code, { externalRef: 'ea-appt:2' });
    expect(await stamps()).toBe(9);

    // Card at total-1: guard says NEARLY_FULL, nothing added.
    const second = await activeCard({ rules: { giverStampOnRedeem: true } });
    await redeem(second.code, { externalRef: 'ea-appt:3' });
    expect(await stamps()).toBe(9);
    const detail = (await get(`/gift-cards/${second.id}`)).json().data;
    const redeemed = detail.events.find((e: { type: string }) => e.type === 'redeemed');
    expect(redeemed.data.giverStamp).toMatchObject({ added: 0, reason: 'NEARLY_FULL' });
  });
});

describe('expiry derivation', () => {
  it('active past valid_to is "expired" in DTOs, filters and stats', async () => {
    const card = await order();
    await activate(card.id, { paidAt: '2024-01-01' });
    // Paid 2024-01-01 + 365 days → long gone.
    const dto = (await get(`/gift-cards/${card.id}`)).json().data;
    expect(dto).toMatchObject({ status: 'active', effectiveStatus: 'expired', validTo: '2024-12-31' });

    const fresh = await order();
    await activate(fresh.id, { paidAt: lib.bogotaDate() });

    const expired = (await get('/gift-cards?status=expired')).json().data;
    expect(expired.map((c: { id: string }) => c.id)).toEqual([card.id]);
    const active = await get('/gift-cards?status=active');
    expect(active.json().data.map((c: { id: string }) => c.id)).toEqual([fresh.id]);
    expect(active.headers['x-total-count']).toBe('1');

    const stats = (await get('/gift-cards/stats')).json().data;
    expect(stats.expired).toEqual({ count: 1, amountCop: 50000 });
    expect(stats.active).toEqual({ count: 1, amountCop: 50000 });
    expect(stats.sold).toEqual({ count: 2, amountCop: 100000 });
    expect(stats.outstandingLiabilityCop).toBe(50000);
    expect(stats.last30d).toHaveLength(30);
    expect(stats.last30d.at(-1)).toEqual({ date: lib.bogotaDate(), count: 1, amountCop: 50000 });

    // Expired cards can't be redeemed, nor named publicly.
    expect((await redeem(card.code)).json().error.code).toBe('EXPIRED');
    expect(lib.effectiveStatus({ status: 'active', valid_to: '2026-01-01' }, '2026-01-01')).toBe('active');
    expect(lib.effectiveStatus({ status: 'active', valid_to: '2026-01-01' }, '2026-01-02')).toBe('expired');
    expect(lib.effectiveStatus({ status: 'redeemed', valid_to: '2020-01-01' }, '2026-01-02')).toBe('redeemed');
  });
});

describe('public gift page', () => {
  it('shows the card without phones and logs a throttled view', async () => {
    const card = await order({ recipientName: null });
    const res = await get(`/public/gift/golden/${card.uniqueId}`, {});
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({
      code: card.code,
      amountCop: 50000,
      tierName: 'Detalle',
      effectiveStatus: 'pending_payment',
      buyerFirstName: 'Ana',
      recipientName: null,
      message: 'Feliz Navidad',
      business: { name: 'Golden', slug: 'golden', logo: null },
    });
    expect(JSON.stringify(data)).not.toMatch(/1112233|phone/i);
    await get(`/public/gift/golden/${card.uniqueId}`, {});
    const { rows } = await db.pool.query(`select count(*)::int as n from loyalty.gift_card_events where type = 'viewed'`);
    expect(rows[0].n).toBe(1);
    expect((await get('/gift-cards/stats')).json().data.viewsWithoutRecipient).toBe(1);

    expect((await get(`/public/gift/other/${card.uniqueId}`, {})).statusCode).toBe(404);
    expect((await get(`/public/gift/golden/not-a-uuid`, {})).statusCode).toBe(404);
  });

  it('lets the link holder name the recipient once', async () => {
    const card = await order();
    const url = `/public/gift/golden/${card.uniqueId}/recipient`;
    expect((await post(url, { name: ' A ' }, {})).statusCode).toBe(400);
    const res = await post(url, { name: '  Valentina  ' }, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.recipientName).toBe('Valentina');
    const again = await post(url, { name: 'Otra' }, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('RECIPIENT_ALREADY_SET');

    // Admins can still change it.
    const patched = await rig.app.inject({ method: 'PATCH', url: `/gift-cards/${card.id}`, payload: { recipientName: 'Vale' }, headers: { ...json, ...auth() } });
    expect(patched.json().data.recipientName).toBe('Vale');

    // Not on a voided card.
    const voided = await order();
    await post(`/gift-cards/${voided.id}/void`, { reason: 'x' });
    const r2 = await post(`/public/gift/golden/${voided.uniqueId}/recipient`, { name: 'Valentina' }, {});
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe('NOT_EDITABLE');
  });
});

describe('scope', () => {
  it('owner B cannot see owner A cards; anonymous gets 401', async () => {
    const card = await order();
    await insertOwner(db.pool, { email: 'b@example.com', password: 'hunter2bravo', businessName: 'B', slug: 'b' });
    const s = new Session();
    s.captureFromResponse(await rig.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'b@example.com', password: 'hunter2bravo' }, headers: json }));
    const cookie = { cookie: s.cookieJarHeader() ?? '' };
    expect((await get(`/gift-cards/${card.id}`, cookie)).statusCode).toBe(404);
    expect((await get(`/gift-cards/by-code/${card.code}`, cookie)).statusCode).toBe(404);
    expect((await get('/gift-cards', cookie)).json().data).toEqual([]);
    expect((await get('/gift-cards', {})).statusCode).toBe(401);
    // The owner's own cookie session works too.
    expect((await get(`/gift-cards/by-code/${card.code}`, { cookie: ownerSession.cookieJarHeader() ?? '' })).json().data.id).toBe(card.id);
  });

  it('list search matches code, names and phone digits', async () => {
    const a = await order();
    await order({ buyer: { name: 'Luisa Pérez', phone: '3109998877' }, recipientName: 'Camila' });
    const ids = async (q: string) => (await get(`/gift-cards?q=${encodeURIComponent(q)}`)).json().data.map((c: { id: string }) => c.id);
    expect(await ids(a.code.slice(3, 7).toLowerCase())).toContain(a.id);
    expect(await ids('camila')).toHaveLength(1);
    expect(await ids('111 2233')).toEqual([a.id]);
  });
});
