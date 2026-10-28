import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import {
  buildTestRig,
  insertCampaign,
  insertCustomer,
  insertOwner,
  Session,
  type TestRig,
} from './helpers/app.js';
import { cardBucket, GAME_HOLDOUT_BUCKET } from '../src/lib/holdout.js';
import { onCardChanged } from '../src/lib/cardEvents.js';

// Wallet sync hook: record calls instead of running it.
vi.mock('../src/lib/cardEvents.js', () => ({ onCardChanged: vi.fn() }));

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let campaignId: string;
let customerId: string;

const DAY = 24 * 60 * 60 * 1000;

// Every request gets its own client IP so the 10/min play limit only bites
// where a test means it to.
let ipCounter = 0;
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

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
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas', totalStamps: 10 });
  await setGame(campaignId, { enabled: true, winPct: 100, cap: 30 });
  customerId = await insertCustomer(db.pool, owner.userId, { name: 'Laura', email: 'laura@x.com' });
});

afterEach(() => {
  delete process.env.GAME_HOLDOUT;
  vi.mocked(onCardChanged).mockClear();
});

const setGame = (id: string, g: { enabled?: boolean; winPct?: number; cap?: number }) =>
  db.pool.query(
    `update loyalty.campaigns
        set game_enabled = coalesce($2, game_enabled),
            game_win_pct = coalesce($3, game_win_pct),
            game_monthly_cap = coalesce($4, game_monthly_cap)
      where id = $1`,
    [id, g.enabled ?? null, g.winPct ?? null, g.cap ?? null],
  );

/** A uniqueId inside (or outside) the game holdout bucket. */
const uniqueIdFor = (holdout: boolean) => {
  for (;;) {
    const id = randomUUID();
    if ((cardBucket(id) === GAME_HOLDOUT_BUCKET) === holdout) return id;
  }
};

const addTx = (cardId: string, type: string, timestamp: number, amount = 1) =>
  db.pool.query(
    `insert into loyalty.transactions (card_id, type, amount, date, "timestamp", title)
     values ($1, $2, $3, 'x', $4, 'x')`,
    [cardId, type, amount, timestamp],
  );

const makeCard = async (opts: {
  stamps?: number;
  status?: 'Active' | 'Redeemed';
  visitAt?: number | null; // stamp_add timestamp; null = never visited
  holdout?: boolean;
  campaign?: string | null;
  snapshotTotal?: number;
} = {}) => {
  const uniqueId = uniqueIdFor(opts.holdout ?? false);
  const snapshot = opts.snapshotTotal ? JSON.stringify({ totalStamps: opts.snapshotTotal }) : null;
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into loyalty.issued_cards
       (unique_id, customer_id, campaign_id, owner_id, campaign_name, stamps, status, last_visit, template_snapshot)
     values ($1, $2, $3, $4, 'Uñas', $5, $6, '2026-01-15', $7::jsonb)
     returning id`,
    [
      uniqueId,
      customerId,
      opts.campaign === undefined ? campaignId : opts.campaign,
      owner.userId,
      opts.stamps ?? 3,
      opts.status ?? 'Active',
      snapshot,
    ],
  );
  const id = rows[0]!.id;
  const visitAt = opts.visitAt === undefined ? Date.now() - 5 * DAY : opts.visitAt;
  if (visitAt !== null) await addTx(id, 'stamp_add', visitAt);
  return { id, uniqueId };
};

const getGame = (uniqueId: string, slug = owner.slug) =>
  rig.app.inject({ method: 'GET', url: `/public/cards/${slug}/${uniqueId}/game`, remoteAddress: nextIp() });

const play = (uniqueId: string, slug = owner.slug, remoteAddress = nextIp()) =>
  rig.app.inject({ method: 'POST', url: `/public/cards/${slug}/${uniqueId}/game/play`, remoteAddress });

const cardRow = async (id: string) =>
  (
    await db.pool.query<{ stamps: number; last_visit: Date }>(
      'select stamps, last_visit from loyalty.issued_cards where id = $1',
      [id],
    )
  ).rows[0]!;

const bonusTxs = async (cardId: string) =>
  (
    await db.pool.query(
      `select * from loyalty.transactions where card_id = $1 and type = 'bonus'`,
      [cardId],
    )
  ).rows;

describe('game: state', () => {
  it('an eligible card is available, with nextPlayAt on Monday 00:00 Bogota', async () => {
    const card = await makeCard();
    const res = await getGame(card.uniqueId);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.state).toBe('available');
    const next = new Date(data.nextPlayAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(7 * DAY);
    expect(next.getUTCDay()).toBe(1);
    expect(next.getUTCHours()).toBe(5);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('a card with no recent visit is locked (NO_RECENT_VISIT) and cannot play', async () => {
    const never = await makeCard({ visitAt: null });
    const old = await makeCard({ visitAt: Date.now() - 61 * DAY });
    for (const card of [never, old]) {
      const state = (await getGame(card.uniqueId)).json().data;
      expect(state).toMatchObject({ state: 'locked', reason: 'NO_RECENT_VISIT' });
      const res = await play(card.uniqueId);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({ code: 'GAME_UNAVAILABLE', reason: 'NO_RECENT_VISIT' });
    }
    const { rows } = await db.pool.query('select * from loyalty.card_plays');
    expect(rows).toHaveLength(0);
  });

  it('a redeemed card is locked (NOT_ACTIVE)', async () => {
    const card = await makeCard({ status: 'Redeemed' });
    expect((await getGame(card.uniqueId)).json().data).toMatchObject({ state: 'locked', reason: 'NOT_ACTIVE' });
    const res = await play(card.uniqueId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.reason).toBe('NOT_ACTIVE');
  });

  it('a disabled campaign (or no campaign) makes the game unavailable', async () => {
    await setGame(campaignId, { enabled: false });
    const card = await makeCard();
    expect((await getGame(card.uniqueId)).json().data.state).toBe('disabled');
    const res = await play(card.uniqueId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'GAME_UNAVAILABLE', reason: 'DISABLED' });

    const orphan = await makeCard({ campaign: null });
    expect((await getGame(orphan.uniqueId)).json().data.state).toBe('disabled');
    expect((await play(orphan.uniqueId)).json().error.reason).toBe('DISABLED');
  });

  it('holdout bucket cards see holdout and cannot play, unless GAME_HOLDOUT=off', async () => {
    const card = await makeCard({ holdout: true });
    expect((await getGame(card.uniqueId)).json().data.state).toBe('holdout');
    const res = await play(card.uniqueId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.reason).toBe('HOLDOUT');

    process.env.GAME_HOLDOUT = 'off';
    expect((await getGame(card.uniqueId)).json().data.state).toBe('available');
    expect((await play(card.uniqueId)).statusCode).toBe(200);
  });

  it('scope: a wrong slug (or another business) returns 404', async () => {
    const card = await makeCard();
    expect((await getGame(card.uniqueId, 'no-such-business')).statusCode).toBe(404);
    expect((await play(card.uniqueId, 'no-such-business')).statusCode).toBe(404);

    await insertOwner(db.pool, {
      email: 'other@example.com',
      password: 'hunter2bravo',
      businessName: 'Other',
      slug: 'other-biz',
    });
    expect((await getGame(card.uniqueId, 'other-biz')).statusCode).toBe(404);
    expect((await play(card.uniqueId, 'other-biz')).statusCode).toBe(404);
    expect((await play(randomUUID())).statusCode).toBe(404);
  });
});

describe('game: play', () => {
  it('a win adds one stamp and a bonus transaction, without touching last_visit', async () => {
    const card = await makeCard({ stamps: 3 });
    const before = await cardRow(card.id);
    const res = await play(card.uniqueId);
    expect(res.statusCode).toBe(200);
    const result = res.json().data;
    expect(result).toMatchObject({ won: true, stampsAwarded: 1, stamps: 4 });
    expect(result.periodKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(typeof result.nextPlayAt).toBe('string');

    const after = await cardRow(card.id);
    expect(after.stamps).toBe(4);
    expect(after.last_visit).toEqual(before.last_visit);

    const txs = await bonusTxs(card.id);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      type: 'bonus',
      amount: 1,
      title: 'Bonus Stamp',
      remarks: 'Raspa y gana',
      actor_id: null,
      actor_name: 'Raspa y gana',
      actor_role: 'system',
    });
    expect(txs[0].date).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  });

  it('win_pct 0 always loses and awards nothing', async () => {
    await setGame(campaignId, { winPct: 0 });
    const card = await makeCard({ stamps: 3 });
    const res = await play(card.uniqueId);
    expect(res.json().data).toMatchObject({ won: false, stampsAwarded: 0, stamps: 3 });
    expect(await bonusTxs(card.id)).toHaveLength(0);
    const state = (await getGame(card.uniqueId)).json().data;
    expect(state).toMatchObject({ state: 'played', lastResult: { won: false, stampsAwarded: 0 } });
  });

  it('a win returns the bonus transaction (camelCase DTO), and a replay returns the same one', async () => {
    const card = await makeCard({ stamps: 3 });
    const first = (await play(card.uniqueId)).json().data;
    expect(first.transaction).toMatchObject({
      type: 'bonus',
      amount: 1,
      title: 'Bonus Stamp',
      remarks: 'Raspa y gana',
      actorName: 'Raspa y gana',
      actorRole: 'system',
    });
    expect(typeof first.transaction.id).toBe('string');
    expect(typeof first.transaction.timestamp).toBe('number');
    const [tx] = await bonusTxs(card.id);
    expect(first.transaction.id).toBe(tx.id);

    const replay = (await play(card.uniqueId)).json().data;
    expect(replay.transaction).toEqual(first.transaction);

    // The public card's history carries the same id, so a refresh after the
    // optimistic update doesn't duplicate it.
    const pub = await rig.app.inject({ method: 'GET', url: `/public/cards/${owner.slug}/${card.uniqueId}`, remoteAddress: nextIp() });
    const ids = pub.json().data.card.history.filter((t: { type: string }) => t.type === 'bonus').map((t: { id: string }) => t.id);
    expect(ids).toEqual([first.transaction.id]);
  });

  it('a loss has no transaction', async () => {
    await setGame(campaignId, { winPct: 0 });
    const card = await makeCard({ stamps: 3 });
    expect((await play(card.uniqueId)).json().data.transaction).toBeUndefined();
    expect((await play(card.uniqueId)).json().data.transaction).toBeUndefined();
  });

  it('calls onCardChanged once after a new win, never for losses or replays', async () => {
    const card = await makeCard({ stamps: 3 });
    await play(card.uniqueId);
    expect(onCardChanged).toHaveBeenCalledTimes(1);
    expect(onCardChanged).toHaveBeenCalledWith(card.id);
    await play(card.uniqueId);
    expect(onCardChanged).toHaveBeenCalledTimes(1);

    await setGame(campaignId, { winPct: 0 });
    const loser = await makeCard({ stamps: 3 });
    await play(loser.uniqueId);
    expect(onCardChanged).toHaveBeenCalledTimes(1);
  });

  it('only one play per week: a second call returns the same result', async () => {
    const card = await makeCard({ stamps: 3 });
    const first = (await play(card.uniqueId)).json().data;
    // Even if the odds change in between, the stored result is returned.
    await setGame(campaignId, { winPct: 0 });
    const second = await play(card.uniqueId);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toEqual(first);
    expect((await cardRow(card.id)).stamps).toBe(4);
    expect(await bonusTxs(card.id)).toHaveLength(1);

    const state = (await getGame(card.uniqueId)).json().data;
    expect(state.state).toBe('played');
    expect(state.lastResult).toMatchObject({ won: true, stampsAwarded: 1 });
    expect(new Date(state.lastResult.playedAt).toString()).not.toBe('Invalid Date');
  });

  it('concurrent plays on one card produce a single play', async () => {
    const card = await makeCard({ stamps: 3 });
    const results = await Promise.all([1, 2, 3, 4].map(() => play(card.uniqueId)));
    for (const r of results) expect(r.statusCode).toBe(200);
    const bodies = results.map((r) => r.json().data);
    expect(new Set(bodies.map((b) => `${b.won}:${b.stampsAwarded}:${b.periodKey}`)).size).toBe(1);
    const { rows } = await db.pool.query('select * from loyalty.card_plays where card_id = $1', [card.id]);
    expect(rows).toHaveLength(1);
    expect((await cardRow(card.id)).stamps).toBe(4);
    expect(await bonusTxs(card.id)).toHaveLength(1);
  });

  it('a win never completes a card', async () => {
    const nearlyFull = await makeCard({ stamps: 9 }); // campaign total 10
    expect((await play(nearlyFull.uniqueId)).json().data).toMatchObject({ won: false, stamps: 9 });

    // The card's snapshot total wins over the campaign's.
    const snapshotCard = await makeCard({ stamps: 4, snapshotTotal: 5 });
    expect((await play(snapshotCard.uniqueId)).json().data).toMatchObject({ won: false, stamps: 4 });

    const roomy = await makeCard({ stamps: 8 });
    expect((await play(roomy.uniqueId)).json().data).toMatchObject({ won: true, stamps: 9 });
  });

  it('the monthly cap forces losses', async () => {
    await setGame(campaignId, { cap: 2 });
    const cards = await Promise.all([1, 2, 3].map(() => makeCard({ stamps: 1 })));
    const results = [];
    for (const c of cards) results.push((await play(c.uniqueId)).json().data);
    expect(results.map((r) => r.won)).toEqual([true, true, false]);

    // Cap 0 = the game runs but never awards.
    await setGame(campaignId, { cap: 0 });
    const another = await makeCard({ stamps: 1 });
    expect((await play(another.uniqueId)).json().data.won).toBe(false);
  });

  it('the cap is per business and per Bogota month', async () => {
    await setGame(campaignId, { cap: 1 });
    // A win last month doesn't count against this month.
    const old = await makeCard();
    await db.pool.query(
      `insert into loyalty.card_plays (card_id, owner_id, period_key, played_at, won, stamps_awarded)
       values ($1, $2, '2020-W01', now() - interval '40 days', true, 1)`,
      [old.id, owner.userId],
    );
    // Another business's wins don't count either.
    const other = await insertOwner(db.pool, {
      email: 'other@example.com',
      password: 'hunter2bravo',
      businessName: 'Other',
      slug: 'other-biz',
    });
    const otherCampaign = await insertCampaign(db.pool, other.userId, { name: 'X' });
    const otherCustomer = await insertCustomer(db.pool, other.userId, { name: 'Y' });
    const { rows } = await db.pool.query<{ id: string }>(
      `insert into loyalty.issued_cards (customer_id, campaign_id, owner_id, campaign_name)
       values ($1, $2, $3, 'X') returning id`,
      [otherCustomer, otherCampaign, other.userId],
    );
    await db.pool.query(
      `insert into loyalty.card_plays (card_id, owner_id, period_key, won, stamps_awarded)
       values ($1, $2, '2020-W02', true, 1)`,
      [rows[0]!.id, other.userId],
    );

    const card = await makeCard({ stamps: 1 });
    expect((await play(card.uniqueId)).json().data.won).toBe(true);
  });

  it('rate limits plays to 10 per minute per IP', async () => {
    const card = await makeCard();
    const ip = '10.9.9.9';
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await play(card.uniqueId, owner.slug, ip)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('game: week boundary (Bogota)', () => {
  it('Sunday 23:59 and Monday 00:00 are different weeks, so the card plays again', async () => {
    const { playGame } = await import('../src/lib/game.js');
    const { db: kdb } = await import('../src/db/kysely.js');
    const sundayLate = new Date('2026-11-02T04:59:00Z'); // Sun 1 Nov 23:59 Bogota
    const monday = new Date('2026-11-02T05:00:00Z'); // Mon 2 Nov 00:00 Bogota
    const card = await makeCard({ stamps: 1, visitAt: sundayLate.getTime() - DAY });

    const first = await playGame(kdb, owner.userId, card.uniqueId, sundayLate);
    expect(first).toMatchObject({ ok: true, result: { periodKey: '2026-W44', won: true, stamps: 2 } });
    if (first.ok) expect(first.result.nextPlayAt).toBe('2026-11-02T05:00:00.000Z');

    const replay = await playGame(kdb, owner.userId, card.uniqueId, new Date('2026-11-02T04:59:59Z'));
    expect(replay).toMatchObject({ ok: true, result: { periodKey: '2026-W44', won: true, stamps: 2 } });

    const next = await playGame(kdb, owner.userId, card.uniqueId, monday);
    expect(next).toMatchObject({ ok: true, result: { periodKey: '2026-W45', won: true, stamps: 3 } });
    if (next.ok) expect(next.result.nextPlayAt).toBe('2026-11-09T05:00:00.000Z');

    const { rows } = await db.pool.query(
      'select period_key from loyalty.card_plays where card_id = $1 order by period_key',
      [card.id],
    );
    expect(rows.map((r) => r.period_key)).toEqual(['2026-W44', '2026-W45']);
  });
});

describe('game: visit analytics', () => {
  it('a bonus transaction is not a visit', async () => {
    const visitAt = Date.now() - 3 * DAY;
    const card = await makeCard({ stamps: 2, visitAt });
    expect((await play(card.uniqueId)).json().data.won).toBe(true);

    // Lookup's lastVisitAt stays on the real visit.
    const session = new Session();
    session.captureFromResponse(
      await rig.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'owner@example.com', password: 'hunter2bravo' },
        headers: { 'content-type': 'application/json' },
      }),
    );
    const lookup = await rig.app.inject({
      method: 'GET',
      url: `/customers/lookup?id=${customerId}`,
      headers: { cookie: session.cookieJarHeader() ?? '' },
    });
    expect(lookup.statusCode).toBe(200);
    const summary = JSON.stringify(lookup.json().data);
    expect(summary).toContain(`"lastVisitAt":"${new Date(visitAt).toISOString()}"`);

    // A card whose only recent activity is a bonus is not eligible.
    const stale = await makeCard({ visitAt: Date.now() - 90 * DAY });
    await addTx(stale.id, 'bonus', Date.now() - DAY);
    expect((await getGame(stale.uniqueId)).json().data).toMatchObject({ state: 'locked', reason: 'NO_RECENT_VISIT' });
  });
});

describe('game: public card embed', () => {
  it('GET /public/cards includes game, null when the campaign has no game', async () => {
    const card = await makeCard();
    const res = await rig.app.inject({
      method: 'GET',
      url: `/public/cards/${owner.slug}/${card.uniqueId}`,
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.game).toMatchObject({ state: 'available' });
    expect(typeof res.json().data.game.nextPlayAt).toBe('string');

    await play(card.uniqueId);
    const played = await rig.app.inject({ method: 'GET', url: `/public/cards/${owner.slug}/${card.uniqueId}`, remoteAddress: nextIp() });
    expect(played.json().data.game).toMatchObject({ state: 'played', lastResult: { won: true, stampsAwarded: 1 } });
    expect(played.json().data.card.history.some((t: { type: string }) => t.type === 'bonus')).toBe(true);

    await setGame(campaignId, { enabled: false });
    const off = await rig.app.inject({ method: 'GET', url: `/public/cards/${owner.slug}/${card.uniqueId}`, remoteAddress: nextIp() });
    expect(off.json().data.game).toBeNull();

    const orphan = await makeCard({ campaign: null });
    const none = await rig.app.inject({ method: 'GET', url: `/public/cards/${owner.slug}/${orphan.uniqueId}`, remoteAddress: nextIp() });
    expect(none.json().data.game).toBeNull();
  });
});

describe('game: owner estimate', () => {
  const login = async (email: string) => {
    const s = new Session();
    s.captureFromResponse(
      await rig.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'hunter2bravo' },
        headers: { 'content-type': 'application/json' },
      }),
    );
    return { cookie: s.cookieJarHeader() ?? '' };
  };

  it('counts eligible cards and applies A × 0.4 × 4.3 × w, capped', async () => {
    await setGame(campaignId, { winPct: 15, cap: 30 });
    await makeCard();
    await makeCard();
    await makeCard({ holdout: true });
    await makeCard({ visitAt: Date.now() - 61 * DAY }); // not eligible
    await makeCard({ visitAt: null }); // not eligible
    await makeCard({ status: 'Redeemed' }); // not eligible
    const otherCampaign = await insertCampaign(db.pool, owner.userId, { name: 'Pelo' });
    await makeCard({ campaign: otherCampaign }); // other campaign

    const headers = await login('owner@example.com');
    const defaults = await rig.app.inject({ method: 'GET', url: `/campaigns/${campaignId}/game-estimate`, headers });
    expect(defaults.statusCode).toBe(200);
    // 3 × 0.4 × 4.3 × 0.15 = 0.774
    expect(defaults.json().data).toEqual({
      eligibleCards: 3,
      expectedStampsPerMonth: 0.8,
      cappedStampsPerMonth: 0.8,
      expectedRewardsPerMonth: 0.1,
    });

    // Preview unsaved settings: 3 × 0.4 × 4.3 × 0.5 = 2.58, capped at 1.
    const preview = await rig.app.inject({
      method: 'GET',
      url: `/campaigns/${campaignId}/game-estimate?winPct=50&cap=1`,
      headers,
    });
    expect(preview.json().data).toEqual({
      eligibleCards: 3,
      expectedStampsPerMonth: 2.6,
      cappedStampsPerMonth: 1,
      expectedRewardsPerMonth: 0.1,
    });

    const bad = await rig.app.inject({ method: 'GET', url: `/campaigns/${campaignId}/game-estimate?winPct=101`, headers });
    expect(bad.statusCode).toBe(400);
  });

  it('is owner-scoped and requires auth', async () => {
    expect((await rig.app.inject({ method: 'GET', url: `/campaigns/${campaignId}/game-estimate` })).statusCode).toBe(401);
    await insertOwner(db.pool, {
      email: 'other@example.com',
      password: 'hunter2bravo',
      businessName: 'Other',
      slug: 'other-biz',
    });
    const headers = await login('other@example.com');
    const res = await rig.app.inject({ method: 'GET', url: `/campaigns/${campaignId}/game-estimate`, headers });
    expect(res.statusCode).toBe(404);
  });
});

describe('game: campaign settings', () => {
  const headers = async () => {
    const s = new Session();
    s.captureFromResponse(
      await rig.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'owner@example.com', password: 'hunter2bravo' },
        headers: { 'content-type': 'application/json' },
      }),
    );
    return { 'content-type': 'application/json', cookie: s.cookieJarHeader() ?? '' };
  };
  const payload = (overrides: Record<string, unknown> = {}) => ({
    name: 'Facial',
    rewardName: 'Facial gratis',
    iconKey: 'Sparkles',
    colors: { background: '#ffffff' },
    totalStamps: 10,
    ...overrides,
  });

  it('defaults to off, 15 %, cap 30', async () => {
    const res = await rig.app.inject({ method: 'POST', url: '/campaigns', payload: payload(), headers: await headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ gameEnabled: false, gameWinPct: 15, gameMonthlyCap: 30 });
  });

  it('persists the game fields, keeps them when omitted, and validates ranges', async () => {
    const h = await headers();
    const put = (body: Record<string, unknown>) =>
      rig.app.inject({ method: 'PUT', url: '/campaigns/game-campaign', payload: body, headers: h });

    const created = await put(payload({ gameEnabled: true, gameWinPct: 25, gameMonthlyCap: 12 }));
    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({ gameEnabled: true, gameWinPct: 25, gameMonthlyCap: 12 });

    const renamed = await put(payload({ name: 'Renamed' }));
    expect(renamed.json().data).toMatchObject({ name: 'Renamed', gameEnabled: true, gameWinPct: 25, gameMonthlyCap: 12 });

    const off = await put(payload({ gameEnabled: false }));
    expect(off.json().data.gameEnabled).toBe(false);

    expect((await put(payload({ gameWinPct: 101 }))).statusCode).toBe(400);
    expect((await put(payload({ gameWinPct: 10.5 }))).statusCode).toBe(400);
    expect((await put(payload({ gameMonthlyCap: -1 }))).statusCode).toBe(400);

    const list = await rig.app.inject({ method: 'GET', url: '/campaigns', headers: h });
    const row = (list.json().data as Array<{ id: string; gameWinPct: number }>).find((c) => c.id === 'game-campaign');
    expect(row?.gameWinPct).toBe(25);
  });
});
