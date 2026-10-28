// Weekly scratch game "Raspa y gana" — docs/CARD_ENGAGEMENT_PLAN.md §8.
// Every rule is enforced here (server side); the SPA only animates the result.
import { randomInt, randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { cardBucket, GAME_HOLDOUT_BUCKET } from './holdout.js';
import { isoWeekKey, monthStart, nextWeekStart } from './period.js';

// Mirrors GameState / PlayResult in the root types.ts (the API can't import
// across its rootDir). Keep the JSON shapes identical.
export type GameStateKind = 'available' | 'played' | 'locked' | 'disabled' | 'holdout';
export type GameLockReason = 'NO_RECENT_VISIT' | 'NOT_ACTIVE';
export interface GameState {
  state: GameStateKind;
  nextPlayAt: string;
  reason?: GameLockReason;
  lastResult?: { won: boolean; stampsAwarded: number; playedAt: string };
}
export interface PlayResult {
  won: boolean;
  stampsAwarded: number;
  stamps: number;
  nextPlayAt: string;
  periodKey: string;
}

export type GameUnavailableReason = 'DISABLED' | 'HOLDOUT' | GameLockReason;

/** Rule 3: a real visit (stamp_add) in this window makes the card eligible. */
export const GAME_ELIGIBILITY_DAYS = 60;
export const GAME_ELIGIBILITY_MS = GAME_ELIGIBILITY_DAYS * 24 * 60 * 60 * 1000;

/** §8.4: share of eligible cards assumed to play in a given week. */
export const GAME_WEEKLY_PLAY_SHARE = 0.4;
/** Average weeks per month. */
export const WEEKS_PER_MONTH = 4.3;

// §8.10 game holdout: cards in GAME_HOLDOUT_BUCKET see a locked "Pronto"
// ticket and can't play. Read straight from process.env (not config.ts) so the
// experiment can be ended with GAME_HOLDOUT=off once its window closes.
export const isGameHoldout = (uniqueId: string) =>
  process.env.GAME_HOLDOUT !== 'off' && cardBucket(uniqueId) === GAME_HOLDOUT_BUCKET;

export interface GameCard {
  id: string;
  unique_id: string;
  owner_id: string;
  status: 'Active' | 'Redeemed';
  stamps: number;
  template_snapshot: Record<string, unknown> | null;
}

export interface GameCampaign {
  game_enabled: boolean;
  game_win_pct: number;
  game_monthly_cap: number;
  total_stamps: number;
}

type Db = Kysely<Database>;

export const loadGameCampaign = async (
  db: Db,
  campaignId: string | null,
  ownerId: string,
): Promise<GameCampaign | null> => {
  if (!campaignId) return null;
  const row = await db
    .selectFrom('campaigns')
    .select(['game_enabled', 'game_win_pct', 'game_monthly_cap', 'total_stamps'])
    .where('id', '=', campaignId)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  return row ?? null;
};

/** The card's own snapshot is what the customer sees, so it wins (same rule as gift-stamps). */
export const cardTotalStamps = (card: GameCard, campaign: GameCampaign | null): number | null => {
  const snapshotTotal = Number(card.template_snapshot?.['totalStamps']);
  if (Number.isFinite(snapshotTotal) && snapshotTotal > 0) return snapshotTotal;
  return campaign?.total_stamps ?? null;
};

const findPlay = (db: Db, cardId: string, periodKey: string) =>
  db
    .selectFrom('card_plays')
    .select(['won', 'stamps_awarded', 'played_at'])
    .where('card_id', '=', cardId)
    .where('period_key', '=', periodKey)
    .executeTakeFirst();

const hasRecentVisit = async (db: Db, cardId: string, now: Date) => {
  const row = await db
    .selectFrom('transactions')
    .select('id')
    .where('card_id', '=', cardId)
    .where('type', '=', 'stamp_add')
    .where('timestamp', '>=', now.getTime() - GAME_ELIGIBILITY_MS)
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
};

/** Rules 1 and 3 (plus the holdout). null = the card may play. */
const unavailableReason = async (
  db: Db,
  card: GameCard,
  campaign: GameCampaign | null,
  now: Date,
): Promise<GameUnavailableReason | null> => {
  if (!campaign?.game_enabled) return 'DISABLED';
  if (isGameHoldout(card.unique_id)) return 'HOLDOUT';
  if (card.status !== 'Active') return 'NOT_ACTIVE';
  if (!(await hasRecentVisit(db, card.id, now))) return 'NO_RECENT_VISIT';
  return null;
};

/**
 * Current game state for a card. Pass the live campaign (null when the card
 * has none). Order: disabled → holdout → played this week → locked → available.
 */
export const computeGameState = async (
  db: Db,
  card: GameCard,
  campaign: GameCampaign | null,
  now = new Date(),
): Promise<GameState> => {
  const nextPlayAt = nextWeekStart(now).toISOString();
  if (!campaign?.game_enabled) return { state: 'disabled', nextPlayAt };
  if (isGameHoldout(card.unique_id)) return { state: 'holdout', nextPlayAt };

  const play = await findPlay(db, card.id, isoWeekKey(now));
  if (play) {
    return {
      state: 'played',
      nextPlayAt,
      lastResult: {
        won: play.won,
        stampsAwarded: play.stamps_awarded,
        playedAt: new Date(play.played_at).toISOString(),
      },
    };
  }

  const reason = await unavailableReason(db, card, campaign, now);
  if (reason === 'NOT_ACTIVE' || reason === 'NO_RECENT_VISIT') {
    return { state: 'locked', nextPlayAt, reason };
  }
  return { state: 'available', nextPlayAt };
};

export type PlayOutcome =
  | { ok: true; result: PlayResult }
  | { ok: false; reason: GameUnavailableReason }
  | { ok: false; reason: 'NOT_FOUND' };

/** Bonus stamps the business has awarded this local (Bogota) month. */
export const monthlyAwarded = async (db: Db, ownerId: string, now: Date) => {
  const row = await db
    .selectFrom('card_plays')
    .select(({ fn }) => fn.coalesce(fn.sum<number>('stamps_awarded'), sql<number>`0`).as('total'))
    .where('owner_id', '=', ownerId)
    .where('played_at', '>=', monthStart(now))
    .executeTakeFirst();
  return Number(row?.total ?? 0);
};

/**
 * One play (§8.3), in a single transaction with the card row locked.
 * Idempotent per (card, ISO week): a repeat returns the stored result.
 */
export const playGame = async (
  db: Db,
  ownerId: string,
  uniqueId: string,
  now = new Date(),
): Promise<PlayOutcome> =>
  db.transaction().execute(async (trx): Promise<PlayOutcome> => {
    const card = (await trx
      .selectFrom('issued_cards')
      .select(['id', 'unique_id', 'owner_id', 'status', 'stamps', 'template_snapshot', 'campaign_id'])
      .where('unique_id', '=', uniqueId)
      .where('owner_id', '=', ownerId)
      .forUpdate()
      .executeTakeFirst()) as (GameCard & { campaign_id: string | null }) | undefined;
    if (!card) return { ok: false, reason: 'NOT_FOUND' };

    const periodKey = isoWeekKey(now);
    const nextPlayAt = nextWeekStart(now).toISOString();
    const stored = (play: { won: boolean; stamps_awarded: number }, stamps: number): PlayOutcome => ({
      ok: true,
      result: { won: play.won, stampsAwarded: play.stamps_awarded, stamps, nextPlayAt, periodKey },
    });

    const existing = await findPlay(trx, card.id, periodKey);
    if (existing) return stored(existing, card.stamps);

    const campaign = await loadGameCampaign(trx, card.campaign_id, ownerId);
    const reason = await unavailableReason(trx, card, campaign, now);
    if (reason || !campaign) return { ok: false, reason: reason ?? 'DISABLED' };

    // Serialize plays per business so concurrent wins on different cards
    // can't overshoot the monthly cap.
    await sql`select pg_advisory_xact_lock(hashtext(${`card_game:${ownerId}`}))`.execute(trx);

    // Rule 4 (a win never completes a card) and rule 5 (monthly budget).
    const total = cardTotalStamps(card, campaign);
    const canWin =
      total !== null &&
      card.stamps < total - 1 &&
      (await monthlyAwarded(trx, ownerId, now)) < campaign.game_monthly_cap;
    const won = canWin && randomInt(100) < campaign.game_win_pct;
    const stampsAwarded = won ? 1 : 0;

    const inserted = await trx
      .insertInto('card_plays')
      .values({
        card_id: card.id,
        owner_id: ownerId,
        period_key: periodKey,
        played_at: now,
        won,
        stamps_awarded: stampsAwarded,
      })
      .onConflict((oc) => oc.columns(['card_id', 'period_key']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) {
      // Lost a race despite the row lock: return whatever was stored.
      const raced = await findPlay(trx, card.id, periodKey);
      if (raced) return stored(raced, card.stamps);
      throw new Error('card_plays conflict without a stored play');
    }

    let stamps = card.stamps;
    if (won) {
      stamps += 1;
      // Not a visit: last_visit stays untouched.
      await trx.updateTable('issued_cards').set({ stamps }).where('id', '=', card.id).execute();
      await trx
        .insertInto('transactions')
        .values({
          id: randomUUID(),
          card_id: card.id,
          type: 'bonus',
          amount: 1,
          date: now.toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true,
          }),
          timestamp: now.getTime(),
          title: 'Bonus Stamp',
          remarks: 'Raspa y gana',
          actor_id: null,
          actor_name: 'Raspa y gana',
          actor_role: 'system',
        })
        .execute();
      // TODO(wallet): onCardChanged(cardId)
    }

    return { ok: true, result: { won, stampsAwarded, stamps, nextPlayAt, periodKey } };
  });

/** §8.4 estimate: A × p × 4.3 × w, capped by the monthly budget. */
export const estimateGame = (params: {
  eligibleCards: number;
  winPct: number;
  cap: number;
  totalStamps: number;
}) => {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const expected = params.eligibleCards * GAME_WEEKLY_PLAY_SHARE * WEEKS_PER_MONTH * (params.winPct / 100);
  const capped = Math.min(expected, params.cap);
  return {
    eligibleCards: params.eligibleCards,
    expectedStampsPerMonth: round1(expected),
    cappedStampsPerMonth: round1(capped),
    expectedRewardsPerMonth: params.totalStamps > 0 ? round1(capped / params.totalStamps) : 0,
  };
};
