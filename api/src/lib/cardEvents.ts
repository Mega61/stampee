// Card change notifications. Call `onCardChanged(cardId)` after any change to a
// card's stamps or status is committed (stamp add/remove, redeem, gift, game
// win). It must never block or fail the caller's response.
//
// Today the only listener is the Google Wallet sync (lib/wallet/google.ts).
// Calls are debounced per card: the kiosk stamps with PATCH /cards/:id and
// POST /cards/:id/transactions back to back, which should become one update.
import { isGoogleWalletEnabled, syncGooglePass } from './wallet/google.js';

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
const inFlight = new Set<Promise<void>>();

const run = (cardId: string) => {
  timers.delete(cardId);
  const task = (async () => {
    try {
      await syncGooglePass(cardId);
    } catch (err) {
      logger.error({ err, cardId }, 'wallet sync failed');
    }
  })();
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
};

export const onCardChanged = (cardId: string): void => {
  try {
    if (!cardId || !isGoogleWalletEnabled()) return;
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
