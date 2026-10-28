// OWNER: agent E (moments). Pure sequencing for the moments layer (plan §6.2,
// §6.3): which "since your last visit" / live event plays next, which gift the
// banner offers, when the card gets its completion celebration, and the copy.
// No React, no DOM — MomentDirector drives it and owns the timing.
import type { NewStampEvent } from './types';

/** Grid fill-in stagger per slot (matches PublicStampGrid). */
export const MOUNT_STAGGER_MS = 40;
/** Extra settle time after the fill-in before the first moment. */
export const MOUNT_SETTLE_MS = 350;
/** Between chained slots of one stamp event. */
export const SLAM_GAP_MS = 350;
/** Between chained slots of one gift. */
export const UNWRAP_GAP_MS = 250;
/** Between two events (same beat as chained slots, so a replay reads as one sequence). */
export const EVENT_GAP_MS = 350;
/** Glow ring on the target slot before a live stamp lands. */
export const ANTICIPATION_MS = 420;
/** Reduced motion: no fill-in to wait for, just a beat before the toasts. */
export const REDUCED_SETTLE_MS = 300;
/** A slot that never reports landed/unwrapped doesn't stall the queue. */
export const STEP_TIMEOUT_MS = 2500;
export const TOAST_MS = 2400;

/** Wait until the grid's mount fill-in is done before playing anything. */
export const settleDelayMs = (totalStamps: number) => Math.max(0, totalStamps) * MOUNT_STAGGER_MS + MOUNT_SETTLE_MS;

/** Gifts wait for a tap; stamps play on their own. */
export const isGiftKind = (kind: NewStampEvent['kind']) => kind === 'gift' || kind === 'welcome';

export interface QueuedMoment {
  event: NewStampEvent;
  /** Arrived while the client was looking (live refresh / game win). */
  live: boolean;
}

export interface MomentQueue {
  /** Every event id ever taken in (played or not), so a re-sync never replays. */
  known: string[];
  /** Stamp / bonus events waiting to slam, oldest first. */
  auto: QueuedMoment[];
  /** Gift / welcome events waiting to be opened, oldest first. */
  gifts: QueuedMoment[];
  /** Gift ids the client asked to open, in tap order. */
  opening: string[];
  /** The moment playing right now. */
  active: QueuedMoment | null;
}

export const emptyQueue = (): MomentQueue => ({ known: [], auto: [], gifts: [], opening: [], active: null });

/**
 * Takes in the current unacknowledged events. New ids are queued (with the
 * given `live` flag); waiting moments whose event disappeared (e.g. the stamp
 * was removed) are dropped and returned so their slots can be released. The
 * active moment always finishes.
 */
export const syncQueue = (
  queue: MomentQueue,
  events: NewStampEvent[],
  live: (event: NewStampEvent) => boolean,
): { queue: MomentQueue; dropped: QueuedMoment[] } => {
  const present = new Set(events.map((e) => e.id));
  const known = new Set(queue.known);
  const fresh = events.filter((e) => !known.has(e.id)).map((event) => ({ event, live: live(event) }));
  const keep = (m: QueuedMoment) => present.has(m.event.id);
  const dropped = [...queue.auto, ...queue.gifts].filter((m) => !keep(m));
  if (fresh.length === 0 && dropped.length === 0) return { queue, dropped };
  const gifts = [...queue.gifts.filter(keep), ...fresh.filter((m) => isGiftKind(m.event.kind))];
  return {
    queue: {
      known: [...queue.known, ...fresh.map((m) => m.event.id)],
      auto: [...queue.auto.filter(keep), ...fresh.filter((m) => !isGiftKind(m.event.kind))],
      gifts,
      opening: queue.opening.filter((id) => gifts.some((m) => m.event.id === id)),
      active: queue.active,
    },
    dropped,
  };
};

/** The waiting gift that owns a slot (a tap on a wrapped slot opens it). */
export const giftForSlot = (queue: MomentQueue, index: number): string | null =>
  queue.gifts.find((m) => m.event.slots.includes(index))?.event.id ?? null;

/** The client asked to open a gift (banner or wrapped slot tap). */
export const requestOpen = (queue: MomentQueue, id: string): MomentQueue =>
  queue.opening.includes(id) || !queue.gifts.some((m) => m.event.id === id) ? queue : { ...queue, opening: [...queue.opening, id] };

export type MomentStep = { type: 'slam' | 'unwrap'; moment: QueuedMoment };

/**
 * What to play next, if anything. One moment at a time. A gift the client
 * asked to open goes first (it answers a tap, so it doesn't wait for the
 * mount settle); stamps play oldest first once the grid is `ready`.
 */
export const nextStep = (queue: MomentQueue, ready: boolean): MomentStep | null => {
  if (queue.active) return null;
  for (const id of queue.opening) {
    const moment = queue.gifts.find((m) => m.event.id === id);
    if (moment) return { type: 'unwrap', moment };
  }
  if (ready && queue.auto.length > 0) return { type: 'slam', moment: queue.auto[0]! };
  return null;
};

/** Moves a moment out of its waiting list and makes it active. */
export const startStep = (queue: MomentQueue, step: MomentStep): MomentQueue => {
  const id = step.moment.event.id;
  return {
    ...queue,
    auto: queue.auto.filter((m) => m.event.id !== id),
    gifts: queue.gifts.filter((m) => m.event.id !== id),
    opening: queue.opening.filter((o) => o !== id),
    active: step.moment,
  };
};

export const finishStep = (queue: MomentQueue): MomentQueue => (queue.active ? { ...queue, active: null } : queue);

/** Nothing playing and nothing waiting (including unopened gifts). */
export const isDrained = (queue: MomentQueue) =>
  !queue.active && queue.auto.length === 0 && queue.gifts.length === 0;

/**
 * Whether the moment that is active right now is the one that completes the
 * card: nothing else waits behind it and the card is full.
 */
export const completesCard = (queue: MomentQueue, stamps: number, totalStamps: number) =>
  !!queue.active && queue.auto.length === 0 && queue.gifts.length === 0 && totalStamps > 0 && stamps >= totalStamps;

/** The gift the banner offers: the oldest one not already being opened. */
export const bannerGift = (queue: MomentQueue): QueuedMoment | null =>
  queue.gifts.find((m) => !queue.opening.includes(m.event.id)) ?? null;

// --- Copy (es-CO) ---

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

const dayStart = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "hoy", "ayer" or "12 oct". */
export const shortDate = (timestamp: number, now = Date.now()) => {
  const days = Math.round((dayStart(now) - dayStart(timestamp)) / 86_400_000);
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  const d = new Date(timestamp);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const sellos = (n: number) => `${n} ${n === 1 ? 'sello' : 'sellos'}`;

/** Stamps on the card once this event has landed (its highest slot + 1). */
export const countAfter = (event: NewStampEvent) => (event.slots.length ? Math.max(...event.slots) + 1 : 0);

export type ToastTone = 'stamp' | 'bonus' | 'gift' | 'complete';

export interface ToastCopy {
  tone: ToastTone;
  text: string;
}

export const stampToast = (
  moment: QueuedMoment,
  opts: { totalStamps: number; completes: boolean; now?: number },
): ToastCopy => {
  const { event, live } = moment;
  if (opts.completes) return { tone: 'complete', text: '¡Completaste tu tarjeta!' };
  const progress = `${Math.min(countAfter(event), opts.totalStamps)}/${opts.totalStamps}`;
  if (event.kind === 'bonus') return { tone: 'bonus', text: live ? `¡Sello de la suerte! ${progress}` : 'Sello de la suerte' };
  if (live) return { tone: 'stamp', text: event.amount > 1 ? `¡${sellos(event.amount)} nuevos! ${progress}` : `¡Nuevo sello! ${progress}` };
  return { tone: 'stamp', text: `+${sellos(event.amount)} · ${shortDate(event.timestamp, opts.now)}` };
};

export const giftToast = (event: NewStampEvent, completes: boolean): ToastCopy =>
  completes ? { tone: 'complete', text: '¡Completaste tu tarjeta!' } : { tone: 'gift', text: `¡Regalo abierto! +${sellos(event.amount)}` };

export const bannerCopy = (event: NewStampEvent, businessName: string) =>
  event.kind === 'welcome'
    ? { title: `¡Bienvenida! Te regalamos ${sellos(event.amount)}`, action: 'Toca para abrir' }
    : { title: `${businessName} te regaló ${sellos(event.amount)}`, action: 'Toca para abrir' };
