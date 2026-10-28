// Tiny vibration wrapper for the public card (plan §5.2). Android Chrome
// vibrates; iOS Safari has no Vibration API and silently no-ops (accepted).
// Browsers also ignore vibrate() until the page has had a user gesture.

export const HAPTICS = {
  /** Light tick: long-press fired, counter steps. */
  tick: 8,
  /** Tap on a stamp. */
  tap: 12,
  /** A stamp lands (thud, rebound). */
  slam: [0, 30, 40, 20],
  /** A gift opens. */
  gift: [0, 16, 50, 26],
  /** Card completed / reward revealed. */
  success: [0, 20, 70, 30, 50, 60],
} satisfies Record<string, VibratePattern>;

export type HapticName = keyof typeof HAPTICS;

const prefersReducedMotion = () => {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
};

export const haptic = (pattern: HapticName | VibratePattern) => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // Before the first tap Chrome blocks the call and logs a console error.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate(typeof pattern === 'string' ? HAPTICS[pattern] : pattern);
  } catch {
    // Some embedded webviews throw instead of ignoring.
  }
};
