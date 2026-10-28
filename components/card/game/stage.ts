// Stage helpers shared by the scratch overlays: find the card frame behind
// (to scale it), the element that scrolls the card, waits that die with the
// component, and spring keyframes.
import { sampleSpring } from '../../../lib/card/motionFrames';
import type { Spring } from './tuning';

/** The public card frame: nearest ancestor that clips and fills most of the viewport. */
export const findCardFrame = (from: HTMLElement | null): HTMLElement | null => {
  let el = from?.parentElement ?? null;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (cs.overflow === 'hidden' && el.clientHeight >= window.innerHeight * 0.6) return el;
    el = el.parentElement;
  }
  return null;
};

/** The element that scrolls the card (falls back to the document). */
export const findScroller = (from: HTMLElement | null): HTMLElement => {
  let el = from?.parentElement ?? null;
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
};

/** Scrolls so `rect` is comfortably inside the viewport. Returns the delta applied. */
export const revealRect = (scroller: HTMLElement, rect: DOMRect, margin = 90) => {
  const vh = window.innerHeight;
  let delta = 0;
  if (rect.top < margin) delta = rect.top - margin * 1.6;
  else if (rect.bottom > vh - margin) delta = rect.bottom - vh + margin * 1.6;
  if (delta !== 0) scroller.scrollBy({ top: delta, behavior: 'smooth' });
  return delta;
};

export const rectCenter = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** setTimeout as a promise that never resolves once `alive()` is false. */
export const makeWait = (alive: () => boolean) => (ms: number) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) {
      if (alive()) resolve();
      return;
    }
    window.setTimeout(() => {
      if (alive()) resolve();
    }, ms);
  });

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Keyframes for a spring from 0 to 1 time-scaled into `duration`: the shape
 * (overshoot, settle) comes from the spring, the length from the tuning.
 */
export const springKeyframes = (spring: Spring, build: (p: number) => Keyframe, steps = 36): Keyframe[] => {
  const samples = sampleSpring({ stiffness: spring.stiffness, damping: spring.damping });
  const last = samples.length - 1;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const f = (i / steps) * last;
    const j = Math.min(last - 1, Math.floor(f));
    const p = last <= 0 ? 1 : samples[j]! + (samples[j + 1]! - samples[j]!) * (f - j);
    return { ...build(i === steps ? 1 : p), offset: i / steps };
  });
};

export const finished = (a: Animation | undefined | null) => (a ? a.finished.then(() => undefined, () => undefined) : Promise.resolve());
