// OWNER: agent C (tactile grid). One full-viewport particle canvas for the
// whole public card. Listens to bus 'fx:burst' {x, y, kind, colors?} (any
// layer may emit it). This module (with canvas-confetti) is its own lazy
// chunk; confetti draws from a worker when OffscreenCanvas is supported.
import React, { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { mixHexColors } from '../../lib/color';
import { burstCount, rotateHue } from '../../lib/card/gridFx';
import type { FxBusEvents, FxTheme } from '../../lib/card/types';
import { useCardFx } from './CardFxContext';

type Burst = FxBusEvents['fx:burst'];
type Fire = confetti.CreateTypes;

const isHex = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

const giftPalette = (gift: string) =>
  isHex(gift) ? [gift, mixHexColors(gift, '#ffffff', 0.35), mixHexColors(gift, '#ffffff', 0.7), mixHexColors(gift, '#000000', 0.12)] : [gift];

const fireBurst = (fire: Fire, burst: Burst, theme: FxTheme) => {
  const origin = { x: burst.x / window.innerWidth, y: burst.y / window.innerHeight };
  const playful = theme.style === 'playful';
  const count = burstCount(burst.kind, theme.intensity);
  const palette = burst.colors?.length ? burst.colors : theme.particles;

  switch (burst.kind) {
    case 'tap':
      // Ink droplets: flat dots that pop out and fade fast.
      void fire({
        origin, particleCount: count, spread: 360, startVelocity: playful ? 15 : 11, decay: 0.86, gravity: 0.55,
        ticks: 55, scalar: playful ? 0.7 : 0.55, shapes: ['circle'], flat: true, colors: palette,
      });
      break;
    case 'gift':
      void fire({
        origin, particleCount: Math.round(count * 0.55), spread: 360, startVelocity: playful ? 18 : 14, decay: 0.87, gravity: 0.8,
        ticks: 80, scalar: 0.8, shapes: ['star'], colors: burst.colors?.length ? burst.colors : giftPalette(theme.giftAccent),
      });
      void fire({
        origin, particleCount: Math.round(count * 0.4), spread: 360, startVelocity: 12, decay: 0.87, gravity: 0.4,
        ticks: 70, scalar: 0.5, shapes: ['circle'], flat: true, colors: burst.colors?.length ? burst.colors : giftPalette(theme.giftAccent),
      });
      break;
    case 'slam':
      // Dust ring on impact: low, wide, mostly horizontal, slow to settle.
      void fire({
        origin, particleCount: count, spread: 360, startVelocity: 13, decay: 0.84, gravity: 0.25,
        ticks: 70, scalar: 0.6, shapes: ['circle'], flat: true, colors: palette,
      });
      break;
    case 'celebrate': {
      const colors = burst.colors?.length
        ? burst.colors
        : playful && isHex(theme.accent)
          ? [...palette, theme.giftAccent, rotateHue(theme.accent, 70), rotateHue(theme.accent, 150), rotateHue(theme.accent, 220)]
          : [...palette, theme.giftAccent];
      const common = { origin, colors, ticks: 220, gravity: 0.9, decay: 0.92, scalar: playful ? 1 : 0.85 };
      void fire({ ...common, particleCount: Math.round(count * 0.55), spread: 70, startVelocity: 42 });
      void fire({ ...common, particleCount: Math.round(count * 0.45), spread: 130, startVelocity: 30 });
      break;
    }
  }
};

export const ParticleLayer: React.FC = () => {
  const { bus, theme, reducedMotion } = useCardFx();
  // minimal: no particles at all (plan §5.0).
  const enabled = !reducedMotion && theme.style !== 'minimal';
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (!enabled) return;
    // Created imperatively (one fresh canvas per mount): an OffscreenCanvas can
    // only be transferred to the worker once, which StrictMode would trip.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100dvh', pointerEvents: 'none', zIndex: '80',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(canvas);

    const fire = confetti.create(canvas, { resize: true, useWorker: true, disableForReducedMotion: true });
    const off = bus.on('fx:burst', (burst) => fireBurst(fire, burst, themeRef.current));
    return () => {
      off();
      fire.reset();
      canvas.remove();
    };
  }, [bus, enabled]);

  return null;
};

export default ParticleLayer;
