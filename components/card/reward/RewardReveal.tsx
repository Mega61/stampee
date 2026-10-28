// OWNER: agent H. Reward scratch reveal (§6.4): when the card completes, a
// celebratory foil certificate rises over the card; scratching (or
// "Revelar") uncovers the reward, "Muéstralo al personal" and the card ID.
// Reuses the ticket's ScratchFoil engine. Lazy chunk, mounted by WeeklyTicket.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { haptic } from '../../../lib/card/haptics';
import { withAlpha } from '../../../lib/card/gridFx';
import { rectCenter, findCardFrame, finished, makeWait, springKeyframes } from '../game/stage';
import { foilPalette } from '../game/foil';
import { FlakeField } from '../game/flakes';
import { ScratchFoil } from '../game/ScratchFoil';
import { ticketColors } from '../game/TicketFace';
import { getTuning } from '../game/tuning';
import { useCardFx } from '../CardFxContext';

type Phase = 'entering' | 'ready' | 'revealed' | 'closing';

const certWidth = () => {
  const column = Math.min(typeof window === 'undefined' ? 390 : window.innerWidth, 436);
  return Math.round(Math.min(360, column * 0.88));
};

export const RewardReveal: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const fx = useCardFx();
  const { theme, template, card, reducedMotion: reduced } = fx;
  const t = useMemo(() => getTuning(theme.style), [theme.style]);
  const [phase, setPhase] = useState<Phase>('entering');
  const [showButton, setShowButton] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const certRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foilRef = useRef<ScratchFoil | null>(null);
  const frameAnim = useRef<Animation | null>(null);
  const aliveRef = useRef(true);
  const wait = useRef(makeWait(() => aliveRef.current)).current;
  const fxRef = useRef(fx);
  fxRef.current = fx;

  const width = useMemo(certWidth, []);
  const height = Math.round(width * 1.16);
  const c = ticketColors(theme);
  const Icon = template.icon;
  const minimal = theme.style === 'minimal';

  const onRevealed = () => {
    setPhase('revealed');
    const f = fxRef.current;
    haptic('success');
    const el = certRef.current;
    if (el) {
      const p = rectCenter(el.getBoundingClientRect());
      f.bus.emit('fx:burst', { x: p.x, y: p.y, kind: 'celebrate' });
      if (f.theme.style === 'playful') {
        window.setTimeout(() => f.bus.emit('fx:burst', { x: p.x, y: p.y - 80, kind: 'celebrate' }), 260);
      }
    }
    f.bus.emit('reward:revealed', {});
    f.markRewardRevealed();
    f.trackInteraction('reward-reveal');
    if (!f.reducedMotion) {
      contentRef.current?.animate(
        springKeyframes({ stiffness: 300, damping: 14 }, (p) => ({ transform: `scale(${0.94 + 0.06 * p})` })),
        { duration: 600, easing: 'linear' },
      );
    }
  };

  useLayoutEffect(() => {
    aliveRef.current = true;
    const root = rootRef.current!;
    const field = new FlakeField(root, 6);
    field.gravity = t.flakeGravity;
    field.maxFlakes = reduced ? 0 : t.flakeMax;
    field.setSpin(t.flakeSpin);
    const foil = new ScratchFoil(canvasRef.current!, {
      width,
      height,
      radius: 28,
      palette: foilPalette(theme, 'reward'),
      flat: minimal,
      holo: t.holo && !reduced,
      label: 'RASPA PARA REVELAR',
      pattern: !minimal,
      seed: 3,
      brushPx: Math.round(t.brushPx * 1.25),
      grainPx: t.grainPx,
      autoCompletePct: t.autoCompletePct,
      flakesPer100px: t.flakesPer100px,
      shardCols: t.shardCols,
      shardSpeed: t.shardSpeed,
      shatterMs: t.shatterMs,
      flakeSpin: t.flakeSpin,
      reduced,
      field,
      onFirstScratch: () => fxRef.current.trackInteraction('reward-scratch'),
      onComplete: onRevealed,
    });
    foilRef.current = foil;

    const frame = findCardFrame(anchorRef.current);
    void (async () => {
      await wait(reduced ? 150 : 550);
      backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-out', fill: 'forwards' });
      if (frame && !reduced) {
        frameAnim.current = frame.animate([{ transform: 'none' }, { transform: `scale(${t.cardScale})` }], { duration: 600, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
      }
      const cert = certRef.current!;
      cert.style.visibility = 'visible';
      if (reduced) {
        await finished(cert.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'backwards' }));
      } else {
        await finished(
          cert.animate(
            springKeyframes(t.openSpring, (p) => ({
              transform: `translate3d(0, ${(1 - p) * 120}px, 0) scale(${0.86 + 0.14 * p}) rotateX(${(1 - p) * 22}deg)`,
              opacity: Math.min(1, p * 2.2),
            })),
            { duration: t.openMs + 200, easing: 'linear', fill: 'backwards' },
          ),
        );
        foil.sweep(1100);
      }
      foil.armed = true;
      setPhase('ready');
      await wait(reduced ? 0 : 1600);
      setShowButton(true);
    })();

    const sweeper = !reduced && t.sweepEveryMs > 0 ? window.setInterval(() => !foil.done && foil.sweep(t.sweepMs), t.sweepEveryMs) : 0;
    return () => {
      aliveRef.current = false;
      window.clearInterval(sweeper);
      foil.destroy();
      field.destroy();
      frameAnim.current?.cancel();
    };
    // Mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = async () => {
    setPhase('closing');
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
    const frame = frameAnim.current;
    if (frame) {
      frame.reverse();
    }
    await finished(certRef.current?.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0, 30px, 0) scale(0.94)' }], { duration: 380, easing: 'ease-in', fill: 'forwards' }));
    onClose?.();
  };

  useEffect(() => {
    if (phase !== 'revealed') return;
    // Keep the reward up long enough to show it; the client closes it.
    setShowButton(true);
  }, [phase]);

  const revealed = phase === 'revealed' || phase === 'closing';

  return (
    <>
    <span ref={anchorRef} hidden />
    {createPortal(
    <div ref={rootRef} className="fixed inset-0" style={{ zIndex: 70 }} role="dialog" aria-modal="true" aria-label="Tu recompensa">
      <div
        ref={backdropRef}
        className="absolute inset-0"
        style={{
          opacity: 0,
          backgroundColor: theme.surface === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(20,16,28,0.38)',
          backdropFilter: `blur(${t.backdropBlurPx}px)`,
          WebkitBackdropFilter: `blur(${t.backdropBlurPx}px)`,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-full w-full flex-col items-center justify-center px-4 md:w-[min(436px,calc((100dvh-2rem)*0.4638))]" style={{ perspective: 1100 }}>
          <div className="mb-5 text-center text-white" style={{ textShadow: '0 1px 12px rgba(0,0,0,0.35)', opacity: phase === 'entering' ? 0 : 1, transition: 'opacity .4s' }}>
            <div className="text-xl font-extrabold">{revealed ? '¡Es tuyo!' : '¡Completaste tu tarjeta!'}</div>
            <div className="mt-1 text-sm opacity-85">{revealed ? 'Muéstralo al personal en tu próxima visita' : 'Raspa para revelar tu premio'}</div>
          </div>

          <div ref={certRef} className="relative" style={{ width, height, visibility: 'hidden' }}>
            <div
              aria-hidden
              className="absolute"
              style={{ inset: '6% 6% -4%', borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.4)', filter: 'blur(18px)' }}
            />
            <div
              ref={contentRef}
              className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-6 text-center"
              style={{
                borderRadius: 28,
                backgroundColor: c.paper,
                backgroundImage: `radial-gradient(90% 60% at 50% 0%, ${withAlpha(theme.giftAccent, 0.22)}, transparent 70%), repeating-conic-gradient(from 0deg at 50% 38%, ${withAlpha(theme.giftAccent, 0.07)} 0deg 5deg, transparent 5deg 15deg)`,
                boxShadow: `inset 0 0 0 2px ${withAlpha(theme.giftAccent, 0.75)}, inset 0 0 0 7px ${c.paper}, inset 0 0 0 8px ${withAlpha(theme.giftAccent, 0.45)}`,
                color: c.ink,
              }}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase" style={{ letterSpacing: '0.22em', color: c.accentInk }}>
                <Sparkles size={13} /> Tu recompensa
              </div>
              <div
                className="mt-4 flex items-center justify-center rounded-full"
                style={{
                  width: width * 0.24,
                  height: width * 0.24,
                  backgroundColor: theme.accent,
                  color: theme.ink,
                  boxShadow: `0 0 0 4px ${withAlpha(theme.giftAccent, 0.85)}, 0 12px 26px -10px ${withAlpha(theme.accent, 0.8)}`,
                }}
              >
                <Icon size={Math.round(width * 0.12)} />
              </div>
              <div className="mt-4 font-extrabold leading-tight" style={{ fontSize: Math.round(width * 0.085), color: c.ink }}>
                {template.rewardName}
              </div>
              <div className="mt-2 text-sm font-medium" style={{ color: c.muted }}>
                Muéstralo al personal
              </div>
              <div className="my-4 w-2/3" style={{ borderTop: `2px dashed ${withAlpha(c.ink, 0.16)}` }} />
              <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '0.18em', color: c.muted }}>
                ID de tarjeta
              </div>
              <div className="mt-1 break-all font-mono text-xs" style={{ color: c.ink }}>
                {card.uniqueId}
              </div>
            </div>
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ borderRadius: 28 }} aria-label="Zona para raspar" />
          </div>

          <div className="mt-6 flex h-11 items-center justify-center">
            {showButton && phase !== 'closing' && (
              <button
                type="button"
                onClick={revealed ? () => void close() : () => foilRef.current?.complete(null)}
                className="rounded-full px-6 py-2.5 text-sm font-semibold shadow-lg transition-transform active:scale-95"
                style={{ backgroundColor: theme.bubble.bg, color: theme.bubble.fg, animation: reduced ? undefined : 'stampee-rise .35s cubic-bezier(.2,.8,.3,1) both' }}
              >
                {revealed ? 'Listo' : 'Revelar'}
              </button>
            )}
          </div>
        </div>
      </div>
      <style>{'@keyframes stampee-rise{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}'}</style>
    </div>,
    document.body,
    )}
    </>
  );
};

export default RewardReveal;
