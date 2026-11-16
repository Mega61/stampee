// Advent calendar on the back of the public card. Shapes mirror
// docs/ADVENT_CONTRACT.md (GET/POST /public/cards/:slug/:id/advent…) exactly;
// change them there first.
import type { GiftCardEffectiveStatus, GiftCardSource } from '../db/giftCards';

export type AdventDoorState = 'locked' | 'ready' | 'opened' | 'missed';
export type AdventRewardKind = 'coupon' | 'bonus_stamps' | 'double_stamps' | 'link' | 'gift_card';
export type AdventRewardStatus = 'available' | 'redeemed' | 'expired' | 'transferred';

export interface AdventReward {
  id: string;
  doorNo: number;
  /** The number painted on the door (2, 4 … 24). */
  dayLabel: number;
  kind: AdventRewardKind;
  title: string;
  subtitle: string;
  /** The gift's own lines (gift_card: the gift card's own `terms`). */
  terms: string[];
  /** 'GB-XXXX' for coupons; null otherwise. */
  code: string | null;
  /** 'expired' is computed on read by the API. */
  status: AdventRewardStatus;
  /** YYYY-MM-DD, Bogotá calendar days. */
  validFrom: string | null;
  validTo: string | null;
  openedAt: string;
  /** kind 'link'. */
  url: string | null;
  /** bonus_stamps: stamps given (0 if the NEARLY_FULL guard stopped it). */
  stamps: number | null;
  /** kind 'gift_card': match it in `AdventState.giftCards`. */
  giftCardId: string | null;
}

export interface AdventDoor {
  no: number;
  dayLabel: number;
  unlockAt: string;
  flashUntil: string | null;
  state: AdventDoorState;
  /** Only when state === 'opened' (contents never leave the API before). */
  reward: AdventReward | null;
}

/**
 * A gift card in "Mis regalos" (api/src/lib/giftCards.ts → CustomerGiftCard).
 * `locked`: matched only by the phone typed on the gift page, so the code and
 * the link are withheld until the studio confirms the recipient.
 */
interface CustomerGiftCardBase {
  id: string;
  amountCop: number;
  tierName: string;
  effectiveStatus: GiftCardEffectiveStatus;
  funded: boolean;
  source: GiftCardSource;
  buyerFirstName: string;
  recipientName: string | null;
  message: string;
  validFrom: string | null;
  validTo: string | null;
  minTicketCop: number | null;
  transferable: boolean;
  terms: string[];
}

export type CustomerGiftCard =
  | (CustomerGiftCardBase & {
      code: string;
      uniqueId: string;
      publicUrl: string | null;
      role: 'buyer' | 'recipient';
      locked: false;
    })
  | (CustomerGiftCardBase & {
      code: null;
      uniqueId: null;
      publicUrl: null;
      role: 'recipient';
      locked: true;
      lockedHint: string;
    });

export interface AdventState {
  /** The client keeps an offset from this; it never trusts its own clock. */
  serverNow: string;
  year: number;
  /** false → the board renders locked ("Tu calendario te espera"). */
  eligible: boolean;
  opensUntil: string;
  commonTerms: string[];
  /** Sorted by `no`. */
  doors: AdventDoor[];
  nextUnlockAt: string | null;
  /** Doors the customer can open right now (front badge). */
  readyCount: number;
  /** Opened, newest first ("Mis regalos"). */
  rewards: AdventReward[];
  giftCards: CustomerGiftCard[];
}

export interface AdventOpenResult {
  reward: AdventReward;
  state: AdventState;
  /** Set when stamps changed (bonus_stamps), so the front updates without a refetch. */
  card: { uniqueId: string; stamps: number } | null;
}

/** Why an open failed: the API's 409/403 reasons, or the network. */
export type AdventOpenFailure = 'NOT_YET' | 'CLOSED' | 'NOT_ELIGIBLE' | 'NOT_FOUND' | 'NETWORK';

export class AdventOpenError extends Error {
  readonly reason: AdventOpenFailure;
  constructor(reason: AdventOpenFailure, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'AdventOpenError';
  }
}

/**
 * What the back face needs. `useAdvent` builds it from the API; /dev/advent
 * builds it from mock scenarios.
 */
export interface AdventController {
  /** null while loading, and when there is no calendar (404 ADVENT_OFF). */
  state: AdventState | null;
  loading: boolean;
  /** Server time in ms (Date.now() + offset from `serverNow`). */
  now: () => number;
  /** POST …/doors/:no/open. Resolves without applying; call `apply` when the reveal ends. */
  openDoor: (no: number) => Promise<AdventOpenResult>;
  /** Puts a state returned by `openDoor` on screen. */
  apply: (state: AdventState) => void;
  refresh: () => Promise<void>;
}
