// Physical-card flip (docs/ADVENT_PLAN.md §5.1): the public card turns over
// horizontally to show its back (the advent calendar).
//
// - The card follows the finger (rotation = dx / width × 180°) and, on
//   release, springs to the face the gesture points to: past 35 % of a half
//   turn, or a quick flick.
// - `touch-action: pan-y` plus an axis lock after 8 px: a vertical drag keeps
//   scrolling the front (and its slide to Historial), and a tap stays a tap on
//   stamps, the QR button and doors. Anything under `[data-no-flip]` (the
//   scratch ticket, the gifts list) never starts a flip.
// - Tilt pauses while dragging and while the back shows.
// - One-time peek (the card turns ~28° and back) the first time a calendar
//   exists, remembered in localStorage.
// - Reduced motion: a crossfade instead of a turn; buttons still work.
import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTiltPause } from './TiltSurface';

const AXIS_LOCK_PX = 8;
const FLIP_THRESHOLD = 0.35;
const FLICK_PX_PER_MS = 0.45;
const SPRING_K = 160;
const SPRING_C = 22;

export const peekKey = (year: number) => `stampee:advent-peek:${year}`;

const readFlag = (key: string) => {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return true; // storage blocked: don't peek on every visit
  }
};
const writeFlag = (key: string) => {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // private mode: fine
  }
};

export interface CardFlipProps {
  front: React.ReactNode;
  /** null: no back face, no flip (no calendar). */
  back: React.ReactNode | null;
  flipped: boolean;
  onFlippedChange: (flipped: boolean) => void;
  reducedMotion: boolean;
  /** localStorage key of the one-time peek; null skips it. */
  peekStorageKey: string | null;
  /** The peek played (the front's "Voltea tu tarjeta" chip pulses with it). */
  onPeek?: () => void;
  className?: string;
}

export const CardFlip: React.FC<CardFlipProps> = ({ front, back, flipped, onFlippedChange, reducedMotion, peekStorageKey, onPeek, className }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const flipperRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const ry = useRef(flipped ? 180 : 0);
  const side = useRef(flipped);
  const spring = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setTiltPaused = useTiltPause();
  const hasBack = back !== null;
  const turning = hasBack && !reducedMotion;

  const callbacks = useRef({ onFlippedChange, onPeek });
  callbacks.current = { onFlippedChange, onPeek };

  const setRY = useCallback((v: number) => {
    ry.current = v;
    if (flipperRef.current) flipperRef.current.style.transform = `rotateY(${v}deg)`;
  }, []);

  const springTo = useCallback(
    (target: number, v0 = 0) => {
      cancelAnimationFrame(spring.current);
      let x = ry.current;
      let v = v0;
      let last = performance.now();
      const step = (t: number) => {
        const dt = Math.min(0.032, (t - last) / 1000);
        last = t;
        v += (-SPRING_K * (x - target) - SPRING_C * v) * dt;
        x += v * dt;
        setRY(x);
        if (Math.abs(x - target) < 0.2 && Math.abs(v) < 0.5) {
          setRY(target);
          return;
        }
        spring.current = requestAnimationFrame(step);
      };
      spring.current = requestAnimationFrame(step);
    },
    [setRY],
  );

  // The hidden face is inert: no focus, no screen reader.
  useLayoutEffect(() => {
    const hide = (el: HTMLElement | null, hidden: boolean) => {
      if (!el) return;
      if (hidden) {
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
      } else {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
    };
    hide(frontRef.current, hasBack && flipped);
    hide(backRef.current, !flipped);
  }, [flipped, hasBack]);

  // Buttons (chip, badge, "volver") flip through `flipped`; a drag already
  // moved the card, so only animate when the side really changed.
  useEffect(() => {
    setTiltPaused?.(hasBack && flipped);
    if (!turning) {
      cancelAnimationFrame(spring.current);
      side.current = flipped;
      setRY(0);
      return;
    }
    if (side.current === flipped) return;
    side.current = flipped;
    springTo(flipped ? 180 : 0);
  }, [flipped, turning, hasBack, springTo, setRY, setTiltPaused]);

  // Turning switched on (reduced motion toggled off): sit on the current side.
  useEffect(() => {
    if (turning) setRY(side.current ? 180 : 0);
  }, [turning, setRY]);

  // Drag to flip.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !turning) return;
    let drag: { id: number; x: number; y: number; base: number; axis: 'x' | 'y' | null; hist: Array<[number, number]> } | null = null;
    let suppressClick = false;

    const onDown = (e: PointerEvent) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if ((e.target as Element | null)?.closest?.('[data-no-flip], [data-weekly-ticket]')) return;
      if (document.querySelector('.adv-ov')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, base: side.current ? 180 : 0, axis: null, hist: [[e.clientX, performance.now()]] };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (drag.axis === 'y') return;
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {
          // pointer already gone
        }
        cancelAnimationFrame(spring.current);
        if (settle.current) clearTimeout(settle.current);
        setTiltPaused?.(true);
      }
      if (drag.axis !== 'x') return;
      e.preventDefault();
      setRY(drag.base + (dx / stage.offsetWidth) * 180);
      drag.hist.push([e.clientX, performance.now()]);
      if (drag.hist.length > 6) drag.hist.shift();
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (d.axis !== 'x') return;
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 60);
      const [x0, t0] = d.hist[0]!;
      const [x1, t1] = d.hist[d.hist.length - 1]!;
      const vel = (x1 - x0) / Math.max(1, t1 - t0); // px per ms
      const w = stage.offsetWidth;
      const moved = ry.current - d.base;
      const flip = Math.abs(moved) > 180 * FLIP_THRESHOLD || Math.abs(vel) > FLICK_PX_PER_MS;
      const back = flip ? !side.current : side.current;
      // Land on the face the gesture points to, in its own direction.
      const dir = Math.sign(moved || vel) || 1;
      side.current = back;
      springTo(flip ? d.base + dir * 180 : d.base, ((vel * 1000) / w) * 180 * 0.35);
      // Normalise after landing so the next drag starts from 0 / 180.
      settle.current = setTimeout(() => {
        if (!drag) {
          cancelAnimationFrame(spring.current);
          setRY(back ? 180 : 0);
        }
      }, 900);
      setTiltPaused?.(back);
      callbacks.current.onFlippedChange(back);
    };
    // A drag is not a tap: swallow the click it would end with.
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
    };

    stage.addEventListener('pointerdown', onDown, { passive: true });
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp, { passive: true });
    stage.addEventListener('pointercancel', onUp, { passive: true });
    stage.addEventListener('click', onClick, true);
    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('click', onClick, true);
      if (settle.current) clearTimeout(settle.current);
      cancelAnimationFrame(spring.current);
    };
  }, [turning, springTo, setRY, setTiltPaused]);

  // One-time peek, the first time the card has a back.
  useEffect(() => {
    if (!turning || !peekStorageKey || readFlag(peekStorageKey)) return;
    const t = setTimeout(() => {
      const el = flipperRef.current;
      if (!el || side.current || ry.current !== 0) return;
      writeFlag(peekStorageKey);
      el.animate(
        [{ transform: 'rotateY(0)' }, { transform: 'rotateY(-28deg)', offset: 0.45 }, { transform: 'rotateY(4deg)', offset: 0.8 }, { transform: 'rotateY(0)' }],
        { duration: 1300, easing: 'cubic-bezier(.45,0,.2,1)' },
      );
      callbacks.current.onPeek?.();
    }, 1100);
    return () => clearTimeout(t);
  }, [turning, peekStorageKey]);

  if (!hasBack) return <div className={className}>{front}</div>;

  const faceBase: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
  };
  const crossfade = (shown: boolean): React.CSSProperties =>
    reducedMotion ? { transition: 'opacity .35s ease', opacity: shown ? 1 : 0, pointerEvents: shown ? undefined : 'none' } : {};

  return (
    <div
      ref={stageRef}
      className={className}
      style={{ position: 'relative', perspective: 1500, touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <div
        ref={flipperRef}
        style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: turning ? `rotateY(${ry.current}deg)` : 'none', willChange: turning ? 'transform' : undefined }}
      >
        <div ref={frontRef} style={{ ...faceBase, ...crossfade(!flipped) }}>
          {front}
        </div>
        <div ref={backRef} style={{ ...faceBase, transform: turning ? 'rotateY(180deg)' : 'none', ...crossfade(flipped) }}>
          {back}
        </div>
      </div>
    </div>
  );
};
