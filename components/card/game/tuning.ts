// Every timing, spring and particle value of the scratch experiences, per
// fxStyle (docs/CARD_ENGAGEMENT_PLAN.md §8.1a). The /dev/ticket playground
// overrides them live; production only ever reads the defaults.
import type { FxStyle } from '../../../types';

export interface Spring {
  stiffness: number;
  damping: number;
}

export interface TicketTuning {
  // Idle
  sweepEveryMs: number;
  sweepMs: number;
  floatPx: number;
  holo: boolean;
  // Open
  openMs: number;
  openSpring: Spring;
  openTiltDeg: number;
  backdropBlurPx: number;
  cardScale: number;
  // Scratch
  brushPx: number;
  grainPx: number;
  autoCompletePct: number;
  scratchAllDelayMs: number;
  flakesPer100px: number;
  flakeMax: number;
  flakeGravity: number;
  flakeSpin: number;
  // Shatter
  shatterMs: number;
  shardCols: number;
  shardSpeed: number;
  // Win
  winIconDelayMs: number;
  winWordsDelayMs: number;
  winWordStaggerMs: number;
  winShockwaveScale: number;
  winFlightDelayMs: number;
  flightMs: number;
  flightArc: number;
  flightBounce: boolean;
  trailSparkles: number;
  winBurst: 'theme' | 'confetti' | 'none';
  // Lose
  loseFoldDelayMs: number;
  foldMs: number;
  tuckMs: number;
}

const BASE: TicketTuning = {
  sweepEveryMs: 4000,
  sweepMs: 1300,
  floatPx: 3,
  holo: false,
  openMs: 700,
  openSpring: { stiffness: 210, damping: 20 },
  openTiltDeg: 25,
  backdropBlurPx: 8,
  cardScale: 0.96,
  brushPx: 30,
  grainPx: 40,
  autoCompletePct: 0.55,
  scratchAllDelayMs: 2000,
  flakesPer100px: 9,
  flakeMax: 60,
  flakeGravity: 1500,
  flakeSpin: 9,
  shatterMs: 450,
  shardCols: 7,
  shardSpeed: 520,
  winIconDelayMs: 150,
  winWordsDelayMs: 450,
  winWordStaggerMs: 110,
  winShockwaveScale: 2.6,
  winFlightDelayMs: 1400,
  flightMs: 620,
  flightArc: 0.28,
  flightBounce: false,
  trailSparkles: 26,
  winBurst: 'theme',
  loseFoldDelayMs: 1600,
  foldMs: 560,
  tuckMs: 520,
};

export const DEFAULT_TUNING: Record<FxStyle, TicketTuning> = {
  elegant: { ...BASE },
  playful: {
    ...BASE,
    sweepEveryMs: 2600,
    sweepMs: 900,
    holo: true,
    openSpring: { stiffness: 260, damping: 16 },
    flakesPer100px: 16,
    flakeSpin: 16,
    shardSpeed: 680,
    winShockwaveScale: 3.4,
    flightArc: 0.36,
    flightBounce: true,
    trailSparkles: 40,
    winBurst: 'confetti',
  },
  minimal: {
    ...BASE,
    sweepEveryMs: 0,
    floatPx: 0,
    openSpring: { stiffness: 300, damping: 30 },
    openTiltDeg: 12,
    flakesPer100px: 0,
    flakeMax: 0,
    shatterMs: 260,
    shardCols: 0,
    trailSparkles: 0,
    winBurst: 'none',
  },
};

type Listener = () => void;
let overrides: Partial<Record<FxStyle, Partial<TicketTuning>>> = {};
const listeners = new Set<Listener>();

export const getTuning = (style: FxStyle): TicketTuning => ({ ...DEFAULT_TUNING[style], ...overrides[style] });

/** Dev playground only. */
export const setTuningOverride = (style: FxStyle, patch: Partial<TicketTuning> | null) => {
  overrides = { ...overrides, [style]: patch ? { ...overrides[style], ...patch } : undefined };
  listeners.forEach((l) => l());
};

export const onTuningChange = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
