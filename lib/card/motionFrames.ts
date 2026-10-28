// Keyframe builders for the public card's one-shot animations. Everything
// is precomputed into Web Animations keyframes (transform/opacity only), so
// the browser runs it on the compositor — no per-frame JS, no extra library.

export interface SpringOptions {
  stiffness: number;
  damping: number;
  mass?: number;
}

export interface Segment {
  ms: number;
  /** Keyframe at local progress t (0..1). */
  at: (t: number) => Keyframe;
}

const FRAME_MS = 1000 / 60;

/**
 * Simulates a spring from 0 to 1 (semi-implicit Euler, 1 ms steps) and
 * returns its position every frame until it settles. Underdamped springs
 * overshoot past 1 before resting.
 */
export const sampleSpring = ({ stiffness, damping, mass = 1 }: SpringOptions, maxMs = 1600): number[] => {
  let x = 0;
  let v = 0;
  const out = [0];
  let nextSample = FRAME_MS;
  for (let ms = 1; ms <= maxMs; ms++) {
    const a = (stiffness * (1 - x) - damping * v) / mass;
    v += a / 1000;
    x += v / 1000;
    if (ms >= nextSample) {
      out.push(x);
      nextSample += FRAME_MS;
      if (Math.abs(1 - x) < 0.002 && Math.abs(v) < 0.05) break;
    }
  }
  out[out.length - 1] = 1;
  return out;
};

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};

/** A segment driven by an easing curve. */
export const tween = (ms: number, curve: (t: number) => number, at: (p: number) => Keyframe): Segment => ({
  ms,
  at: (t) => at(curve(t)),
});

/** A segment driven by a spring; `at` gets the spring position (may overshoot 1). */
export const spring = (opts: SpringOptions, at: (p: number) => Keyframe): Segment => {
  const samples = sampleSpring(opts);
  const last = samples.length - 1;
  return {
    ms: last * FRAME_MS,
    at: (t) => {
      const f = t * last;
      const i = Math.min(last - 1, Math.floor(f));
      const p = samples[i]! + (samples[i + 1]! - samples[i]!) * (f - i);
      return at(p);
    },
  };
};

/** Holds a keyframe for `ms`. */
export const hold = (ms: number, frame: Keyframe): Segment => ({ ms, at: () => frame });

/**
 * Joins segments into one keyframe list with explicit offsets, sampled at
 * ~60 fps. Play it with `easing: 'linear'`.
 */
export const sequence = (segments: Segment[]): { keyframes: Keyframe[]; duration: number } => {
  const duration = segments.reduce((sum, s) => sum + s.ms, 0);
  if (duration <= 0) return { keyframes: [segments[0]?.at(1) ?? {}], duration: 0 };
  const keyframes: Keyframe[] = [];
  let start = 0;
  segments.forEach((segment, si) => {
    const steps = Math.max(1, Math.round(segment.ms / FRAME_MS));
    // The first segment includes t=0; later ones start after the shared boundary.
    for (let i = si === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps;
      keyframes.push({ ...segment.at(t), offset: Math.min(1, (start + t * segment.ms) / duration) });
    }
    start += segment.ms;
  });
  return { keyframes, duration };
};

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
