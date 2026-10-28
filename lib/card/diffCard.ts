// "Since your last visit" (plan §6.2): pure diff between the card as it is now
// and what this device last saw. No React, no storage — see useSeenState.
import type { IssuedCard, Transaction } from '../../types';
import type { NewStampEvent } from './types';
import { buildStampTimeline, slotsForTransaction } from './stampTimeline';

/** How many transaction ids we remember (the newest ones). */
export const SEEN_TX_LIMIT = 30;

/** Persisted per card under `stampee:seen:<uniqueId>`. */
export interface SeenState {
  v: 1;
  /** Stamps the client has seen land (excludes pending events). */
  stamps: number;
  /** Newest-first transaction ids already shown. */
  txIds: string[];
  revealedReward: boolean;
  /** Gift / welcome transactions already unwrapped. */
  unwrapped: string[];
}

const KIND: Partial<Record<Transaction['type'], NewStampEvent['kind']>> = {
  stamp_add: 'stamp',
  bonus: 'bonus',
  gift: 'gift',
  // Only ever unseen when the first-visit baseline left it out on purpose.
  issued: 'welcome',
};

/** Newest first, ties broken by id so the order is stable. */
const newestFirst = (history: Transaction[]) =>
  [...history].sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

/** The window of transactions the diff looks at (and the seen list mirrors). */
const recentWindow = (card: IssuedCard) => newestFirst(card.history ?? []).slice(0, SEEN_TX_LIMIT);

/** A fresh card whose only stamps are the issue gift → it gets a welcome moment. */
const welcomeTx = (card: IssuedCard): Transaction | null => {
  if (card.status !== 'Active') return null;
  const history = card.history ?? [];
  if (history.some((tx) => tx.type === 'stamp_add' || tx.type === 'gift' || tx.type === 'bonus')) return null;
  const issued = history.find((tx) => tx.type === 'issued' && tx.amount > 0);
  if (!issued) return null;
  const slots = slotsForTransaction(buildStampTimeline(history, card.stamps), issued.id);
  return slots.length > 0 ? issued : null;
};

/**
 * First visit on this device: everything already on the card counts as seen
 * (a returning client on a new phone must not get historic stamps slammed),
 * except a fresh card's issue gift, which stays unseen → 'welcome' event.
 */
export const baselineSeen = (card: IssuedCard): SeenState => {
  const welcome = welcomeTx(card);
  const txIds = recentWindow(card).map((tx) => tx.id).filter((id) => id !== welcome?.id);
  const welcomeSlots = welcome ? welcome.amount : 0;
  return {
    v: 1,
    stamps: Math.max(0, card.stamps - welcomeSlots),
    txIds,
    revealedReward: false,
    unwrapped: [],
  };
};

/** Unseen stamp-adding transactions, oldest first. A closed (redeemed) card has none. */
export const diffCard = (card: IssuedCard, seen: SeenState): NewStampEvent[] => {
  if (card.status === 'Redeemed') return [];
  const seenIds = new Set(seen.txIds);
  const unseen = recentWindow(card).filter((tx) => !seenIds.has(tx.id) && KIND[tx.type] && tx.amount > 0);
  if (unseen.length === 0) return [];
  const timeline = buildStampTimeline(card.history ?? [], card.stamps);
  const events: NewStampEvent[] = [];
  for (const tx of unseen.reverse()) {
    // Only slots that are still filled (a stamp added then removed is no moment).
    const slots = slotsForTransaction(timeline, tx.id);
    if (slots.length === 0) continue;
    events.push({ id: tx.id, kind: KIND[tx.type]!, amount: slots.length, slots, timestamp: tx.timestamp });
  }
  return events;
};

/**
 * Marks events as seen. `txIds` is rebuilt from the card's recent window so
 * it stays newest-first and capped; ids the card no longer has are dropped.
 */
export const acknowledgeSeen = (seen: SeenState, card: IssuedCard, ids: string[]): SeenState => {
  if (ids.length === 0) return seen;
  const known = new Set([...seen.txIds, ...ids]);
  const window = recentWindow(card);
  const txIds = window.map((tx) => tx.id).filter((id) => known.has(id));
  const giftIds = ids.filter((id) => window.some((tx) => tx.id === id && (tx.type === 'gift' || tx.type === 'issued')));
  const unwrapped = [...giftIds, ...seen.unwrapped.filter((id) => !giftIds.includes(id))].slice(0, SEEN_TX_LIMIT);
  const next: SeenState = { ...seen, txIds, unwrapped };
  const pending = diffCard(card, next).reduce((sum, e) => sum + e.slots.length, 0);
  next.stamps = Math.max(0, card.stamps - pending);
  return next;
};

/** The reveal is per cycle: once stamps drop below the total it can play again. */
export const syncRewardRevealed = (seen: SeenState, card: IssuedCard, totalStamps: number): SeenState =>
  seen.revealedReward && card.status === 'Active' && card.stamps < totalStamps
    ? { ...seen, revealedReward: false }
    : seen;

/** Validates a parsed storage value; anything unexpected is treated as "no state". */
export const parseSeenState = (value: unknown): SeenState | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !Array.isArray(v.txIds)) return null;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  return {
    v: 1,
    stamps: typeof v.stamps === 'number' && Number.isFinite(v.stamps) ? Math.max(0, Math.floor(v.stamps)) : 0,
    txIds: strings(v.txIds).slice(0, SEEN_TX_LIMIT),
    revealedReward: v.revealedReward === true,
    unwrapped: strings(v.unwrapped).slice(0, SEEN_TX_LIMIT),
  };
};
