import type { Transaction } from '../../types';

export interface SlotOrigin {
  index: number;
  /** Transaction that filled this slot (null when history doesn't explain it). */
  txId: string | null;
  type: Transaction['type'] | null;
  timestamp: number | null;
}

/** Transactions that add stamps to slots. 'issued' carries the issue gift. */
const fills = (tx: Transaction) =>
  (tx.type === 'stamp_add' || tx.type === 'gift' || tx.type === 'bonus' || tx.type === 'issued') && tx.amount > 0;

/**
 * Replays the history (oldest first) to find which transaction filled each
 * currently-filled slot. Removals pop the most recent slot. If the history
 * doesn't add up to `stamps` (old imports, manual edits), the card's count
 * wins: extra slots are dropped, missing ones have no origin.
 */
export const buildStampTimeline = (history: Transaction[], stamps: number): SlotOrigin[] => {
  const ordered = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const slots: Omit<SlotOrigin, 'index'>[] = [];
  for (const tx of ordered) {
    if (tx.type === 'redeem') {
      slots.length = 0;
      continue;
    }
    if (tx.type === 'stamp_remove') {
      slots.splice(Math.max(0, slots.length - Math.abs(tx.amount || 1)));
      continue;
    }
    if (!fills(tx)) continue;
    for (let i = 0; i < tx.amount; i++) slots.push({ txId: tx.id, type: tx.type, timestamp: tx.timestamp });
  }
  if (slots.length > stamps) slots.splice(stamps);
  const out: SlotOrigin[] = slots.map((slot, index) => ({ index, ...slot }));
  for (let index = out.length; index < stamps; index++) out.push({ index, txId: null, type: null, timestamp: null });
  return out;
};

/** Slot indexes filled by a given transaction. */
export const slotsForTransaction = (timeline: SlotOrigin[], txId: string) =>
  timeline.filter((slot) => slot.txId === txId).map((slot) => slot.index);
