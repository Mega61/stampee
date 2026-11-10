import type { Transaction } from '../../types';

export interface StampSizing {
  sizeClassName: string;
  iconSize: number;
}

/** Slot size per density. Shared by the default grid and the public fx grid. */
export const getStampSizing = (
  totalStamps: number,
  opts: { compact?: boolean; mobileCompleted?: boolean } = {},
): StampSizing => {
  if (opts.compact) {
    return totalStamps >= 13
      ? { sizeClassName: 'w-12 h-12 sm:w-14 sm:h-14', iconSize: 22 }
      : totalStamps >= 9
        ? { sizeClassName: 'w-14 h-14 sm:w-16 sm:h-16', iconSize: 26 }
        : { sizeClassName: 'w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem]', iconSize: 32 };
  }
  if (opts.mobileCompleted) {
    return totalStamps >= 13
      ? { sizeClassName: 'w-12 h-12 sm:w-16 sm:h-16', iconSize: 22 }
      : totalStamps >= 9
        ? { sizeClassName: 'w-14 h-14 sm:w-[4.5rem] sm:h-[4.5rem]', iconSize: 26 }
        : { sizeClassName: 'w-16 h-16 sm:w-20 sm:h-20', iconSize: 30 };
  }
  return totalStamps >= 13
    ? { sizeClassName: 'w-14 h-14 sm:w-16 sm:h-16', iconSize: 26 }
    : totalStamps >= 9
      ? { sizeClassName: 'w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem]', iconSize: 30 }
      : { sizeClassName: 'w-20 h-20 sm:w-20 sm:h-20', iconSize: 38 };
};

/**
 * Stamps that sit on top of earned ones as gifts (win-back 'gift' and game
 * 'bonus'), capped to what's actually on the card above the issue gift.
 * They're shown as the most recent slots.
 */
export const getLateGiftStamps = (history: Transaction[], stamps: number, bonusStamps: number) =>
  Math.min(
    history.reduce((sum, tx) => (tx.type === 'gift' || tx.type === 'bonus' ? sum + tx.amount : sum), 0),
    Math.max(stamps - bonusStamps, 0),
  );

/** True when slot `index` holds a gifted stamp (issue gift or late gift). */
export const isGiftedSlot = (index: number, stamps: number, bonusStamps: number, lateGiftStamps: number) =>
  index < bonusStamps || (index >= stamps - lateGiftStamps && index < stamps);

export interface StampGridLayout {
  /** Stamps per full row. */
  columns: number;
  /** 1-based grid line where the short last row starts (on a 2×columns track grid), or null when every row is full. */
  lastRowStart: number | null;
}

/**
 * Columns for the stamp grid, chosen so the last row is as full as possible
 * (9 → 3×3, 10 → 4+4+2, 7 → 4+3) instead of always 4 and an orphan stamp.
 * Up to 12 stamps only 3 or 4 columns: 5 slots at that size overflow a 390 px
 * phone. A short last row is centered: the grid has 2 tracks per column, every
 * slot spans 2, and the row's first slot starts `columns - remainder` tracks in.
 */
export const getStampGridLayout = (totalStamps: number): StampGridLayout => {
  const total = Math.max(1, Math.floor(totalStamps));
  if (total <= 4) return { columns: total, lastRowStart: null };
  const candidates = total > 12 ? [5, 4] : [4, 3];
  const fill = (c: number) => (total % c === 0 ? 1 : (total % c) / c);
  const columns = candidates.reduce((best, c) => (fill(c) > fill(best) ? c : best), candidates[0]!);
  const remainder = total % columns;
  return { columns, lastRowStart: remainder === 0 ? null : columns - remainder + 1 };
};

/** Inline styles for the grid container and slot `index` under {@link getStampGridLayout}. */
export const stampGridStyles = (totalStamps: number) => {
  const { columns, lastRowStart } = getStampGridLayout(totalStamps);
  const firstOfLastRow = totalStamps - (totalStamps % columns);
  return {
    container: { gridTemplateColumns: `repeat(${columns * 2}, minmax(0, 1fr))` } as const,
    slot: (index: number) =>
      lastRowStart !== null && index === firstOfLastRow
        ? { gridColumn: `${lastRowStart} / span 2` }
        : { gridColumn: 'span 2' },
  };
};
