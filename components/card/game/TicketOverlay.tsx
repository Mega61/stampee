// The opened ticket (§8.1a): lift from the pocket to the center, card dims
// and blurs behind, scratch, shatter, then the win (bloom → pop → words →
// orb flight into the next slot) or the no-win (heart → message → fold →
// tuck into the countdown chip). Rendered in a portal over the card frame.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { haptic } from '../../../lib/card/haptics';
import { withAlpha } from '../../../lib/card/gridFx';
import {
  arcControl,
  easeInOutCubic,
  quadPoint,
  type Point,
} from '../../../lib/card/scratch';
import type { PlayResult } from '../../../types';
import { PlayError } from '../../../lib/card/gameApi';
import { useCardFx } from '../CardFxContext';
import { foilPalette } from './foil';
import { FlakeField } from './flakes';
import { ScratchFoil } from './ScratchFoil';
import { TicketBack, TicketFace, ticketColors, type TicketMetrics } from './TicketFace';
import type { TicketTuning } from './tuning';
import { finished, findCardFrame, findScroller, makeWait, nextFrame, rectCenter, revealRect, springKeyframes } from './stage';

export type TicketOutcome =
  | { kind: 'won' | 'lost'; result: PlayResult }
  | { kind: 'error'; error: PlayError };

type Phase = 'opening' | 'waiting' | 'ready' | 'revealed' | 'win' | 'lose' | 'fold' | 'out' | 'error';

export interface TicketOverlayProps {
  /** Where the ticket peeks from (client px) and how much of it shows. */
  origin: { left: number; top: number; width: number; peek: number; tiltDeg: number };
  anchorEl: HTMLElement | null;
  metrics: TicketMetrics;
  week: number;
  serial: string;
  play: Promise<PlayResult>;
  tuning: TicketTuning;
  /** Countdown chip position, for the tuck. */
  getChipRect: () => DOMRect | null;
  onDone: (outcome: TicketOutcome) => void;
}

const WIN_WORDS = ['¡Ganaste', '1', 'sello!'];

export const TicketOverlay: React.FC<TicketOverlayProps> = ({ origin, anchorEl, metrics: m, week, serial, play, tuning, getChipRect, onDone }) => {
  const fx = useCardFx();
  const { theme, template, bus, reducedMotion } = fx;
  const reduced = reducedMotion;
  const minimal = theme.style === 'minimal';
  const colors = ticketColors(theme);
  const Icon = template.icon;

  const [phase, setPhase] = useState<Phase>('opening');
  const [result, setResult] = useState<PlayResult | null>(null);
  const [showAll, setShowAll] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prizeRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const heartRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const foldRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);

  const foilRef = useRef<ScratchFoil | null>(null);
  const fieldRef = useRef<FlakeField | null>(null);
  const frameAnim = useRef<Animation | null>(null);
  const frameEl = useRef<HTMLElement | null>(null);
  const aliveRef = useRef(true);
  const wait = useRef(makeWait(() => aliveRef.current)).current;
  const stampsBefore = useRef(fx.card.stamps);
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const resultRef = useRef<PlayResult | null>(null);
  const openedRef = useRef(false);
  const doneRef = useRef(false);

  const finish = useCallback((outcome: TicketOutcome) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(outcome);
  }, [onDone]);

  // ---- Stage: backdrop + card frame scale -------------------------------
  const dimCard = useCallback((on: boolean, ms: number) => {
    backdropRef.current?.animate([{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration: ms, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    const frame = frameEl.current;
    if (!frame || reduced) return;
    const from = on ? 'none' : `scale(${tuning.cardScale})`;
    const to = on ? `scale(${tuning.cardScale})` : 'none';
    frameAnim.current?.cancel();
    frameAnim.current = frame.animate([{ transform: from }, { transform: to }], { duration: ms, easing: 'cubic-bezier(.3,.7,.3,1)', fill: on ? 'forwards' : 'none' });
  }, [reduced, tuning.cardScale]);

  // ---- Mount: foil, flakes, open --------------------------------------
  useLayoutEffect(() => {
    aliveRef.current = true;
    const root = rootRef.current!;
    frameEl.current = findCardFrame(anchorEl);
    const field = new FlakeField(root, 6);
    field.gravity = tuning.flakeGravity;
    field.maxFlakes = reduced ? 0 : tuning.flakeMax;
    field.setSpin(tuning.flakeSpin);
    fieldRef.current = field;

    const foil = new ScratchFoil(canvasRef.current!, {
      width: m.windowW,
      height: m.windowH,
      palette: foilPalette(theme),
      flat: minimal,
      holo: tuning.holo && !reduced,
      label: 'RASPA AQUÍ',
      pattern: !minimal,
      seed: week,
      brushPx: tuning.brushPx,
      grainPx: tuning.grainPx,
      autoCompletePct: tuning.autoCompletePct,
      flakesPer100px: tuning.flakesPer100px,
      shardCols: tuning.shardCols,
      shardSpeed: tuning.shardSpeed,
      shatterMs: tuning.shatterMs,
      flakeSpin: tuning.flakeSpin,
      reduced,
      field,
      onFirstScratch: () => fxRef.current.trackInteraction('game-scratch'),
      onComplete: () => setPhase('revealed'),
    });
    foilRef.current = foil;

    // Open: FLIP from the pocket to the center.
    const mover = moverRef.current!;
    const final = mover.getBoundingClientRect();
    const s = origin.width / m.width;
    const dx = origin.left - final.left;
    const dy = origin.top - final.top;
    if (reduced) {
      mover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    } else {
      const tilt = tuning.openTiltDeg;
      mover.animate(
        springKeyframes(tuning.openSpring, (p) => ({
          transform: `translate3d(${dx * (1 - p)}px, ${dy * (1 - p)}px, 0) scale(${s + (1 - s) * p}) rotateX(${tilt * (1 - p)}deg)`,
        })),
        { duration: tuning.openMs, easing: 'linear', fill: 'backwards' },
      );
      const hidden = Math.round((1 - origin.peek) * 100);
      ticketRef.current?.animate(
        [{ clipPath: `inset(0 0 ${hidden}% 0)` }, { clipPath: 'inset(0 0 0% 0)' }],
        { duration: tuning.openMs * 0.42, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' },
      );
    }
    dimCard(true, reduced ? 220 : tuning.openMs * 0.85);

    let shimmer = 0;
    const arm = () => {
      if (!aliveRef.current || !resultRef.current || !openedRef.current || foil.done) return;
      window.clearInterval(shimmer);
      foil.armed = true;
      setPhase((p) => (p === 'opening' || p === 'waiting' ? 'ready' : p));
    };
    const openTimer = window.setTimeout(() => {
      openedRef.current = true;
      if (resultRef.current) arm();
      else {
        // Result still in flight: the foil shimmers faster. Never a spinner.
        setPhase('waiting');
        foil.sweep(480);
        shimmer = window.setInterval(() => foil.sweep(480), 560);
      }
    }, reduced ? 220 : tuning.openMs);

    play.then(
      (r) => {
        if (!aliveRef.current) return;
        resultRef.current = r;
        setResult(r);
        arm();
      },
      (err: unknown) => {
        if (!aliveRef.current) return;
        window.clearInterval(shimmer);
        setPhase('error');
        const error = err instanceof PlayError ? err : new PlayError('network', String(err));
        void (async () => {
          await wait(2400);
          await closeBack();
          finish({ kind: 'error', error });
        })();
      },
    );

    return () => {
      aliveRef.current = false;
      window.clearTimeout(openTimer);
      window.clearInterval(shimmer);
      foil.destroy();
      field.destroy();
      frameAnim.current?.cancel();
    };
    // Mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle sweeps while waiting for the first scratch; "Raspar todo" after a beat.
  useEffect(() => {
    if (phase !== 'ready') return;
    const foil = foilRef.current;
    const sweepEvery = tuning.sweepEveryMs;
    const sweeper = sweepEvery > 0 && !reduced ? window.setInterval(() => foil?.sweep(tuning.sweepMs), sweepEvery) : 0;
    if (sweepEvery > 0 && !reduced) foil?.sweep(tuning.sweepMs);
    const all = window.setTimeout(() => setShowAll(true), reduced ? 0 : tuning.scratchAllDelayMs);
    return () => {
      window.clearInterval(sweeper);
      window.clearTimeout(all);
    };
  }, [phase, reduced, tuning.sweepEveryMs, tuning.sweepMs, tuning.scratchAllDelayMs]);

  // ---- Outcome sequences ----------------------------------------------
  useEffect(() => {
    if (phase !== 'revealed') return;
    const r = resultRef.current;
    if (!r) return;
    void (async () => {
      await wait(reduced ? 0 : 60);
      if (r.won) await runWin(r);
      else await runLose(r);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const prizeCenter = (): Point => {
    const el = prizeRef.current;
    return el ? rectCenter(el.getBoundingClientRect()) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  };

  const animateWords = () => {
    const words: HTMLElement[] = wordsRef.current ? Array.from(wordsRef.current.querySelectorAll<HTMLElement>('[data-word]')) : [];
    words.forEach((w, i) => {
      if (reduced) {
        w.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: i * 60, fill: 'both' });
        return;
      }
      w.animate(
        springKeyframes({ stiffness: 320, damping: 15 }, (p) => ({
          transform: `translate3d(0, ${(1 - p) * 16}px, 0) scale(${0.7 + 0.3 * p})`,
          opacity: Math.min(1, p * 1.6),
        })),
        { duration: 520, delay: i * tuning.winWordStaggerMs, easing: 'linear', fill: 'both' },
      );
    });
  };

  const runWin = async (r: PlayResult) => {
    const c = prizeCenter();
    haptic([0, 20, 30, 40]);
    setPhase('win');
    if (!reduced) {
      bloomRef.current?.animate(
        [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 0.95, offset: 0.35 }, { transform: 'scale(2.3)', opacity: 0 }],
        { duration: 1100, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' },
      );
    }
    await wait(reduced ? 0 : tuning.winIconDelayMs);
    if (reduced) {
      iconRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'both' });
    } else {
      iconRef.current?.animate(
        springKeyframes({ stiffness: 380, damping: 13 }, (p) => ({ transform: `scale(${Math.max(0, p)})`, opacity: Math.min(1, p * 3) })),
        { duration: 640, easing: 'linear', fill: 'both' },
      );
      if (!minimal) {
        ringRef.current?.animate(
          [{ transform: 'scale(0.45)', opacity: 0.95 }, { transform: `scale(${tuning.winShockwaveScale})`, opacity: 0 }],
          { duration: 720, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' },
        );
      }
    }
    await wait(reduced ? 0 : tuning.winWordsDelayMs - tuning.winIconDelayMs);
    animateWords();
    if (!reduced && tuning.winBurst !== 'none') {
      bus.emit('fx:burst', { x: c.x, y: c.y, kind: tuning.winBurst === 'confetti' ? 'celebrate' : 'gift' });
    }
    await wait(reduced ? 1400 : tuning.winFlightDelayMs - tuning.winWordsDelayMs);
    await fly(r);
    finish({ kind: 'won', result: r });
  };

  const landStamp = (r: PlayResult) => {
    const { card, applyCardUpdate } = fxRef.current;
    const tx = r.transaction;
    const known = tx ? card.history.some((h) => h.id === tx.id) : true;
    // The seen-state diff turns this into a 'bonus' event; the moments layer
    // slams it into the slot. Same tx id as the server → refresh won't dupe.
    applyCardUpdate({
      stamps: Math.max(card.stamps, r.stamps),
      ...(tx && !known ? { history: [tx, ...card.history] } : {}),
    });
  };

  const fly = async (r: PlayResult) => {
    const mover = moverRef.current;
    const slotIndex = stampsBefore.current;
    const { getSlotRect } = fxRef.current;
    const dur = tuning.flightMs;

    if (reduced || minimal) {
      // Straight crossfade: the ticket fades, the card comes back, the stamp lands.
      await finished(mover?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' }));
      dimCard(false, 320);
      landStamp(r);
      await wait(300);
      return;
    }

    const from = prizeCenter();
    const first = getSlotRect(slotIndex);
    if (first) revealRect(findScroller(anchorEl), first);
    const target = () => {
      const rect = getSlotRect(slotIndex);
      return rect ? rectCenter(rect) : { x: window.innerWidth / 2, y: window.innerHeight * 0.38 };
    };
    const slotSize = first ? Math.min(first.width, first.height) : 56;

    // The ticket collapses into the orb.
    const origin = mover ? (() => {
      const mr = mover.getBoundingClientRect();
      return `${from.x - mr.left}px ${from.y - mr.top}px`;
    })() : 'center';
    if (mover) mover.style.transformOrigin = origin;
    mover?.animate(
      [{ transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }, { transform: 'scale(0.18)', opacity: 0, filter: 'brightness(1.8)' }],
      { duration: 300, easing: 'cubic-bezier(.5,0,.7,.4)', fill: 'forwards' },
    );
    const orb = orbRef.current!;
    const size = 64;
    orb.style.display = 'block';
    orb.style.transform = `translate3d(${from.x - size / 2}px, ${from.y - size / 2}px, 0) scale(0.3)`;
    orb.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'forwards' });
    haptic(10);
    await wait(170);
    dimCard(false, dur);

    const field = fieldRef.current;
    const sparkleColors = [theme.giftAccent, '#ffffff', theme.accent, ...theme.particles.slice(0, 2)];
    const budget = tuning.trailSparkles;
    let emitted = 0;
    const endScale = Math.max(0.5, (slotSize * 0.9) / size);
    await new Promise<void>((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        if (!aliveRef.current) return resolve();
        const t = Math.min(1, (now - start) / dur);
        const e = easeInOutCubic(t);
        const to = target();
        const ctrl = arcControl(from, to, tuning.flightArc, window.innerWidth / 2);
        const p = quadPoint(from, ctrl, to, e);
        // Grows out of the ticket, then shrinks to the slot size.
        const sc = t < 0.25 ? 0.3 + (1.15 - 0.3) * (t / 0.25) : 1.15 + (endScale - 1.15) * ((t - 0.25) / 0.75);
        orb.style.transform = `translate3d(${p.x - size / 2}px, ${p.y - size / 2}px, 0) scale(${sc})`;
        if (field && emitted < budget && t > 0.05 && t < 0.97) {
          const want = Math.floor(budget * t);
          while (emitted < want) {
            emitted++;
            field.sparkle(
              p.x + (Math.random() - 0.5) * 18,
              p.y + (Math.random() - 0.5) * 18,
              sparkleColors[emitted % sparkleColors.length]!,
              3 + Math.random() * 5,
              420 + Math.random() * 380,
              (Math.random() - 0.5) * 40,
              10 + Math.random() * 40,
            );
          }
        }
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

    // Land: hand over to the stamp slam.
    landStamp(r);
    const to = target();
    const land = tuning.flightBounce
      ? [{ transform: `translate3d(${to.x - size / 2}px, ${to.y - size / 2}px, 0) scale(${endScale})`, opacity: 1 }, { transform: `translate3d(${to.x - size / 2}px, ${to.y - size / 2 - 6}px, 0) scale(${endScale * 1.25})`, opacity: 1, offset: 0.4 }, { transform: `translate3d(${to.x - size / 2}px, ${to.y - size / 2}px, 0) scale(${endScale * 0.6})`, opacity: 0 }]
      : [{ transform: `translate3d(${to.x - size / 2}px, ${to.y - size / 2}px, 0) scale(${endScale})`, opacity: 1 }, { transform: `translate3d(${to.x - size / 2}px, ${to.y - size / 2}px, 0) scale(${endScale * 0.7})`, opacity: 0 }];
    await finished(orb.animate(land, { duration: tuning.flightBounce ? 240 : 160, easing: 'ease-out', fill: 'forwards' }));
    await wait(field?.busy ? 450 : 0);
  };

  const runLose = async (r: PlayResult) => {
    haptic(10);
    setPhase('lose');
    const heart = heartRef.current;
    if (reduced) {
      heart?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'both' });
    } else {
      heart?.animate(
        springKeyframes({ stiffness: 240, damping: 14 }, (p) => ({ transform: `scale(${0.55 + 0.45 * p})`, opacity: Math.min(1, p * 2) })),
        { duration: 520, easing: 'linear', fill: 'both' },
      );
      heart?.animate(
        [{ translate: '0 0' }, { translate: '0 -6px' }, { translate: '0 0' }, { translate: '0 -4px' }, { translate: '0 0' }],
        { duration: 1500, delay: 380, easing: 'ease-in-out' },
      );
    }
    await wait(reduced ? 0 : 220);
    animateWords();
    await wait(reduced ? 1800 : tuning.loseFoldDelayMs - 220);
    if (reduced) {
      dimCard(false, 280);
      await finished(moverRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' }));
      finish({ kind: 'lost', result: r });
      return;
    }
    setPhase('fold');
    await nextFrame();
    await nextFrame();
    const fold = foldRef.current;
    // Light falls off as each side turns away.
    fold?.querySelector<HTMLElement>('[data-fold-shade="front"]')?.animate([{ opacity: 0 }, { opacity: 0.35 }], { duration: tuning.foldMs * 0.5, easing: 'ease-in', fill: 'forwards' });
    fold?.querySelector<HTMLElement>('[data-fold-shade="back"]')?.animate([{ opacity: 0.35 }, { opacity: 0 }], { duration: tuning.foldMs * 0.5, delay: tuning.foldMs * 0.5, easing: 'ease-out', fill: 'both' });
    await finished(
      fold?.animate(
        // Stays just short of 180° so the folded half never sinks behind the front.
        [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(168deg)', offset: 0.7 }, { transform: 'rotateX(179.4deg)' }],
        { duration: tuning.foldMs, easing: 'cubic-bezier(.55,.05,.35,1)', fill: 'forwards' },
      ),
    );
    haptic(6);
    await tuck();
    finish({ kind: 'lost', result: r });
  };

  /** The folded ticket flies into the countdown chip. */
  const tuck = async () => {
    const mover = moverRef.current;
    const ticket = ticketRef.current;
    if (!mover || !ticket) return;
    const chip = getChipRect();
    const tr = ticket.getBoundingClientRect();
    // Visible folded part = top half.
    const from = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 4 };
    const to = chip ? rectCenter(chip) : { x: window.innerWidth / 2, y: window.innerHeight * 0.85 };
    if (chip) revealRect(findScroller(anchorEl), chip, 60);
    const scale = chip ? Math.max(0.12, Math.min(0.5, chip.width / tr.width)) : 0.3;
    mover.style.transformOrigin = `${from.x - mover.getBoundingClientRect().left}px ${from.y - mover.getBoundingClientRect().top}px`;
    dimCard(false, tuning.tuckMs);
    await finished(
      mover.animate(
        [
          { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', opacity: 1 },
          { transform: `translate3d(${(to.x - from.x) * 0.45}px, ${(to.y - from.y) * 0.3 - 30}px, 0) scale(${0.5 + scale * 0.5}) rotate(-4deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate3d(${to.x - from.x}px, ${to.y - from.y}px, 0) scale(${scale}) rotate(0deg)`, opacity: 0 },
        ],
        { duration: tuning.tuckMs, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' },
      ),
    );
  };

  /** Error / close: the ticket slides back to the pocket. */
  const closeBack = async () => {
    const mover = moverRef.current;
    dimCard(false, 320);
    await finished(mover?.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0, 40px, 0) scale(0.92)', opacity: 0 }], { duration: 320, easing: 'ease-in', fill: 'forwards' }));
  };

  const scratchAll = () => {
    fxRef.current.trackInteraction('game-scratch-all');
    foilRef.current?.complete(null);
  };

  // ---- Render ----------------------------------------------------------
  const won = result?.won ?? false;
  const prizeSize = Math.round(m.windowH * 0.48);
  const messageColor = colors.ink;

  const prize = (staticPrize: boolean) =>
    result ? (
      <div ref={staticPrize ? undefined : prizeRef} className="absolute inset-0 flex items-center justify-center">
        {won ? (
          <>
            {!staticPrize && (
              <div
                ref={bloomRef}
                aria-hidden
                className="absolute rounded-full"
                style={{
                  width: prizeSize * 2,
                  height: prizeSize * 2,
                  opacity: 0,
                  background: `radial-gradient(circle, ${withAlpha('#ffffff', 0.95)} 0%, ${withAlpha(theme.giftAccent, 0.7)} 28%, ${withAlpha(theme.giftAccent, 0)} 70%)`,
                }}
              />
            )}
            {!staticPrize && (
              <div
                ref={ringRef}
                aria-hidden
                className="absolute rounded-full"
                style={{ width: prizeSize, height: prizeSize, opacity: 0, boxShadow: `0 0 0 3px ${theme.giftAccent}, 0 0 18px 2px ${withAlpha(theme.giftAccent, 0.6)}` }}
              />
            )}
            <div
              ref={staticPrize ? undefined : iconRef}
              className="relative flex items-center justify-center rounded-full"
              style={{
                width: prizeSize,
                height: prizeSize,
                backgroundColor: theme.accent,
                color: theme.ink,
                boxShadow: `0 0 0 4px ${withAlpha(theme.giftAccent, 0.85)}, 0 10px 24px -8px ${withAlpha(theme.accent, 0.8)}, inset 0 2px 0 ${withAlpha('#ffffff', 0.35)}`,
              }}
            >
              <Icon size={Math.round(prizeSize * 0.5)} />
            </div>
          </>
        ) : (
          <div ref={staticPrize ? undefined : heartRef} className="flex flex-col items-center" style={{ color: theme.accent }}>
            <Heart size={Math.round(prizeSize * 0.62)} fill="currentColor" strokeWidth={1.5} style={{ filter: `drop-shadow(0 6px 10px ${withAlpha(theme.accent, 0.35)})` }} />
          </div>
        )}
      </div>
    ) : null;

  const message = (staticMsg: boolean) => {
    // Live words start hidden; animateWords() brings them in.
    const wordStyle: React.CSSProperties = staticMsg ? {} : { opacity: 0 };
    if (phase === 'error') {
      return (
        <span style={{ color: colors.muted }}>
          No pudimos abrir tu raspa y gana.
          <br />
          Inténtalo de nuevo en un momento.
        </span>
      );
    }
    if ((phase === 'win' || (phase === 'out' && won)) && won) {
      return (
        <div ref={staticMsg ? undefined : wordsRef} className="flex flex-col items-center">
          <div className="flex gap-[0.3em] font-extrabold" style={{ fontSize: Math.round(m.width * 0.072), color: colors.accentInk, lineHeight: 1.1 }}>
            {WIN_WORDS.map((w) => (
              <span key={w} data-word className="inline-block" style={wordStyle}>{w}</span>
            ))}
          </div>
          <span data-word className="mt-1 inline-block" style={{ ...wordStyle, color: colors.muted, fontSize: Math.round(m.width * 0.037) }}>
            Sello de la suerte para tu tarjeta
          </span>
        </div>
      );
    }
    if (phase === 'lose' || phase === 'fold') {
      return (
        <div ref={staticMsg ? undefined : wordsRef} className="flex flex-col items-center" style={{ color: messageColor }}>
          <span data-word className="inline-block font-bold" style={{ ...wordStyle, fontSize: Math.round(m.width * 0.054) }}>Esta semana no fue 💛</span>
          <span data-word className="inline-block" style={{ ...wordStyle, color: colors.muted, fontSize: Math.round(m.width * 0.042) }}>¡El lunes hay otro!</span>
        </div>
      );
    }
    return (
      <span style={{ color: colors.muted }}>
        {phase === 'waiting' ? 'Preparando tu ticket…' : 'Raspa con el dedo para descubrir tu premio'}
      </span>
    );
  };

  const windowContent = (
    <>
      {prize(false)}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ borderRadius: 'inherit' }} aria-label="Zona para raspar" />
    </>
  );

  const folding = phase === 'fold';
  const darkSurface = theme.surface === 'dark';

  return (
    <div ref={rootRef} className="fixed inset-0" style={{ zIndex: 70 }} role="dialog" aria-modal="true" aria-label="Raspa y gana de la semana">
      <div
        ref={backdropRef}
        className="absolute inset-0"
        style={{
          opacity: 0,
          backgroundColor: darkSurface ? 'rgba(0,0,0,0.5)' : 'rgba(20,16,28,0.32)',
          backdropFilter: `blur(${tuning.backdropBlurPx}px)`,
          WebkitBackdropFilter: `blur(${tuning.backdropBlurPx}px)`,
        }}
      />
      {/* Frame: full viewport on phones, the card column on desktop. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-full w-full flex-col items-center justify-center md:w-[min(436px,calc((100dvh-2rem)*0.4638))]" style={{ perspective: 1100 }}>
          <div ref={moverRef} style={{ transformOrigin: '0 0', width: m.width, height: m.height, marginTop: -Math.round(m.height * 0.08), perspective: 900 }}>
            <div ref={ticketRef} style={{ width: m.width, height: m.height, position: 'relative', transformStyle: 'preserve-3d' }}>
              {!folding ? (
                <TicketFace theme={theme} template={template} metrics={m} week={week} serial={serial} window={windowContent} message={message(false)} shadow={1} />
              ) : (
                <>
                  <TicketFace theme={theme} template={template} metrics={m} week={week} serial={serial} window={prize(true)} message={message(true)} half="top" shadow={1} style={{ position: 'absolute', inset: 0 }} />
                  <div ref={foldRef} style={{ position: 'absolute', inset: 0, transformOrigin: `50% ${m.height / 2}px`, transformStyle: 'preserve-3d' }}>
                    {/* backface-visibility on a wrapper: Chrome ignores it on a clip-path element. */}
                    <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                      <TicketFace theme={theme} template={template} metrics={m} week={week} serial={serial} window={prize(true)} message={message(true)} half="bottom" style={{ position: 'absolute', inset: 0 }} />
                      <div data-fold-shade="front" style={{ position: 'absolute', left: 0, right: 0, top: m.height / 2, bottom: 0, borderRadius: `0 0 ${Math.round(m.width * 0.06)}px ${Math.round(m.width * 0.06)}px`, backgroundColor: '#000', opacity: 0 }} />
                    </div>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: m.height / 2, height: m.height / 2, transform: 'rotateX(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                      {/* Local top = the ticket's outer (rounded) end once folded. */}
                      <TicketBack theme={theme} template={template} metrics={m} style={{ borderRadius: `${Math.round(m.width * 0.06)}px ${Math.round(m.width * 0.06)}px 0 0` }} />
                      <div data-fold-shade="back" style={{ position: 'absolute', inset: 0, borderRadius: `${Math.round(m.width * 0.06)}px ${Math.round(m.width * 0.06)}px 0 0`, backgroundColor: '#000', opacity: 0 }} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-5 flex h-11 items-center justify-center">
            {phase === 'ready' && showAll && (
              <button
                type="button"
                onClick={scratchAll}
                className="rounded-full px-5 py-2.5 text-sm font-semibold shadow-lg transition-transform active:scale-95"
                style={{ backgroundColor: theme.bubble.bg, color: theme.bubble.fg, animation: reduced ? undefined : 'stampee-rise .35s cubic-bezier(.2,.8,.3,1) both' }}
              >
                Raspar todo
              </button>
            )}
          </div>

        </div>
      </div>

      {/* The stamp orb (win flight). */}
      <div
        ref={orbRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0"
        style={{ display: 'none', width: 64, height: 64, zIndex: 7, willChange: 'transform' }}
      >
        <div
          className="flex h-full w-full items-center justify-center rounded-full"
          style={{
            background: `radial-gradient(circle at 38% 32%, #ffffff 0%, ${withAlpha(theme.giftAccent, 0.95)} 34%, ${theme.accent} 78%)`,
            boxShadow: `0 0 18px 6px ${withAlpha(theme.giftAccent, 0.75)}, 0 0 44px 14px ${withAlpha(theme.giftAccent, 0.35)}`,
            color: theme.ink,
          }}
        >
          <Icon size={28} />
        </div>
      </div>
      <style>{'@keyframes stampee-rise{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
};

export default TicketOverlay;
