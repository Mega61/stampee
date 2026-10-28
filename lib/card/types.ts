// Contracts for the animated public card ("card fx"). Shared by every agent
// working on docs/CARD_ENGAGEMENT_PLAN.md — change only with care.
import type { CardVariant, FxStyle, GameState, IssuedCard, Template } from '../../types';

export interface FxTheme {
  style: FxStyle;
  /** Effective luminance under the stamps. */
  surface: 'light' | 'dark';
  /** stampActive. */
  accent: string;
  /** iconActive. */
  ink: string;
  /** 4–6 particle colors derived from accent/ink. */
  particles: string[];
  /** Gift color (gold by default; swapped when it clashes with accent). */
  giftAccent: string;
  sheen: { color: string; alpha: number; blend: 'soft-light' | 'overlay' };
  /** Tooltip / toast colors, contrast ≥ 4.5:1. */
  bubble: { bg: string; fg: string };
  /** 0..1: scales particle counts, tilt range, durations. */
  intensity: number;
  /** Background image is busy (high luma variance) → tone effects down. */
  busyBackground: boolean;
}

/** One thing that changed on the card since the client last looked. */
export interface NewStampEvent {
  /** Transaction id (stable; used to acknowledge). */
  id: string;
  kind: 'stamp' | 'gift' | 'bonus' | 'welcome';
  amount: number;
  /** Slot indexes this event filled, ascending. */
  slots: number[];
  timestamp: number;
}

/** Temporary visual state of a slot while a moment plays. */
export type SlotFxState = 'pending' | 'wrapped';

export type FxBusEvents = {
  /** A filled slot was tapped. */
  'stamp:tap': { index: number; gifted: boolean };
  /** An empty slot was tapped. */
  'stamp:tap-empty': { index: number };
  /** Play the slam animation on a slot (the grid listens). */
  'stamp:slam': { index: number; kind: NewStampEvent['kind'] };
  /** The slam finished landing on a slot. */
  'stamp:landed': { index: number };
  /** Reward scratch reveal finished. */
  'reward:revealed': Record<string, never>;
  /** A wrapped (unopened gift) slot was tapped. */
  'gift:tap': { index: number };
  /** Play the unwrap animation on a wrapped slot (the grid listens). */
  'gift:unwrap': { index: number };
  /** Unwrap finished; the slot now shows its stamp. */
  'gift:unwrapped': { index: number };
  /** Particle burst at viewport coordinates (the particle layer listens). */
  'fx:burst': { x: number; y: number; kind: 'tap' | 'gift' | 'slam' | 'celebrate'; colors?: string[] };
};

// Division of labor (Wave 1/2):
// - The grid (agent C) owns slot visuals: tap feedback, the slam itself
//   ('stamp:slam' → 'stamp:landed'), the wrapped look and the unwrap itself
//   ('gift:unwrap' → 'gift:unwrapped'), and the particle layer ('fx:burst').
// - The moments layer (agent E) owns sequencing: which slots play when,
//   banners/toasts, clearing slotStates, acknowledging events.

export interface FxBus {
  emit<K extends keyof FxBusEvents>(type: K, payload: FxBusEvents[K]): void;
  on<K extends keyof FxBusEvents>(type: K, handler: (payload: FxBusEvents[K]) => void): () => void;
}

export interface CardFxContextValue {
  slug: string;
  card: IssuedCard;
  customerName: string;
  template: Template;
  theme: FxTheme;
  reducedMotion: boolean;
  variant: CardVariant;
  /** Count a meaningful interaction for the engagement beacon. */
  trackInteraction: (kind?: string) => void;

  /** Unacknowledged changes since last visit, oldest first. */
  newStampEvents: NewStampEvent[];
  /** Mark events as seen once their animation has played. */
  acknowledge: (eventIds: string[]) => void;
  rewardRevealed: boolean;
  markRewardRevealed: () => void;

  /** Per-slot temporary state (pending slam / wrapped gift). */
  slotStates: Record<number, SlotFxState>;
  setSlotState: (index: number, state: SlotFxState | null) => void;
  /** Grid registers slot elements so other layers can target them. */
  registerSlot: (index: number, el: HTMLElement | null) => void;
  getSlotRect: (index: number) => DOMRect | null;
  bus: FxBus;

  game: GameState | null;
  /** Refetch the card (and game state). */
  refresh: () => Promise<void>;
  /** Optimistic local card update (e.g. after a game win). */
  applyCardUpdate: (patch: Partial<IssuedCard>) => void;
}
