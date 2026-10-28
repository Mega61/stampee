// OWNER: agent C (tactile grid). An unopened gift sitting in a stamp slot
// (slotStates[i] === 'wrapped'): small box in the stamp color with a
// giftAccent ribbon and bow, a gentle idle wiggle, and the unwrap itself.
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mixHexColors } from '../../lib/color';
import { giftBadgeRing } from '../../lib/card/gridFx';
import { ease, lerp, sequence, spring, tween } from '../../lib/card/motionFrames';
import type { FxTheme } from '../../lib/card/types';

export interface WrappedGiftHandle {
  /** Plays the unwrap; resolves when the box is gone. */
  unwrap: () => Promise<void>;
  /** Small "yes, that's a gift" jiggle on tap. */
  jiggle: () => void;
}

const isHex = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const shade = (hex: string, target: string, w: number) => (isHex(hex) ? mixHexColors(hex, target, w) : hex);

export const WrappedGift = forwardRef<WrappedGiftHandle, {
  theme: FxTheme;
  /** Staggers idle wiggles between gifts. */
  seed: number;
  idle: boolean;
  reducedMotion: boolean;
}>(({ theme, seed, idle, reducedMotion }, ref) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const lidRef = useRef<SVGGElement>(null);
  const bowLeftRef = useRef<SVGPathElement>(null);
  const bowRightRef = useRef<SVGPathElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const idleAnim = useRef<Animation | null>(null);

  // Pops in (it arrives as its own small chunk, so make that look intended).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || reducedMotion || typeof el.animate !== 'function') return;
    const pop = sequence([spring({ stiffness: 380, damping: 15 }, (p) => ({ transform: `scale(${lerp(0.5, 1, p)})`, opacity: Math.min(1, p * 2) }))]);
    el.animate(pop.keyframes, { duration: pop.duration, easing: 'linear', composite: 'add' as CompositeOperation });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle wiggle: still most of the time, a short shake every few seconds.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || reducedMotion || !idle || typeof el.animate !== 'function') return;
    const amp = theme.style === 'playful' ? 9 : theme.style === 'minimal' ? 0 : 6;
    if (amp === 0) return;
    const anim = el.animate(
      [
        { transform: 'rotate(0deg) translateY(0)', offset: 0 },
        { transform: 'rotate(0deg) translateY(0)', offset: 0.78 },
        { transform: `rotate(${-amp}deg) translateY(-2px)`, offset: 0.82 },
        { transform: `rotate(${amp * 0.8}deg) translateY(-2px)`, offset: 0.86 },
        { transform: `rotate(${-amp * 0.5}deg) translateY(-1px)`, offset: 0.9 },
        { transform: `rotate(${amp * 0.25}deg) translateY(0)`, offset: 0.94 },
        { transform: 'rotate(0deg) translateY(0)', offset: 1 },
      ],
      { duration: 3800, iterations: Infinity, delay: 900 + (seed % 4) * 700, easing: 'ease-in-out' },
    );
    idleAnim.current = anim;
    return () => {
      anim.cancel();
      idleAnim.current = null;
    };
  }, [idle, reducedMotion, seed, theme.style]);

  useImperativeHandle(ref, () => ({
    jiggle() {
      const el = rootRef.current;
      if (!el || reducedMotion || typeof el.animate !== 'function') return;
      const amp = theme.style === 'playful' ? 12 : 8;
      const { keyframes, duration } = sequence([
        tween(70, ease.outCubic, (p) => ({ transform: `scale(${lerp(1, 0.9, p)}) rotate(${lerp(0, -amp, p)}deg)` })),
        spring({ stiffness: 420, damping: 10 }, (p) => ({ transform: `scale(${lerp(0.9, 1, p)}) rotate(${lerp(-amp, 0, p)}deg)` })),
      ]);
      el.animate(keyframes, { duration, easing: 'linear', composite: 'add' as CompositeOperation });
    },
    unwrap() {
      const els = [rootRef.current, lidRef.current, bowLeftRef.current, bowRightRef.current, bodyRef.current];
      if (els.some((el) => !el) || reducedMotion || typeof rootRef.current!.animate !== 'function') return Promise.resolve();
      idleAnim.current?.cancel();
      const [root, lid, bowL, bowR, body] = els as [HTMLDivElement, SVGGElement, SVGPathElement, SVGPathElement, SVGGElement];
      const opts = (duration: number, delay = 0): KeyframeAnimationOptions => ({ duration, delay, easing: 'linear', fill: 'forwards' });
      // 1. Anticipation: the box squats and trembles.
      const squat = sequence([
        tween(140, ease.inOutSine, (p) => ({ transform: `scale(${lerp(1, 1.08, p)}, ${lerp(1, 0.9, p)}) rotate(${Math.sin(p * Math.PI * 4) * 4}deg)` })),
        tween(90, ease.outCubic, (p) => ({ transform: `scale(${lerp(1.08, 0.94, p)}, ${lerp(0.9, 1.12, p)})` })),
      ]);
      root.animate(squat.keyframes, opts(squat.duration));
      // 2. Bow unties (loops swing out), lid pops off with a spring arc.
      const t0 = squat.duration - 40;
      bowL.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(-6px,-3px) rotate(-55deg) scale(0.4)', opacity: 0 }], { duration: 260, delay: t0, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
      bowR.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(6px,-3px) rotate(55deg) scale(0.4)', opacity: 0 }], { duration: 260, delay: t0, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
      const lidArc = sequence([
        tween(380, ease.outCubic, (p) => ({
          transform: `translate(${lerp(0, 9, p)}px, ${-Math.sin(p * Math.PI * 0.85) * 22}px) rotate(${lerp(0, 38, p)}deg)`,
          opacity: p < 0.55 ? 1 : lerp(1, 0, (p - 0.55) / 0.45),
        })),
      ]);
      lid.animate(lidArc.keyframes, opts(lidArc.duration, t0));
      // 3. The box drops away while the stamp inks in underneath.
      const sink = body.animate(
        [{ transform: 'none', opacity: 1 }, { transform: 'translateY(4px) scale(0.6)', opacity: 0 }],
        { duration: 240, delay: t0 + 90, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' },
      );
      return sink.finished.then(() => undefined, () => undefined);
    },
  }), [reducedMotion, theme.style]);

  const box = theme.accent;
  const boxLight = shade(box, '#ffffff', 0.14);
  const boxDark = shade(box, '#000000', 0.18);
  const ribbon = theme.giftAccent;
  const ribbonDark = shade(ribbon, '#000000', 0.22);
  const ribbonLight = shade(ribbon, '#ffffff', 0.35);
  // Gold ribbon on a gold-ish box: outline the ribbon so it still reads.
  const outline = giftBadgeRing(theme).close ? { stroke: theme.ink, strokeOpacity: 0.55, strokeWidth: 0.9 } : {};

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ transformOrigin: '50% 85%' }}>
      <svg viewBox="0 0 48 48" className="h-[86%] w-[86%] overflow-visible drop-shadow-[0_3px_4px_rgba(0,0,0,0.22)]">
        <g ref={bodyRef} style={{ transformOrigin: '24px 32px', transformBox: 'view-box' }}>
          <rect x="10" y="21" width="28" height="21" rx="3.5" fill={box} />
          <rect x="10" y="21" width="28" height="4" fill={boxDark} opacity="0.55" />
          <rect x="21.5" y="21" width="5" height="21" fill={ribbon} {...outline} />
          <rect x="21.5" y="21" width="1.4" height="21" fill={ribbonLight} opacity="0.7" />
          <rect x="12.5" y="27" width="3" height="11" rx="1.5" fill="#ffffff" opacity="0.14" />
        </g>
        <g ref={lidRef} style={{ transformOrigin: '24px 18px', transformBox: 'view-box' }}>
          <rect x="7.5" y="14.5" width="33" height="8" rx="2.5" fill={boxLight} />
          <rect x="21.5" y="14.5" width="5" height="8" fill={ribbon} {...outline} />
          <path
            ref={bowLeftRef}
            d="M24 15.2 C 20.5 7.5, 11.5 7.8, 14 13.2 C 15.2 15.6, 20 15.6, 24 15.2 Z"
            fill={ribbon}
            stroke={ribbonDark}
            strokeWidth="0.8"
            {...outline}
            style={{ transformOrigin: '24px 15px', transformBox: 'view-box' }}
          />
          <path
            ref={bowRightRef}
            d="M24 15.2 C 27.5 7.5, 36.5 7.8, 34 13.2 C 32.8 15.6, 28 15.6, 24 15.2 Z"
            fill={ribbon}
            stroke={ribbonDark}
            strokeWidth="0.8"
            {...outline}
            style={{ transformOrigin: '24px 15px', transformBox: 'view-box' }}
          />
          <circle cx="24" cy="14.8" r="2.6" fill={ribbonDark} />
          <circle cx="23.3" cy="14" r="0.9" fill={ribbonLight} opacity="0.8" />
        </g>
      </svg>
    </div>
  );
});
WrappedGift.displayName = 'WrappedGift';

export default WrappedGift;
