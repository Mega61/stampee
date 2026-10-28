// OWNER: agent H. The weekly "Raspa y gana" on the card (§8.1, §8.1a):
// the foil ticket peeking from its pocket (available), the countdown chip
// (played), the matte locked ticket (no recent visit). Opening it plays the
// game and hands over to TicketOverlay. Lazy chunk, loaded by WeeklyTicket.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../../../lib/card/haptics';
import { withAlpha } from '../../../lib/card/gridFx';
import { playWeeklyGame } from '../../../lib/card/gameApi';
import { countdownAria, countdownParts, periodWeekNumber, ticketSerial } from '../../../lib/card/scratch';
import { usePageVisible } from '../../../lib/card/usePageVisible';
import type { PlayResult } from '../../../types';
import { useCardFx } from '../CardFxContext';
import { FoilView, foilPalette } from './foil';
import { FlapNumber } from './SplitFlap';
import { TicketFace, TicketGlyph, ticketMetrics } from './TicketFace';
import { TicketOverlay, type TicketOutcome } from './TicketOverlay';
import { getTuning, onTuningChange } from './tuning';

const PEEK = 0.42;
const RISE_KEYFRAMES = '@keyframes stampee-rise{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}';
const POCKET_TILT = 14;

/** Width of the opened ticket: ~85 % of the card column, capped. */
const openWidth = () => {
  if (typeof window === 'undefined') return 330;
  const column = Math.min(window.innerWidth, 436);
  return Math.round(Math.min(340, column * 0.86));
};

interface LocalPlayed {
  won: boolean;
  nextPlayAt: string;
  /** How the chip should enter. */
  entrance: 'tuck' | 'fade';
}

export const TicketExperience: React.FC = () => {
  const fx = useCardFx();
  const { game, theme, card, slug, trackInteraction, refresh } = fx;
  const tuning = useSyncExternalStore(onTuningChange, () => tuningKey(theme.style), () => tuningKey(theme.style));
  const t = useMemo(() => getTuning(theme.style), [theme.style, tuning]); // eslint-disable-line react-hooks/exhaustive-deps

  const [local, setLocal] = useState<LocalPlayed | null>(null);
  const [open, setOpen] = useState<null | { play: Promise<PlayResult>; origin: { left: number; top: number; width: number; peek: number; tiltDeg: number } }>(null);
  const [unfolding, setUnfolding] = useState(false);
  const pocketRef = useRef<HTMLButtonElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const prevState = useRef(game?.state);

  // Server catches up (refresh after a play) → drop the local override.
  useEffect(() => {
    if (!game) return;
    if (prevState.current === 'played' && game.state === 'available') setUnfolding(true);
    prevState.current = game.state;
    if (local && !open && game.state === 'played') setLocal(null);
  }, [game, local, open]);

  const kind = local ? 'played' : game?.state;
  const nextPlayAt = local?.nextPlayAt ?? game?.nextPlayAt ?? new Date().toISOString();
  const won = local ? local.won : !!game?.lastResult?.won;
  const week = periodWeekNumber(nextPlayAt);
  const serial = ticketSerial(card.uniqueId, week);
  const width = useMemo(openWidth, []);
  const metrics = useMemo(() => ticketMetrics(width), [width]);

  const onUnfolded = useCallback(() => setUnfolding(false), []);

  const onOpen = () => {
    if (open || !pocketRef.current) return;
    const r = pocketRef.current.getBoundingClientRect();
    haptic(8);
    trackInteraction('game-open');
    // Fired on tap: the 700 ms open hides the latency.
    const play = playWeeklyGame(slug, card.uniqueId);
    play.catch(() => {});
    setOpen({ play, origin: { left: r.left, top: r.top, width: r.width, peek: PEEK, tiltDeg: POCKET_TILT } });
  };

  const onDone = useCallback((outcome: TicketOutcome) => {
    setOpen(null);
    if (outcome.kind === 'error') {
      if (outcome.error.kind === 'unavailable') void refresh();
      return;
    }
    setLocal({ won: outcome.kind === 'won', nextPlayAt: outcome.result.nextPlayAt, entrance: outcome.kind === 'lost' ? 'tuck' : 'fade' });
    // Sync game state once the slam has played.
    window.setTimeout(() => void refresh(), 3500);
  }, [refresh]);

  // Week turns while open: ask the server; the chip unfolds into a ticket.
  useEffect(() => {
    if (kind !== 'played') return;
    const ms = Date.parse(nextPlayAt) - Date.now();
    if (!Number.isFinite(ms)) return;
    const id = window.setTimeout(() => {
      setLocal(null);
      void refresh();
    }, Math.max(1000, Math.min(ms + 1500, 2 ** 31 - 1)));
    return () => window.clearTimeout(id);
  }, [kind, nextPlayAt, refresh]);

  if (kind !== 'available' && kind !== 'played' && kind !== 'locked') return null;

  return (
    <div className="relative flex w-full flex-col items-center" data-weekly-ticket>
      {kind === 'played' ? (
        <CountdownChip
          ref={chipRef}
          won={won}
          nextPlayAt={nextPlayAt}
          entrance={local?.entrance ?? null}
          hidden={!!open}
        />
      ) : (
        <Pocket
          ref={pocketRef}
          metrics={metrics}
          week={week}
          serial={serial}
          locked={kind === 'locked'}
          hidden={!!open}
          unfolding={unfolding}
          onUnfolded={onUnfolded}
          onOpen={onOpen}
          sweepEveryMs={t.sweepEveryMs}
          sweepMs={t.sweepMs}
          floatPx={t.floatPx}
          holo={t.holo}
        />
      )}
      {open &&
        createPortal(
          <TicketOverlay
            origin={open.origin}
            anchorEl={pocketRef.current}
            metrics={metrics}
            week={week}
            serial={serial}
            play={open.play}
            tuning={t}
            getChipRect={() => chipRef.current?.getBoundingClientRect() ?? pocketRef.current?.getBoundingClientRect() ?? null}
            onDone={onDone}
          />,
          document.body,
        )}
      {/* While the overlay runs, the chip placeholder is laid out (hidden) so the tuck has a target. */}
      {open && kind !== 'played' && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 opacity-0" aria-hidden>
          <CountdownChip ref={chipRef} won={false} nextPlayAt={nextPlayAt} entrance={null} hidden />
        </div>
      )}
      <style>{RISE_KEYFRAMES}</style>
    </div>
  );
};

let tuningVersion = 0;
onTuningChange(() => {
  tuningVersion++;
});
const tuningKey = (style: string) => `${style}:${tuningVersion}`;

// ---- Pocket: the ticket peeking out of a slot in the card -----------------

interface PocketProps {
  metrics: ReturnType<typeof ticketMetrics>;
  week: number;
  serial: string;
  locked: boolean;
  hidden: boolean;
  unfolding: boolean;
  onUnfolded: () => void;
  onOpen: () => void;
  sweepEveryMs: number;
  sweepMs: number;
  floatPx: number;
  holo: boolean;
}

const Pocket = React.forwardRef<HTMLButtonElement, PocketProps>(function Pocket(
  { metrics: m, week, serial, locked, hidden, unfolding, onUnfolded, onOpen, sweepEveryMs, sweepMs, floatPx, holo },
  ref,
) {
  const { theme, template, reducedMotion } = useCardFx();
  const visible = usePageVisible();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const wobbleRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoilView | null>(null);
  const [bubble, setBubble] = useState(false);
  const minimal = theme.style === 'minimal';
  const textColor = template.colors.text;

  // Pocket size: the ticket scaled to fit the card column.
  const pocketW = Math.min(300, m.width);
  const s = pocketW / m.width;
  const visibleH = Math.round(m.height * s * PEEK);

  // Idle foil (not scratchable).
  useLayoutEffect(() => {
    if (locked || !canvasRef.current) return;
    const view = new FoilView(canvasRef.current, {
      width: m.windowW,
      height: m.windowH,
      palette: foilPalette(theme),
      flat: minimal,
      holo: holo && !reducedMotion,
      label: 'RASPA AQUÍ',
      pattern: !minimal,
      seed: week,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [locked, m, theme, minimal, holo, reducedMotion, week]);

  // Periodic light sweep + float, paused while hidden.
  useEffect(() => {
    if (locked || reducedMotion || !visible || hidden) return;
    const view = viewRef.current;
    const sweeper = sweepEveryMs > 0 ? window.setInterval(() => view?.sweep(sweepMs), sweepEveryMs) : 0;
    const first = sweepEveryMs > 0 ? window.setTimeout(() => view?.sweep(sweepMs), 700) : 0;
    const float = floatPx > 0
      ? floatRef.current?.animate(
          [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(0,${-floatPx}px,0)` }, { transform: 'translate3d(0,0,0)' }],
          { duration: 4000, iterations: Infinity, easing: 'ease-in-out' },
        )
      : undefined;
    return () => {
      window.clearInterval(sweeper);
      window.clearTimeout(first);
      float?.cancel();
    };
  }, [locked, reducedMotion, visible, hidden, sweepEveryMs, sweepMs, floatPx]);

  // Specular follows the finger over the pocket, and the phone's tilt on Android.
  useEffect(() => {
    if (locked || reducedMotion || minimal) return;
    const el = (ref as React.RefObject<HTMLButtonElement>)?.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      viewRef.current?.setTilt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const onLeave = () => viewRef.current?.setTilt(0, 0);
    let base: { b: number; g: number } | null = null;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      base.b += (e.beta - base.b) * 0.02;
      base.g += (e.gamma - base.g) * 0.02;
      viewRef.current?.setTilt(Math.max(-1, Math.min(1, (e.gamma - base.g) / 12)), Math.max(-1, Math.min(1, (e.beta - base.b) / 12)));
    };
    const DOE = (window as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent;
    const gyro = !!DOE && typeof DOE.requestPermission !== 'function' && window.matchMedia?.('(pointer: coarse)').matches;
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    if (gyro) window.addEventListener('deviceorientation', onOrient, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (gyro) window.removeEventListener('deviceorientation', onOrient);
    };
  }, [locked, reducedMotion, minimal, ref]);

  // A new week: the chip unfolds into a fresh ticket with a light sweep.
  useLayoutEffect(() => {
    if (!unfolding) return;
    const el = floatRef.current;
    if (!el || reducedMotion) {
      onUnfolded();
      return;
    }
    const a = el.animate(
      [{ transform: 'translate3d(0,40%,0) rotateX(-80deg) scale(.6)', opacity: 0 }, { transform: 'translate3d(0,-4%,0) rotateX(6deg) scale(1.02)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
      { duration: 760, easing: 'cubic-bezier(.2,.8,.3,1)' },
    );
    a.onfinish = () => {
      viewRef.current?.sweep(1000);
      onUnfolded();
    };
    return () => a.cancel();
  }, [unfolding, reducedMotion, onUnfolded]);

  const onClick = () => {
    if (!locked) {
      onOpen();
      return;
    }
    haptic(8);
    setBubble(true);
    if (!reducedMotion) {
      wobbleRef.current?.animate(
        [{ transform: 'rotate(0)' }, { transform: 'rotate(-3.5deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(1deg)' }, { transform: 'rotate(0)' }],
        { duration: 520, easing: 'ease-out' },
      );
    }
  };
  useEffect(() => {
    if (!bubble) return;
    const id = window.setTimeout(() => setBubble(false), 3200);
    return () => window.clearTimeout(id);
  }, [bubble]);

  const lip = withAlpha(textColor, theme.surface === 'dark' ? 0.22 : 0.16);

  return (
    <div className="relative flex flex-col items-center">
      {bubble && (
        <div
          role="status"
          className="absolute bottom-full z-10 mb-3 w-max max-w-[230px] rounded-2xl px-4 py-2 text-center text-[13px] font-medium leading-snug shadow-lg"
          style={{ backgroundColor: theme.bubble.bg, color: theme.bubble.fg, animation: reducedMotion ? undefined : 'stampee-rise .3s cubic-bezier(.2,.8,.3,1) both' }}
        >
          Visítanos para activar tu raspa y gana
        </div>
      )}
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={locked ? 'Raspa y gana bloqueado. Visítanos para activarlo.' : 'Abrir tu raspa y gana de la semana'}
        className="relative block outline-none focus-visible:ring-2"
        style={{ width: pocketW, height: visibleH, perspective: 700, WebkitTapHighlightColor: 'transparent' }}
      >
        {/* The ticket, clipped by the slot. */}
        <div className="absolute inset-x-[-12px] top-[-16px] bottom-0 overflow-hidden" style={{ visibility: hidden ? 'hidden' : 'visible' }}>
          <div ref={floatRef} style={{ position: 'absolute', left: 12, top: 16 + 4, transformStyle: 'preserve-3d' }}>
            <div ref={wobbleRef} style={{ transformOrigin: '50% 100%' }}>
              <div style={{ width: m.width, transform: `scale(${s}) rotateX(${reducedMotion ? 0 : POCKET_TILT}deg)`, transformOrigin: '0 0' }}>
                <TicketFace
                  theme={theme}
                  template={template}
                  metrics={m}
                  week={week}
                  serial={serial}
                  matte={locked}
                  shadow={0.6}
                  window={<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />}
                />
              </div>
            </div>
          </div>
          {/* Shade where the ticket enters the slot (over the ticket only). */}
          <div className="pointer-events-none absolute bottom-0 h-8 rounded-b-md" style={{ left: 12, width: pocketW, background: `linear-gradient(180deg, transparent, ${withAlpha('#000000', theme.surface === 'dark' ? 0.3 : 0.12)})` }} />
        </div>
        {/* The slot lip. */}
        <div
          aria-hidden
          className="absolute left-[-14px] right-[-14px] rounded-full"
          style={{
            bottom: -5,
            height: 9,
            backgroundColor: lip,
            boxShadow: `inset 0 2px 3px ${withAlpha('#000000', 0.35)}, 0 1px 0 ${withAlpha('#ffffff', theme.surface === 'dark' ? 0.08 : 0.6)}`,
          }}
        />
      </button>
      <p className="mt-3 text-xs font-medium tracking-wide" style={{ color: withAlpha(textColor, 0.6) }}>
        {locked ? 'Visítanos para activarlo' : 'Toca para raspar'}
      </p>
    </div>
  );
});

// ---- Countdown chip -----------------------------------------------------------

interface ChipProps {
  won: boolean;
  nextPlayAt: string;
  entrance: 'tuck' | 'fade' | null;
  hidden: boolean;
}

const CountdownChip = React.forwardRef<HTMLDivElement, ChipProps>(function CountdownChip({ won, nextPlayAt, entrance, hidden }, ref) {
  const { theme, template, reducedMotion } = useCardFx();
  const visible = usePageVisible();
  const [now, setNow] = useState(() => Date.now());
  const innerRef = useRef<HTMLDivElement>(null);
  const target = Date.parse(nextPlayAt);

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    // Tick on the minute boundary.
    let id = 0;
    const schedule = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 50;
      id = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(id);
  }, [visible]);

  useLayoutEffect(() => {
    if (hidden || !entrance || reducedMotion) return;
    const el = innerRef.current;
    const a = entrance === 'tuck'
      ? el?.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1.05)', offset: 0.45 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' })
      : el?.animate([{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'ease-out' });
    return () => a?.cancel();
  }, [hidden, entrance, reducedMotion]);

  const { days, hours, minutes } = countdownParts(target, now);
  const text = template.colors.text;
  const flap = { face: text, ink: template.colors.background?.startsWith('#') ? template.colors.background : theme.bubble.bg };

  return (
    <div ref={ref} className="flex flex-col items-center" style={{ visibility: hidden ? 'hidden' : 'visible' }}>
      <div
        ref={innerRef}
        className="flex items-center gap-3 rounded-2xl border px-3.5 py-2.5"
        style={{ color: text, backgroundColor: withAlpha(text, theme.surface === 'dark' ? 0.08 : 0.05), borderColor: withAlpha(text, 0.1) }}
        role="timer"
        aria-label={`${won ? 'Esta semana ganaste 1 sello. ' : 'Esta semana no fue. '}Próximo raspa y gana en ${countdownAria(target, now)}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: theme.accent, color: theme.ink, boxShadow: `0 0 0 3px ${withAlpha(theme.giftAccent, won ? 0.55 : 0)}` }}>
          <TicketGlyph size={18} />
        </span>
        <span className="flex min-w-0 flex-col items-start" aria-hidden>
          <span className="whitespace-nowrap text-[13px] font-semibold leading-tight">Próximo raspa y gana</span>
          <span className="whitespace-nowrap text-[11px] font-medium opacity-70">{won ? 'Esta semana ganaste 1 sello ✨' : 'Esta semana no fue 💛'}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold" aria-hidden>
          {days > 0 && (
            <>
              <FlapNumber value={days} width={1} colors={flap} reduced={reducedMotion} h={22} />
              <span className="mr-0.5 text-[11px] opacity-60">d</span>
            </>
          )}
          <FlapNumber value={hours} colors={flap} reduced={reducedMotion} h={22} />
          <span className="mr-0.5 text-[11px] opacity-60">h</span>
          <FlapNumber value={minutes} colors={flap} reduced={reducedMotion} h={22} />
          <span className="text-[11px] opacity-60">m</span>
        </span>
      </div>
    </div>
  );
});

export default TicketExperience;
