import { describe, expect, it } from 'vitest';
import {
  burstCount,
  formatEarnedDate,
  giftBadgeRing,
  giftedCopy,
  hueDistance,
  placeBubble,
  remainingCopy,
  slotAriaLabel,
} from './gridFx';
import { ease, sampleSpring, sequence, spring, tween } from './motionFrames';

describe('copy', () => {
  it('formats dates es-CO style', () => {
    const now = new Date(2026, 9, 28).getTime();
    expect(formatEarnedDate(new Date(2026, 9, 12).getTime(), now)).toBe('12 de oct.');
    expect(formatEarnedDate(new Date(2025, 0, 3).getTime(), now)).toBe('3 de ene. 2025');
  });

  it('builds aria labels', () => {
    const ts = new Date(new Date().getFullYear(), 9, 12).getTime();
    expect(slotAriaLabel({ index: 2, total: 10, filled: true, timestamp: ts, type: 'stamp_add' })).toBe('Sello 3 de 10, obtenido el 12 de oct.');
    expect(slotAriaLabel({ index: 6, total: 10, filled: false })).toBe('Sello 7 de 10, pendiente');
    expect(slotAriaLabel({ index: 0, total: 8, filled: true, timestamp: ts, type: 'bonus' })).toBe('Sello 1 de 8, obtenido el 12 de oct., sello de la suerte');
    expect(slotAriaLabel({ index: 1, total: 8, filled: false, wrapped: true })).toBe('Sello 2 de 8, regalo sin abrir');
  });

  it('pluralizes the remaining tooltip', () => {
    expect(remainingCopy(1, 'café')).toBe('Te falta 1 para tu café');
    expect(remainingCopy(4, 'café')).toBe('Te faltan 4 para tu café');
    expect(giftedCopy('gift', 'Golden')).toBe('Regalo de Golden');
    expect(giftedCopy('bonus', 'Golden')).toBe('Sello de la suerte');
  });
});

describe('colors', () => {
  it('measures hue distance and flags gold-on-gold badges', () => {
    expect(hueDistance('#ff0000', '#00ffff')).toBeCloseTo(180);
    expect(hueDistance('#f5b301', '#f0a500')).toBeLessThan(10);
    expect(giftBadgeRing({ accent: '#e0a800', ink: '#111111', giftAccent: '#f5b301' })).toEqual({ close: true, color: '#111111' });
    expect(giftBadgeRing({ accent: '#1e3a8a', ink: '#ffffff', giftAccent: '#f5b301' }).close).toBe(false);
  });
});

describe('layout', () => {
  it('keeps bubbles inside the viewport', () => {
    expect(placeBubble(195, 100, 390)).toEqual({ left: 145, arrowX: 50 });
    expect(placeBubble(20, 120, 390).left).toBe(12);
    expect(placeBubble(385, 120, 390).left).toBe(258);
    expect(placeBubble(385, 120, 390).arrowX).toBe(106);
  });

  it('scales particle counts by intensity', () => {
    expect(burstCount('tap', 0.25)).toBe(8);
    expect(burstCount('tap', 1)).toBe(12);
    expect(burstCount('tap', 0.6)).toBeGreaterThanOrEqual(9);
  });
});

describe('motion frames', () => {
  it('samples an underdamped spring that overshoots and settles at 1', () => {
    const s = sampleSpring({ stiffness: 380, damping: 12 });
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBe(1);
    expect(Math.max(...s)).toBeGreaterThan(1.2);
  });

  it('joins segments with monotonic offsets', () => {
    const { keyframes, duration } = sequence([
      tween(100, ease.outCubic, (p) => ({ opacity: p })),
      spring({ stiffness: 300, damping: 20 }, (p) => ({ opacity: 1 - p })),
    ]);
    expect(duration).toBeGreaterThan(100);
    const offsets = keyframes.map((k) => k.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBeCloseTo(1);
    offsets.slice(1).forEach((o, i) => expect(o).toBeGreaterThanOrEqual(offsets[i]!));
  });
});
