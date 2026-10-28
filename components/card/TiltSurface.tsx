// OWNER: agent C (tactile grid). Tilt + sheen + background parallax (§5.3).
//
// Contract: the outer surface wraps the whole card and sets the CSS custom
// properties --fx-parallax-x / --fx-parallax-y (px) consumed by LoyaltyCard's
// background layer. `TiltFront` wraps the front-slide content (tilt + sheen).
//
// Input: pointer position over the card (mouse hover, or a finger resting /
// dragging on it) and, on Android only, a subtle idle tilt from
// `deviceorientation` (iOS needs a permission prompt; skipped). One rAF loop
// springs toward the target and stops once settled. Listeners are passive and
// nothing captures the pointer, so taps on stamps and the QR button are
// untouched. Off for `minimal`, reduced motion and while the tab is hidden.
import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { usePageVisible } from '../../lib/card/usePageVisible';
import { withAlpha } from '../../lib/card/gridFx';
import { useCardFx } from './CardFxContext';

interface FrontHandle {
  el: HTMLElement;
  sheen: HTMLElement;
}

const TiltContext = createContext<{ register: (front: FrontHandle | null) => void } | null>(null);

const PARALLAX_PX = 6;
const ORIENTATION_DEG = 3;
const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

export const TiltSurface: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const { theme, reducedMotion, template, trackInteraction } = useCardFx();
  const visible = usePageVisible();
  const ref = useRef<HTMLDivElement>(null);
  const front = useRef<FrontHandle | null>(null);
  const enabled = !reducedMotion && theme.style !== 'minimal' && visible;
  const parallax = !!template.backgroundImage && (template.backgroundOpacity ?? 100) < 95;
  const maxDeg = 8 * Math.min(1, Math.max(0, theme.intensity));
  const trackRef = useRef(trackInteraction);
  trackRef.current = trackInteraction;

  const api = useMemo(() => ({ register: (f: FrontHandle | null) => { front.current = f; } }), []);

  useEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    const write = (x: number, y: number) => {
      const mag = Math.min(1, Math.hypot(x, y));
      const rest = mag < 0.002;
      surface.style.setProperty('--fx-parallax-x', parallax && !rest ? `${(-x * PARALLAX_PX).toFixed(2)}px` : '0px');
      surface.style.setProperty('--fx-parallax-y', parallax && !rest ? `${(-y * PARALLAX_PX).toFixed(2)}px` : '0px');
      const f = front.current;
      if (!f) return;
      if (rest) {
        // Back to a flat, crisp layer at rest.
        f.el.style.transform = '';
        f.el.style.willChange = '';
        f.sheen.style.opacity = '0';
        return;
      }
      f.el.style.willChange = 'transform';
      f.el.style.transform = `perspective(1000px) rotateX(${(-y * maxDeg).toFixed(3)}deg) rotateY(${(x * maxDeg).toFixed(3)}deg)`;
      f.sheen.style.transform = `translate3d(${(-x * 22).toFixed(2)}%, ${(-y * 12).toFixed(2)}%, 0)`;
      f.sheen.style.opacity = Math.min(1, mag * 1.25).toFixed(3);
    };
    if (!enabled) {
      write(0, 0);
      return;
    }

    const target = { x: 0, y: 0 };
    const orient = { x: 0, y: 0 };
    const cur = { x: 0, y: 0, vx: 0, vy: 0 };
    let pointer: { id: number; x: number; y: number } | null = null;
    let rect = surface.getBoundingClientRect();
    let raf = 0;
    let last = 0;
    let tracked = false;

    const step = (now: number) => {
      const dt = Math.min(0.032, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      const tx = pointer ? target.x : orient.x;
      const ty = pointer ? target.y : orient.y;
      // Spring: soft follow while touching, a little overshoot on release.
      const k = 140;
      const c = 15;
      cur.vx += (k * (tx - cur.x) - c * cur.vx) * dt;
      cur.vy += (k * (ty - cur.y) - c * cur.vy) * dt;
      cur.x += cur.vx * dt;
      cur.y += cur.vy * dt;
      const settled = Math.abs(tx - cur.x) < 0.001 && Math.abs(ty - cur.y) < 0.001 && Math.abs(cur.vx) < 0.01 && Math.abs(cur.vy) < 0.01;
      if (settled) {
        cur.x = tx;
        cur.y = ty;
        cur.vx = cur.vy = 0;
      }
      write(cur.x, cur.y);
      raf = settled ? 0 : requestAnimationFrame(step);
      if (settled) last = 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };

    // A finger dips the card where it rests (gentler than hover, so taps
    // don't jolt it); a mouse just hovers.
    const aim = (clientX: number, clientY: number, gain = 0.9) => {
      target.x = clamp((clientX - (rect.left + rect.width / 2)) / (rect.width / 2)) * gain;
      target.y = clamp((clientY - (rect.top + rect.height / 2)) / (rect.height / 2)) * gain;
      kick();
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      rect = surface.getBoundingClientRect();
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      aim(e.clientX, e.clientY, 0.55);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
        aim(e.clientX, e.clientY);
        return;
      }
      if (!pointer || pointer.id !== e.pointerId) return;
      if (!tracked && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 16) {
        tracked = true;
        trackRef.current('tilt');
      }
      aim(e.clientX, e.clientY, 0.75);
    };
    const onUp = (e: PointerEvent) => {
      if (pointer && pointer.id !== e.pointerId) return;
      pointer = null;
      kick();
    };
    const onEnter = () => {
      rect = surface.getBoundingClientRect();
    };

    // Android idle tilt. Baseline follows slowly so any holding angle is "flat".
    let base: { beta: number; gamma: number } | null = null;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { beta: e.beta, gamma: e.gamma };
      base.beta += (e.beta - base.beta) * 0.02;
      base.gamma += (e.gamma - base.gamma) * 0.02;
      const scale = maxDeg > 0 ? Math.min(1, ORIENTATION_DEG / maxDeg) : 0;
      orient.x = clamp((e.gamma - base.gamma) / 15) * scale;
      orient.y = clamp(-(e.beta - base.beta) / 15) * scale;
      if (!pointer) kick();
    };
    const DOE = typeof window !== 'undefined' ? (window as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent : undefined;
    const useGyro = !!DOE && typeof DOE.requestPermission !== 'function' && window.matchMedia?.('(pointer: coarse)').matches;

    const opts: AddEventListenerOptions = { passive: true };
    surface.addEventListener('pointerdown', onDown, opts);
    surface.addEventListener('pointermove', onMove, opts);
    surface.addEventListener('pointerenter', onEnter, opts);
    surface.addEventListener('pointerleave', onUp, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('pointercancel', onUp, opts);
    window.addEventListener('resize', onEnter, opts);
    if (useGyro) window.addEventListener('deviceorientation', onOrientation, opts);

    return () => {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerenter', onEnter);
      surface.removeEventListener('pointerleave', onUp);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onEnter);
      if (useGyro) window.removeEventListener('deviceorientation', onOrientation);
      cancelAnimationFrame(raf);
      write(0, 0);
    };
  }, [enabled, maxDeg, parallax]);

  return (
    <TiltContext.Provider value={api}>
      <div ref={ref} className={className} style={{ '--fx-parallax-x': '0px', '--fx-parallax-y': '0px' } as React.CSSProperties}>
        {children}
      </div>
    </TiltContext.Provider>
  );
};

export const TiltFront: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const tilt = useContext(TiltContext);
  const { theme, reducedMotion } = useCardFx();
  const ref = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const enabled = !!tilt && !reducedMotion && theme.style !== 'minimal';

  useEffect(() => {
    if (!enabled || !ref.current || !sheenRef.current) return;
    tilt!.register({ el: ref.current, sheen: sheenRef.current });
    return () => tilt!.register(null);
  }, [enabled, tilt]);

  if (!enabled) return <>{children}</>;

  const { color, alpha, blend } = theme.sheen;
  return (
    // Same box as the front content it wraps (w-full max-w-lg, above the
    // background layers), so the layout is unchanged.
    <div ref={ref} className="relative z-10 flex w-full max-w-lg flex-col items-center" style={{ touchAction: 'pan-y' }}>
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-[10%] -inset-y-[6%] z-20 overflow-hidden"
        style={{
          // Fades to nothing before the edges, so the light never shows a seam.
          WebkitMaskImage: 'radial-gradient(closest-side, #000 45%, transparent 100%)',
          maskImage: 'radial-gradient(closest-side, #000 45%, transparent 100%)',
        }}
      >
        <div
          ref={sheenRef}
          className="absolute -left-1/2 top-0 h-full w-[200%]"
          style={{
            opacity: 0,
            mixBlendMode: blend,
            backgroundImage: `linear-gradient(115deg, transparent 38%, ${withAlpha(color, alpha * 0.6)} 46%, ${withAlpha(color, alpha)} 50%, ${withAlpha(color, alpha * 0.6)} 54%, transparent 62%)`,
          }}
        />
      </div>
    </div>
  );
};
