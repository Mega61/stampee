// Advent calendar (0020, lib/advent.ts, routes/advent.ts). Time comes from
// lib/clock.ts, so each test stands on the day it needs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, Session, type TestRig } from './helpers/app.js';

let db: TestDb;
let rig: TestRig;
let clock: { now: () => Date };
let owner: { userId: string; slug: string };
let session: Session;
let campaignId: string;

const json = { 'content-type': 'application/json' };
const authed = () => ({ ...json, cookie: session.cookieJarHeader() ?? '' });
const at = (isoLocal: string) => new Date(`${isoLocal}-05:00`);
const setNow = (isoLocal: string) => {
  const d = at(isoLocal);
  clock.now = () => d;
};

const CAL = {
  enabled: true,
  opensUntil: '2026-12-31T23:59:59-05:00',
  commonTerms: ['Un descuento por visita.'],
  doors: [
    { doorNo: 1, dayLabel: 2, unlockAt: '2026-12-02T07:00:00-05:00', kind: 'coupon', title: 'Secreto uno', terms: ['Regla uno'], validFrom: '2026-12-02', validTo: '2027-01-31' },
    { doorNo: 2, dayLabel: 4, unlockAt: '2026-12-04T07:00:00-05:00', kind: 'bonus_stamps', title: 'Secreto sello', stamps: 1 },
    { doorNo: 3, dayLabel: 8, unlockAt: '2026-12-08T07:00:00-05:00', kind: 'coupon', title: 'Secreto enero', validFrom: '2027-01-02', validTo: '2027-01-31' },
    { doorNo: 4, dayLabel: 14, unlockAt: '2026-12-14T07:00:00-05:00', flashUntil: '2026-12-16T07:00:00-05:00', kind: 'coupon', title: 'Secreto flash', validFrom: '2027-01-02', validTo: '2027-01-31' },
    { doorNo: 5, dayLabel: 20, unlockAt: '2026-12-20T07:00:00-05:00', kind: 'link', title: 'Secreto link', url: 'https://example.com/regalar?ref=adviento' },
    { doorNo: 6, dayLabel: 22, unlockAt: '2026-12-22T07:00:00-05:00', kind: 'double_stamps', title: 'Secreto doble', validFrom: '2027-01-01', validTo: '2027-01-31' },
    {
      doorNo: 7, dayLabel: 24, unlockAt: '2026-12-24T07:00:00-05:00', kind: 'gift_card', title: 'Secreto gift card',
      validFrom: '2027-01-15', validTo: '2027-02-15',
      config: {
        tiers: [
          { when: 'default', amountCop: 20000, minTicketCop: 100000 },
          { when: 'visit_between', from: '2026-12-01', to: '2026-12-23', amountCop: 30000, minTicketCop: 100000 },
        ],
        transferable: true,
        rules: { recipient: 'new_or_dormant', giverStampOnRedeem: true },
      },
    },
  ],
};

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
  clock = (await import('../src/lib/clock.js')).clock;
}, 120_000);

afterAll(async () => {
  await rig?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.reset();
  clock.now = () => new Date();
  owner = await insertOwner(db.pool, { email: 'owner@example.com', password: 'hunter2bravo', businessName: 'Golden', slug: 'golden' });
  session = new Session();
  session.captureFromResponse(
    await rig.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@example.com', password: 'hunter2bravo' }, headers: json }),
  );
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Sellos', totalStamps: 8 });
});

const seed = async (body: unknown = CAL) => {
  const res = await rig.app.inject({ method: 'PUT', url: '/advent/calendars/2026', payload: body as object, headers: authed() });
  expect(res.statusCode).toBe(200);
};

/** A customer with a card; `visits` = stamp_add timestamps (Bogota local) */
const customerWithCard = async (name: string, visits: string[] = ['2026-11-10T15:00:00']) => {
  const customerId = await insertCustomer(db.pool, owner.userId, { name, mobile: `300${Math.floor(Math.random() * 1e7)}` });
  const res = await rig.app.inject({ method: 'POST', url: '/cards', payload: { customerId, campaignId }, headers: authed() });
  const card = res.json().data as { id: string; uniqueId: string; customerPublicId: string };
  for (const v of visits) {
    await db.pool.query(
      `insert into loyalty.transactions (id, card_id, type, amount, date, timestamp, title) values ($1, $2, 'stamp_add', 1, $3, $4, 'Visita')`,
      [randomUUID(), card.id, v.slice(0, 10), at(v).getTime()],
    );
  }
  if (visits.length) await db.pool.query('update loyalty.issued_cards set stamps = $2 where id = $1', [card.id, visits.length]);
  return { customerId, ...card };
};

const getState = (id: string) => rig.app.inject({ method: 'GET', url: `/public/cards/golden/${id}/advent` });
// A fresh address per call: the public open route is rate limited per IP.
let ip = 0;
const open = (id: string, no: number) =>
  rig.app.inject({ method: 'POST', url: `/public/cards/golden/${id}/advent/doors/${no}/open`, remoteAddress: `10.0.${Math.floor(++ip / 250)}.${ip % 250}` });
const redeem = (code: string) =>
  rig.app.inject({ method: 'POST', url: `/advent/rewards/${code}/redeem`, payload: { actorName: 'Recepción' }, headers: authed() });

describe('advent: public state', () => {
  it('is ADVENT_OFF until a calendar is loaded and enabled', async () => {
    const c = await customerWithCard('Ana');
    const res = await getState(c.customerPublicId);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADVENT_OFF');
  });

  it('opens doors at 07:00 Bogota and never leaks what a closed door gives', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-02T06:59:00');
    let res = await getState(c.uniqueId);
    expect(res.statusCode).toBe(200);
    const before = res.json().data;
    expect(before.doors[0].state).toBe('locked');
    expect(before.nextUnlockAt).toBe(at('2026-12-02T07:00:00').toISOString());
    expect(before.readyCount).toBe(0);
    expect(res.body).not.toContain('Secreto');
    expect((await open(c.uniqueId, 1)).json().error.code).toBe('NOT_YET');

    setNow('2026-12-02T07:00:00');
    res = await getState(c.customerPublicId);
    expect(res.json().data.doors[0].state).toBe('ready');
    expect(res.json().data.readyCount).toBe(1);
    expect(res.body).not.toContain('Secreto');
  });

  it('opening is idempotent: a replay returns the same gift and code', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-03T10:00:00');
    const first = await open(c.customerPublicId, 1);
    expect(first.statusCode).toBe(200);
    const reward = first.json().data.reward;
    expect(reward).toMatchObject({ kind: 'coupon', title: 'Secreto uno', terms: ['Regla uno'], status: 'available' });
    expect(reward.code).toMatch(/^GB-[2-9A-Z]{4}$/);
    const again = await open(c.uniqueId, 1);
    expect(again.json().data.reward.id).toBe(reward.id);
    expect(again.json().data.reward.code).toBe(reward.code);
    const state = first.json().data.state;
    expect(state.doors[0].state).toBe('opened');
    expect(state.rewards).toHaveLength(1);
    expect(state.commonTerms).toEqual(['Un descuento por visita.']);
  });

  it('a customer without a visit sees the calendar locked and cannot open', async () => {
    await seed();
    const c = await customerWithCard('Nueva', []);
    setNow('2026-12-03T10:00:00');
    const state = (await getState(c.customerPublicId)).json().data;
    expect(state.eligible).toBe(false);
    expect(state.readyCount).toBe(0);
    const res = await open(c.customerPublicId, 1);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_ELIGIBLE');
  });

  it('a flash door closes after its 48 hours', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-16T07:00:00');
    const res = await open(c.customerPublicId, 4);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CLOSED');
    expect((await getState(c.customerPublicId)).json().data.doors[3].state).toBe('missed');
    const other = await customerWithCard('Bea');
    setNow('2026-12-15T22:00:00');
    expect((await open(other.customerPublicId, 4)).statusCode).toBe(200);
  });

  it('doors can be opened late until opens_until; after that the back stays only while gifts are usable', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-30T10:00:00');
    expect((await open(c.customerPublicId, 1)).statusCode).toBe(200);
    setNow('2027-01-05T10:00:00');
    expect((await open(c.customerPublicId, 3)).json().error.code).toBe('CLOSED');
    expect((await getState(c.customerPublicId)).statusCode).toBe(200); // door 1's coupon is valid until Jan 31
    const none = await customerWithCard('Bea');
    expect((await getState(none.customerPublicId)).json().error.code).toBe('ADVENT_OFF');
  });
});

describe('advent: gifts', () => {
  it('a stamp gift lands on the card, but never completes it', async () => {
    await seed();
    const c = await customerWithCard('Ana', ['2026-11-01T15:00:00', '2026-11-08T15:00:00']);
    setNow('2026-12-04T08:00:00');
    const res = await open(c.customerPublicId, 2);
    expect(res.json().data.reward).toMatchObject({ kind: 'bonus_stamps', stamps: 1, status: 'redeemed' });
    expect(res.json().data.card).toEqual({ uniqueId: c.uniqueId, stamps: 3 });

    const full = await customerWithCard('Bea', Array.from({ length: 7 }, (_, i) => `2026-10-0${i + 1}T15:00:00`));
    const blocked = await open(full.customerPublicId, 2);
    expect(blocked.json().data.reward.stamps).toBe(0);
    expect(blocked.json().data.card).toBeNull();
  });

  it('the front desk redeems a coupon only inside its dates, once', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-09T10:00:00');
    const code = (await open(c.customerPublicId, 3)).json().data.reward.code as string;

    let res = await redeem(code);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_YET_VALID');

    setNow('2027-01-10T15:00:00');
    res = await redeem(code.toLowerCase().replace('-', ' '));
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ alreadyRedeemed: false, reward: { status: 'redeemed', customerName: 'Ana' } });
    expect((await redeem(code)).json().data.alreadyRedeemed).toBe(true);

    const list = await rig.app.inject({ method: 'GET', url: `/advent/rewards?customerId=${c.customerId}&status=all`, headers: authed() });
    expect(list.json().data.rewards[0]).toMatchObject({ code, redeemedBy: 'Recepción' });
    const avail = await rig.app.inject({ method: 'GET', url: '/advent/rewards', headers: authed() });
    expect(avail.json().data.rewards).toHaveLength(0);

    const undo = await rig.app.inject({ method: 'POST', url: `/advent/rewards/${code}/unredeem`, payload: { actorName: 'Recepción' }, headers: authed() });
    expect(undo.json().data.reward.status).toBe('available');

    setNow('2027-02-01T10:00:00');
    res = await redeem(code);
    expect(res.json().error.code).toBe('EXPIRED');
    expect((await getState(c.customerPublicId)).statusCode).toBe(404); // nothing usable left
  });

  it('non-coupon gifts are not redeemable at the front desk', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-21T10:00:00');
    const link = (await open(c.customerPublicId, 5)).json().data.reward;
    expect(link).toMatchObject({ kind: 'link', url: 'https://example.com/regalar?ref=adviento', code: null });
  });

  it('January double stamps: once per qualifying visit, inside the dates', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-22T09:00:00');
    expect((await open(c.customerPublicId, 6)).statusCode).toBe(200);

    const call = (visitRef: string, visitDate: string) =>
      rig.app.inject({ method: 'POST', url: '/advent/double-stamps', payload: { customerId: c.customerId, visitRef, visitDate }, headers: authed() });
    setNow('2027-01-11T06:00:00');
    let res = await call('booking-1', '2027-01-10');
    expect(res.json().data).toMatchObject({ added: 1, stamps: 2 });
    expect((await call('booking-1', '2027-01-10')).json().data).toMatchObject({ added: 0, reason: 'ALREADY_APPLIED' });
    expect((await call('booking-2', '2026-12-28')).json().data).toMatchObject({ added: 0, reason: 'OUT_OF_RANGE' });
    const { rows } = await db.pool.query("select title from loyalty.transactions where type = 'bonus'");
    expect(rows).toEqual([{ title: 'Sello doble de Adviento' }]);

    const other = await customerWithCard('Bea');
    res = await rig.app.inject({
      method: 'POST', url: '/advent/double-stamps', payload: { customerId: other.customerId, visitRef: 'b-1', visitDate: '2027-01-10' }, headers: authed(),
    });
    expect(res.json().data.reason).toBe('NO_REWARD');
  });

  it('the last door issues the gift card: $30.000 with a December visit, $20.000 without', async () => {
    await seed();
    const dec = await customerWithCard('Ana', ['2026-11-10T15:00:00', '2026-12-10T15:00:00']);
    const nov = await customerWithCard('Bea', ['2026-11-10T15:00:00']);
    setNow('2026-12-24T07:30:00');

    const a = (await open(dec.customerPublicId, 7)).json().data;
    expect(a.reward).toMatchObject({ kind: 'gift_card', code: null, validFrom: '2027-01-15', validTo: '2027-02-15' });
    const card = a.state.giftCards.find((g: { id: string }) => g.id === a.reward.giftCardId);
    expect(card).toMatchObject({ amountCop: 30000, role: 'buyer', locked: false, minTicketCop: 100000, source: 'advent', funded: false });
    expect(a.reward.terms).toEqual(card.terms);

    const b = (await open(nov.customerPublicId, 7)).json().data;
    expect(b.state.giftCards[0].amountCop).toBe(20000);

    // A replay never issues a second card.
    await open(dec.customerPublicId, 7);
    const { rows } = await db.pool.query('select count(*)::int n from loyalty.gift_cards');
    expect(rows[0].n).toBe(2);
  });
});

describe('advent: loading the door file', () => {
  it("can't change the kind of a door customers already opened", async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-03T10:00:00');
    await open(c.customerPublicId, 1);
    const changed = { ...CAL, doors: CAL.doors.map((d) => (d.doorNo === 1 ? { ...d, kind: 'link', url: 'https://example.com' } : d)) };
    const res = await rig.app.inject({ method: 'PUT', url: '/advent/calendars/2026', payload: changed, headers: authed() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DOOR_IN_USE');
    // Text edits are fine.
    await seed({ ...CAL, doors: CAL.doors.map((d) => (d.doorNo === 1 ? { ...d, title: 'Secreto uno (v2)' } : d)) });
    expect((await getState(c.customerPublicId)).json().data.rewards[0].title).toBe('Secreto uno (v2)');
  });

  it('summary counts opens and redemptions per door', async () => {
    await seed();
    const c = await customerWithCard('Ana');
    setNow('2026-12-03T10:00:00');
    const code = (await open(c.customerPublicId, 1)).json().data.reward.code;
    await redeem(code);
    const res = await rig.app.inject({ method: 'GET', url: '/advent/summary', headers: authed() });
    expect(res.json().data.eligibleCustomers).toBe(1);
    expect(res.json().data.doors[0]).toMatchObject({ dayLabel: 2, opened: 1, redeemed: 1 });
  });
});
