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
