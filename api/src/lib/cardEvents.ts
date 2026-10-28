// Card change notifications. Call `onCardChanged(cardId)` after any change to a
// card's stamps or status is committed (stamp add/remove, redeem, gift, game
// win). It must never block or fail the caller's response.
//
// Pass the cause when the caller knows it: it decides the pass notification
// (lib/wallet/passContent.ts planNotifications). 'stamp' rings the balance,
// 'gift' sends the "te regaló" message, 'bonus' (game win) updates silently.
// Causes collected during the debounce window are merged.
//
// Listeners: the Google Wallet sync (lib/wallet/google.ts) and the Apple
// Wallet notifier (lib/wallet/apple.ts: bump the pass, push its devices). They
// run independently: one failing never skips the other. Calls are debounced per card: the kiosk stamps with PATCH /cards/:id and
// POST /cards/:id/transactions back to back, which should become one update.
import { isGoogleWalletEnabled, syncGooglePass } from './wallet/google.js';
import { isAppleWalletEnabled, notifyApplePass } from './wallet/apple.js';
import { noChanges, type CardChangeCause, type CardChanges } from './wallet/passContent.js';

export type { CardChangeCause };

export const CARD_EVENT_DEBOUNCE_MS = 1000;

interface Logger {
  error: (obj: unknown, msg?: string) => void;
}

// Fastify's logger isn't reachable from here; console is good enough for the
// rare failure and is what pino-less modules in this API already use.
const consoleLogger: Logger = {
  // eslint-disable-next-line no-console
  error: (obj, msg) => console.error(msg ?? 'card event failed', obj),
};
let logger: Logger = consoleLogger;
export const setCardEventsLogger = (next: Logger | null): void => {
  logger = next ?? consoleLogger;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingChanges = new Map<string, CardChanges>();
const inFlight = new Set<Promise<void>>();

const run = (cardId: string) => {
  timers.delete(cardId);
  const changes = pendingChanges.get(cardId) ?? noChanges();
  pendingChanges.delete(cardId);
  const task = (async () => {
    try {
      await syncGooglePass(cardId, changes);
    } catch (err) {
      logger.error({ err, cardId }, 'wallet sync failed');
    }
    try {
      const result = await notifyApplePass(cardId, changes);
      // 410 (device gone) is handled there; anything else is worth a log.
      const failed = result?.pushed.filter((r) => r.status !== 200 && r.status !== 410) ?? [];
      if (failed.length) {
        logger.error(
          { cardId, failed: failed.map((r) => ({ status: r.status, reason: r.reason })) },
          'apple wallet push failed',
        );
      }
    } catch (err) {
      logger.error({ err, cardId }, 'apple wallet notify failed');
    }
  })();
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
};

export const onCardChanged = (cardId: string, cause?: CardChangeCause, amount = 0): void => {
  try {
    if (!cardId || !(isGoogleWalletEnabled() || isAppleWalletEnabled())) return;
    const changes = pendingChanges.get(cardId) ?? noChanges();
    if (cause) changes.causes.add(cause);
    if (cause === 'gift') changes.giftedStamps += Math.max(0, amount);
    pendingChanges.set(cardId, changes);
    const pending = timers.get(cardId);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => run(cardId), CARD_EVENT_DEBOUNCE_MS);
    // Never keep the process alive (or a test runner) just for a sync.
    timer.unref?.();
    timers.set(cardId, timer);
  } catch (err) {
    logger.error({ err, cardId }, 'onCardChanged failed');
  }
};

/** Runs pending debounced syncs now and waits for all of them (tests, shutdown). */
export const flushCardEvents = async (): Promise<void> => {
  for (const [cardId, timer] of timers) {
    clearTimeout(timer);
    run(cardId);
  }
  await Promise.all(inFlight);
};

/** Pending (debounced, not yet started) card ids — for tests. */
export const pendingCardEvents = (): string[] => Array.from(timers.keys());
