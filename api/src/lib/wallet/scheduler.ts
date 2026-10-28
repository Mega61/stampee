// In-process scheduler for wallet pass jobs. Today: the weekly "raspa y gana"
// reminder, Monday 10:00 America/Bogota, to every pass whose card can play
// this week (game state 'available': game on, not in the holdout, active, a
// recent visit, not played yet).
//
// Safe with restarts and several API instances:
//   - a minute tick only acts inside the send window and while the week has
//     no finished row in wallet_job_runs;
//   - one instance at a time holds a transaction-scoped advisory lock for the
//     run (others skip that tick);
//   - every send claims `weekly_game:<ISO week>` per pass in
//     wallet_notifications first, so a crash mid-run resumes without
//     sending anything twice.
// A run missed entirely (API down all Monday afternoon) is skipped: late
// "listo" pings at night or mid-week are worse than none.
import { sql } from 'kysely';
import { db } from '../../db/kysely.js';
import { computeGameState, loadGameCampaign, type GameCard } from '../game.js';
import { isoWeekKey, localWeekTime, nextWeekStart } from '../period.js';
import { isGoogleWalletEnabled, sendGoogleWeeklyGame } from './google.js';
import { isAppleWalletEnabled, sendAppleWeeklyGame } from './apple.js';

export const WEEKLY_GAME_JOB = 'weekly_game';
/** Monday, from 10:00 until 20:00 Bogota. */
export const WEEKLY_GAME_START_HOUR = 10;
export const WEEKLY_GAME_END_HOUR = 20;
const TICK_MS = 60_000;

/** The ISO week to remind for at `now`, or null outside the send window. */
export const weeklyGameWindow = (now: Date): string | null => {
  const t = localWeekTime(now);
  if (t.weekday !== 0 || t.hour < WEEKLY_GAME_START_HOUR || t.hour >= WEEKLY_GAME_END_HOUR) return null;
  return isoWeekKey(now);
};

export interface WeeklyRunResult {
  periodKey: string;
  sent: number;
  silent: number;
  skipped: number;
  failed: number;
}

interface Logger {
  error: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
}

/**
 * Sends this week's reminders if it's time and nobody has yet. Null when
 * there was nothing to do (outside the window, already done, wallets off, or
 * another instance holds the run).
 */
export const runWeeklyGameReminders = async (now = new Date(), log?: Logger): Promise<WeeklyRunResult | null> => {
  const google = isGoogleWalletEnabled();
  const apple = isAppleWalletEnabled();
  if (!google && !apple) return null;
  const periodKey = weeklyGameWindow(now);
  if (!periodKey) return null;
  const done = await db
    .selectFrom('wallet_job_runs')
    .select('job')
    .where('job', '=', WEEKLY_GAME_JOB)
    .where('period_key', '=', periodKey)
    .executeTakeFirst();
  if (done) return null;

  return db.transaction().execute(async (trx) => {
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(hashtext(${`wallet_job:${WEEKLY_GAME_JOB}`})) as locked
    `.execute(trx);
    if (!rows[0]?.locked) return null;
    // Someone may have finished between the check above and the lock.
    const finished = await trx
      .selectFrom('wallet_job_runs')
      .select('job')
      .where('job', '=', WEEKLY_GAME_JOB)
      .where('period_key', '=', periodKey)
      .executeTakeFirst();
    if (finished) return null;

    const providers = [...(google ? ['google' as const] : []), ...(apple ? ['apple' as const] : [])];
    const passes = await db
      .selectFrom('wallet_passes')
      .innerJoin('issued_cards', 'issued_cards.id', 'wallet_passes.card_id')
      .innerJoin('campaigns', 'campaigns.id', 'issued_cards.campaign_id')
      .select([
        'wallet_passes.provider as provider',
        'wallet_passes.object_id as objectId',
        'issued_cards.id as id',
        'issued_cards.unique_id as unique_id',
        'issued_cards.owner_id as owner_id',
        'issued_cards.status as status',
        'issued_cards.stamps as stamps',
        'issued_cards.template_snapshot as template_snapshot',
        'issued_cards.campaign_id as campaign_id',
      ])
      .where('wallet_passes.provider', 'in', providers)
      .where('issued_cards.status', '=', 'Active')
      .where('campaigns.game_enabled', '=', true)
      .orderBy('issued_cards.id')
      .execute();

    const result: WeeklyRunResult = { periodKey, sent: 0, silent: 0, skipped: 0, failed: 0 };
    const dedupeKey = `${WEEKLY_GAME_JOB}:${periodKey}`;
    const endsAt = nextWeekStart(now);
    const states = new Map<string, string>();
    for (const pass of passes) {
      try {
        let state = states.get(pass.id);
        if (!state) {
          const campaign = await loadGameCampaign(db, pass.campaign_id, pass.owner_id);
          state = (await computeGameState(db, pass as unknown as GameCard, campaign, now)).state;
          states.set(pass.id, state);
        }
        if (state !== 'available') {
          result.skipped++;
          continue;
        }
        const outcome =
          pass.provider === 'google'
            ? await sendGoogleWeeklyGame(pass.id, pass.objectId, dedupeKey, endsAt)
            : await sendAppleWeeklyGame(pass.id, dedupeKey);
        if (outcome === 'sent') result.sent++;
        else if (outcome === 'silent') result.silent++;
        else result.skipped++;
      } catch (err) {
        result.failed++;
        log?.error({ err, cardId: pass.id, provider: pass.provider }, 'weekly game reminder failed');
      }
    }

    await trx
      .insertInto('wallet_job_runs')
      .values({ job: WEEKLY_GAME_JOB, period_key: periodKey, sent: result.sent })
      .onConflict((oc) => oc.columns(['job', 'period_key']).doNothing())
      .execute();
    log?.info?.(result, 'weekly game reminders sent');
    return result;
  });
};

/**
 * Starts the minute tick. Returns a stop function. Never throws; ticks never
 * overlap.
 */
export const startWalletScheduler = (log: Logger): (() => void) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runWeeklyGameReminders(new Date(), log);
    } catch (err) {
      log.error({ err }, 'wallet scheduler tick failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
};
