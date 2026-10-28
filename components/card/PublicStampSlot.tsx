// OWNER: agent C (tactile grid). One stamp slot on the public card: the same
// look as the staff StampSlot (empty disc + dashed ring, filled disc + icon),
// built as layers so it can be pressed, inked, slammed and unwrapped.
// All motion is Web Animations on transform/opacity (compositor only).
import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Gift } from 'lucide-react';
import { cn, hexToRgba } from '../../lib/utils';
import { haptic } from '../../lib/card/haptics';
import { formatEarnedDate, giftBadgeRing, giftedCopy, originLabel, readableOn, remainingCopy, slotAriaLabel, withAlpha } from '../../lib/card/gridFx';
import { ease, hold, lerp, sequence, spring, tween } from '../../lib/card/motionFrames';
import type { SlotOrigin } from '../../lib/card/stampTimeline';
import type { FxBusEvents, FxTheme, SlotFxState } from '../../lib/card/types';
import type { StampGridContext } from '../LoyaltyCard';
import { useCardFx } from './CardFxContext';
import type { WrappedGiftHandle } from './WrappedGift';

const WrappedGiftFallback = React.forwardRef<WrappedGiftHandle, object>(() => null);

// Only cards with an unopened gift need it.
const WrappedGift = lazy(() => import('./WrappedGift').catch(() => ({ default: WrappedGiftFallback })));

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

type SlamKind = FxBusEvents['stamp:slam']['kind'];

/** Per-style feel: springs, amplitudes, which garnish is on. */
const feel = (theme: FxTheme) => {
  switch (theme.style) {
    case 'playful':
      return { squash: { stiffness: 420, damping: 9 }, wobble: 6, tapTilt: 7, ripple: true, slamScale: 1.9, slamRot: -18, impact: [1.16, 0.82] as const, settle: { stiffness: 520, damping: 13 } };
    case 'minimal':
      return { squash: { stiffness: 520, damping: 22 }, wobble: 3, tapTilt: 0, ripple: false, slamScale: 1.35, slamRot: -6, impact: [1.06, 0.94] as const, settle: { stiffness: 560, damping: 26 } };
    default:
      return { squash: { stiffness: 400, damping: 12.5 }, wobble: 4, tapTilt: 0, ripple: true, slamScale: 1.6, slamRot: -12, impact: [1.12, 0.87] as const, settle: { stiffness: 520, damping: 17 } };
  }
};

const canAnimate = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === 'function';

export interface SlotTooltipInput {
  index: number;
  anchor: DOMRect;
  title: string;
  detail?: string;
  ms: number;
}

export interface PublicStampSlotProps {
  index: number;
  ctx: StampGridContext;
  /** index < stamps (the data says this slot is earned). */
  earned: boolean;
  fxState: SlotFxState | undefined;
  /** Slam/unwrap already started locally: render inked even if still pending/wrapped. */
  forcedInk: boolean;
  setForcedInk: (index: number, value: boolean) => void;
  gifted: boolean;
  origin: SlotOrigin | undefined;
  isNext: boolean;
  almostThere: boolean;
  /** ms delay for the mount fill-in, or null for no mount animation. */
  mountDelay: number | null;
  pageVisible: boolean;
  showTooltip: (input: SlotTooltipInput) => void;
}

export const PublicStampSlot: React.FC<PublicStampSlotProps> = ({
  index, ctx, earned, fxState, forcedInk, setForcedInk, gifted, origin, isNext, almostThere, mountDelay, pageVisible, showTooltip,
}) => {
  const { theme, bus, reducedMotion: rm, registerSlot, trackInteraction, template } = useCardFx();
  const f = feel(theme);
  const Icon = ctx.icon;

  const wrapped = fxState === 'wrapped' && !forcedInk;
  const inked = earned && (!fxState || forcedInk);
  const [unwrapping, setUnwrapping] = useState(false);
  const [slam, setSlam] = useState<{ id: number; kind: SlamKind } | null>(null);
  const [badgePop, setBadgePop] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const faceRef = useRef<HTMLSpanElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const rippleRef = useRef<HTMLSpanElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const giftRef = useRef<WrappedGiftHandle>(null);
  const press = useRef<{ timer: number; x: number; y: number; anim: Animation | null } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    registerSlot(index, buttonRef.current);
    return () => registerSlot(index, null);
  }, [index, registerSlot]);

  const center = () => {
    const r = buttonRef.current?.getBoundingClientRect() ?? new DOMRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
  };

  // --- Mount: filled slots ink in one after another, icon rotates in. ---
  useLayoutEffect(() => {
    if (mountDelay === null || rm || !inked) return;
    const ink = inkRef.current;
    const icon = iconRef.current;
    if (!canAnimate(ink) || !canAnimate(icon)) return;
    const fill = sequence([spring({ stiffness: 360, damping: 19 }, (p) => ({ transform: `scale(${lerp(0.4, 1, p)})`, opacity: Math.min(1, p * 1.6) }))]);
    ink.animate(fill.keyframes, { duration: fill.duration, delay: mountDelay, easing: 'linear', fill: 'backwards' });
    const turn = sequence([spring({ stiffness: 300, damping: 16 }, (p) => ({ transform: `rotate(${lerp(-40, 0, p)}deg) scale(${lerp(0.6, 1, p)})` }))]);
    icon.animate(turn.keyframes, { duration: turn.duration, delay: mountDelay + 40, easing: 'linear', fill: 'backwards' });
    if (canAnimate(badgeRef.current)) {
      badgeRef.current.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.15)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 300, delay: mountDelay + 160, easing: 'ease-out', fill: 'backwards' });
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Next slot: soft breathing pulse; stronger glow when almost there. ---
  useEffect(() => {
    const face = faceRef.current;
    const glow = glowRef.current;
    if (!isNext || rm || !canAnimate(face) || !canAnimate(glow)) return;
    const breathe = face.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }], {
      duration: 1200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: 600,
    });
    const shine = glow.animate([{ opacity: almostThere ? 0.45 : 0 }, { opacity: 1 }], {
      duration: 1200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: 600,
    });
    if (!pageVisible) {
      breathe.pause();
      shine.pause();
    }
    return () => {
      breathe.cancel();
      shine.cancel();
    };
  }, [isNext, almostThere, rm, pageVisible]);

  // --- Bus: slam and unwrap targeted at this slot. ---
  useEffect(() => {
    const offSlam = bus.on('stamp:slam', ({ index: i, kind }) => {
      if (i !== index) return;
      setForcedInk(index, true);
      setSlam({ id: Date.now(), kind });
    });
    const offUnwrap = bus.on('gift:unwrap', ({ index: i }) => {
      if (i !== index) return;
      setUnwrapping(true);
    });
    return () => {
      offSlam();
      offUnwrap();
    };
  }, [bus, index, setForcedInk]);

  // Slam: the stamp drops from above, squashes on impact, kicks up dust.
  useLayoutEffect(() => {
    if (!slam) return;
    const ink = inkRef.current;
    const done = () => {
      setSlam(null);
      bus.emit('stamp:landed', { index });
    };
    if (rm || !canAnimate(ink)) {
      const t = window.setTimeout(done, 0);
      return () => window.clearTimeout(t);
    }
    const [sx, sy] = f.impact;
    const fallMs = 210;
    const giftLike = slam.kind === 'gift' || slam.kind === 'bonus' || slam.kind === 'welcome';
    const { keyframes, duration } = sequence([
      tween(fallMs, ease.inQuad, (p) => ({
        transform: `translateY(${lerp(-30, 0, p)}px) scale(${lerp(f.slamScale, 1, p)}) rotate(${lerp(f.slamRot, 0, p)}deg)`,
        opacity: Math.min(1, p * 2.2),
      })),
      tween(60, ease.outCubic, (p) => ({ transform: `scale(${lerp(1, sx, p)}, ${lerp(1, sy, p)})`, opacity: 1 })),
      spring(f.settle, (p) => ({ transform: `scale(${lerp(sx, 1, p)}, ${lerp(sy, 1, p)})`, opacity: 1 })),
    ]);
    const anims: Animation[] = [ink.animate(keyframes, { duration, easing: 'linear', fill: 'backwards' })];

    if (canAnimate(shadowRef.current)) {
      anims.push(shadowRef.current.animate(
        [{ opacity: 0, transform: 'scale(1.5)' }, { opacity: 0.5, transform: 'scale(1)', offset: fallMs / (fallMs + 300) }, { opacity: 0, transform: 'scale(1)' }],
        { duration: fallMs + 300, easing: 'ease-in' },
      ));
    }
    if (canAnimate(rippleRef.current)) {
      anims.push(rippleRef.current.animate(
        [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 0.6, transform: 'scale(0.95)' }, { opacity: 0, transform: 'scale(1.95)' }],
        { duration: 520, delay: fallMs, easing: 'cubic-bezier(.15,.7,.3,1)' },
      ));
    }
    // The paper gets pushed down a hair on impact.
    if (canAnimate(faceRef.current)) {
      anims.push(faceRef.current.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(2px) scale(0.98)', offset: 0.3 }, { transform: 'translateY(0)' }],
        { duration: 260, delay: fallMs, easing: 'ease-out' },
      ));
    }
    // Brand logo lands as the ink, then resolves to the campaign icon.
    const logoMs = template.logoImage && !giftLike ? 520 : 0;
    if (logoMs && canAnimate(logoRef.current) && canAnimate(iconRef.current)) {
      anims.push(logoRef.current.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: duration + logoMs, easing: 'ease-in', fill: 'both' }));
      const turn = sequence([
        hold(duration + logoMs * 0.45, { transform: 'rotate(-40deg) scale(0.6)', opacity: 0 }),
        spring({ stiffness: 320, damping: 16 }, (p) => ({ transform: `rotate(${lerp(-40, 0, p)}deg) scale(${lerp(0.6, 1, p)})`, opacity: Math.min(1, p * 2) })),
      ]);
      anims.push(iconRef.current.animate(turn.keyframes, { duration: turn.duration, easing: 'linear' }));
    }
    const impact = window.setTimeout(() => {
      const c = center();
      haptic('slam');
      bus.emit('fx:burst', { x: c.x, y: c.y, kind: 'slam', colors: giftLike ? [theme.giftAccent, ...theme.particles] : undefined });
    }, fallMs);
    const finished = window.setTimeout(done, duration + logoMs);
    return () => {
      window.clearTimeout(impact);
      window.clearTimeout(finished);
      anims.forEach((a) => a.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slam]);

  // Unwrap: lid pops, ribbon unties, the stamp inks in where the box was.
  useEffect(() => {
    if (!unwrapping) return;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      setForcedInk(index, true);
      setUnwrapping(false);
      setBadgePop(true);
      bus.emit('gift:unwrapped', { index });
    };
    if (rm || !giftRef.current) {
      haptic('gift');
      finish();
      return;
    }
    const gift = giftRef.current.unwrap();
    const burst = window.setTimeout(() => {
      const c = center();
      haptic('gift');
      bus.emit('fx:burst', { x: c.x, y: c.y - 4, kind: 'gift' });
    }, 200);
    let inkAnim: Animation | null = null;
    if (canAnimate(inkRef.current)) {
      const pop = sequence([spring({ stiffness: 380, damping: 14 }, (p) => ({ transform: `scale(${lerp(0.3, 1, p)})`, opacity: Math.min(1, p * 2) }))]);
      inkAnim = inkRef.current.animate(pop.keyframes, { duration: pop.duration, delay: 300, easing: 'linear', fill: 'backwards' });
    }
    void Promise.all([gift, inkAnim?.finished.catch(() => undefined)]).then(finish);
    return () => {
      cancelled = true;
      window.clearTimeout(burst);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unwrapping]);

  // Badge pops in after an unwrap.
  useLayoutEffect(() => {
    if (!badgePop || rm || !canAnimate(badgeRef.current)) return;
    const seq = sequence([spring({ stiffness: 500, damping: 14 }, (p) => ({ transform: `scale(${Math.max(0, p)})` }))]);
    badgeRef.current.animate(seq.keyframes, { duration: seq.duration, delay: 80, easing: 'linear', fill: 'backwards' });
    setBadgePop(false);
  }, [badgePop, rm]);

  // --- Tap feedback ---
  const squash = () => {
    const face = faceRef.current;
    if (rm || !canAnimate(face)) return;
    const tilt = f.tapTilt * (index % 2 === 0 ? 1 : -1);
    const { keyframes, duration } = sequence([
      tween(85, ease.outCubic, (p) => ({ transform: `scale(${lerp(1, 0.86, p)}) rotate(${lerp(0, tilt, p)}deg)` })),
      spring(f.squash, (p) => ({ transform: `scale(${lerp(0.86, 1, p)}) rotate(${lerp(tilt, 0, p)}deg)` })),
    ]);
    face.animate(keyframes, { duration, easing: 'linear' });
    if (f.ripple && canAnimate(rippleRef.current)) {
      rippleRef.current.animate(
        [{ opacity: 0.55, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.7)' }],
        { duration: 560, easing: 'cubic-bezier(.15,.7,.3,1)' },
      );
    }
  };

  const wobble = () => {
    const face = faceRef.current;
    if (rm || !canAnimate(face)) return;
    const a = f.wobble;
    face.animate(
      [0, -a, a, -a * 0.6, a * 0.3, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
      { duration: 420, easing: 'ease-out' },
    );
  };

  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (slam || unwrapping) return;
    const c = center();
    if (wrapped) {
      giftRef.current?.jiggle();
      haptic('tap');
      trackInteraction('gift_tap');
      bus.emit('gift:tap', { index });
      return;
    }
    if (inked) {
      squash();
      haptic('tap');
      trackInteraction('stamp_tap');
      bus.emit('fx:burst', { x: c.x, y: c.y, kind: 'tap' });
      if (gifted) {
        bus.emit('fx:burst', { x: c.x, y: c.y, kind: 'gift' });
        showTooltip({ index, anchor: c.rect, title: giftedCopy(origin?.type ?? null, template.name), ms: 1500 });
      }
      bus.emit('stamp:tap', { index, gifted });
      return;
    }
    wobble();
    haptic('tick');
    trackInteraction('stamp_tap_empty');
    showTooltip({ index, anchor: c.rect, title: remainingCopy(Math.max(1, ctx.totalStamps - ctx.stamps), template.rewardName), ms: 1500 });
    bus.emit('stamp:tap-empty', { index });
  };

  // --- Long-press a filled stamp: when and how it was earned. ---
  const cancelPress = (springBack: boolean) => {
    const p = press.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    p.anim?.cancel();
    press.current = null;
    if (springBack && !rm && canAnimate(faceRef.current)) {
      const back = sequence([spring(f.squash, (q) => ({ transform: `scale(${lerp(0.92, 1, q)})` }))]);
      faceRef.current.animate(back.keyframes, { duration: back.duration, easing: 'linear' });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!inked || slam || unwrapping || (e.pointerType === 'mouse' && e.button !== 0)) return;
    suppressClick.current = false;
    const anim = !rm && canAnimate(faceRef.current)
      ? faceRef.current.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }], { duration: LONG_PRESS_MS, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' })
      : null;
    // Short taps shouldn't feel the press-in; it only shows if the finger stays.
    anim?.pause();
    const reveal = window.setTimeout(() => anim?.play(), 120);
    const timer = window.setTimeout(() => {
      window.clearTimeout(reveal);
      const c = center();
      const when = origin?.timestamp ? formatEarnedDate(origin.timestamp) : null;
      const how = originLabel(origin?.type ?? null);
      showTooltip({
        index,
        anchor: c.rect,
        title: when ? `Obtenido el ${when}` : 'Sello obtenido',
        detail: how ?? undefined,
        ms: 2400,
      });
      haptic('tick');
      trackInteraction('stamp_longpress');
      suppressClick.current = true;
      cancelPress(true);
    }, LONG_PRESS_MS);
    press.current = { timer, x: e.clientX, y: e.clientY, anim };
    const clearReveal = () => window.clearTimeout(reveal);
    window.addEventListener('pointerup', clearReveal, { once: true });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) cancelPress(true);
  };

  const onPointerUp = () => {
    if (press.current) cancelPress(false);
  };

  useEffect(() => () => cancelPress(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Colors (all from the palette / fx theme) ---
  const ring = giftBadgeRing(theme);
  const emptyBorder = almostThere ? withAlpha(theme.accent, 0.7) : hexToRgba(ctx.colors.iconInactive, 0.5);
  const showInk = inked || unwrapping || !!slam;
  const label = slotAriaLabel({
    index,
    total: ctx.totalStamps,
    filled: inked,
    wrapped,
    timestamp: origin?.timestamp,
    type: origin?.type,
  });

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
      className={cn(
        'relative isolate flex select-none items-center justify-center rounded-full outline-none touch-manipulation',
        'focus-visible:ring-2 focus-visible:ring-offset-2',
        ctx.sizing.sizeClassName,
      )}
      style={{ WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none' } as React.CSSProperties}
    >
      {/* Glow behind empty slots (next one breathes; all glow when almost there). */}
      {!inked && !wrapped && (isNext || almostThere) && (
        <span
          ref={glowRef}
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full"
          style={{
            boxShadow: `0 0 0 2px ${withAlpha(theme.accent, almostThere ? 0.28 : 0.18)}, 0 0 ${almostThere ? 22 : 14}px ${almostThere ? 3 : 1}px ${withAlpha(theme.accent, almostThere ? 0.45 : 0.3)}`,
            opacity: rm || !isNext ? (almostThere ? 0.8 : 0.5) : undefined,
          }}
        />
      )}

      <span ref={faceRef} aria-hidden className="pointer-events-none relative flex h-full w-full items-center justify-center rounded-full">
        {/* Empty disc (always underneath; the ink lands on it). */}
        <span className="absolute inset-0 flex items-center justify-center rounded-full" style={{ backgroundColor: ctx.colors.stampInactive }}>
          {!wrapped && (
            <span className="absolute inset-0 rounded-full border-2 border-dashed" style={{ borderColor: emptyBorder, opacity: almostThere ? 0.9 : 0.5 }} />
          )}
          {!wrapped && (
            <span className="-rotate-12 scale-75">
              <Icon size={ctx.sizing.iconSize} strokeWidth={2} style={{ color: ctx.colors.iconInactive }} />
            </span>
          )}
        </span>

        {/* Shadow cast by a stamp in flight. */}
        <span ref={shadowRef} className="absolute inset-0 rounded-full opacity-0" style={{ boxShadow: `0 6px 14px -2px ${withAlpha(theme.accent, 0.6)}` }} />

        {/* Ink: the filled stamp. */}
        {showInk && (
          <span
            ref={inkRef}
            className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full"
            style={{
              backgroundColor: ctx.colors.stampActive,
              backgroundImage: `radial-gradient(circle at 32% 24%, ${withAlpha(theme.sheen.color, 0.26)} 0%, transparent 52%)`,
              boxShadow: `inset 0 -3px 6px rgba(0,0,0,0.16), inset 0 1.5px 2px ${withAlpha(theme.sheen.color, 0.22)}, 0 3px 10px -4px ${withAlpha(theme.accent, 0.7)}`,
            }}
          >
            <span ref={iconRef} className="flex">
              <Icon size={ctx.sizing.iconSize} strokeWidth={2.5} style={{ color: ctx.colors.iconActive }} />
            </span>
            {slam && template.logoImage && slam.kind !== 'gift' && slam.kind !== 'bonus' && slam.kind !== 'welcome' && (
              <img ref={logoRef} src={template.logoImage} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" />
            )}
          </span>
        )}

        {(wrapped || unwrapping) && (
          <Suspense fallback={null}>
            <WrappedGift ref={giftRef} theme={theme} seed={index} idle={pageVisible && !unwrapping} reducedMotion={rm} />
          </Suspense>
        )}
      </span>

      {/* Ink-ring ripple (tap) / dust ring (slam). */}
      <span
        ref={rippleRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border-2 opacity-0"
        style={{ borderColor: theme.accent }}
      />

      {gifted && inked && !unwrapping && (
        <span
          ref={badgeRef}
          aria-hidden
          className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 flex h-6 w-6 items-center justify-center rounded-full shadow-sm"
          style={{
            backgroundColor: theme.giftAccent,
            color: readableOn(theme.giftAccent),
            border: `2px solid ${ring.color}`,
            boxShadow: ring.close ? `0 0 0 1px ${withAlpha(theme.giftAccent, 0.9)}, 0 1px 3px rgba(0,0,0,0.25)` : undefined,
          }}
        >
          <Gift size={12} strokeWidth={2.5} />
        </span>
      )}
    </button>
  );
};
