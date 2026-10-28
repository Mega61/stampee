// OWNER: agent C (tactile grid). The public card's stamp grid (plan §5.2–5.5):
// tactile slots, mount fill-in, counter pill, tooltips, and the particle layer.
// Slams/unwraps are played here when the moments layer asks (bus), see
// lib/card/types.ts "Division of labor".
import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { withAlpha } from '../../lib/card/gridFx';
import { buildStampTimeline } from '../../lib/card/stampTimeline';
import { usePageVisible } from '../../lib/card/usePageVisible';
import type { SlotFxState } from '../../lib/card/types';
import type { StampGridContext } from '../LoyaltyCard';
import { useCardFx } from './CardFxContext';
import { PublicStampSlot, type SlotTooltipInput } from './PublicStampSlot';
import type { TooltipRequest } from './SlotTooltip';

// Kept out of the main card chunk (the tooltip is preloaded after mount). A
// chunk that fails to load (offline, stale deploy) renders nothing instead of
// taking the card down.
const NONE = { default: () => null };
const loadTooltip = () => import('./SlotTooltip');
const ParticleLayer = lazy(() => import('./ParticleLayer').catch(() => NONE));
const SlotTooltip = lazy(() => loadTooltip().catch(() => NONE));

const STAGGER_MS = 40;
const MOUNT_LEAD_MS = 180;

/** Digit that rolls up when it changes. */
const RollingNumber: React.FC<{ value: number; animate: boolean }> = ({ value, animate }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!animate || typeof ref.current?.animate !== 'function') return;
    ref.current.animate(
      [{ transform: 'translateY(65%)', opacity: 0 }, { transform: 'translateY(-8%)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
      { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }, [value, animate]);
  return (
    <span className="inline-flex overflow-hidden tabular-nums">
      <span ref={ref} className="inline-block">{value}</span>
    </span>
  );
};

export const PublicStampGrid: React.FC<{ ctx: StampGridContext }> = ({ ctx }) => {
  const { slotStates, setSlotState, bus, reducedMotion, theme } = useCardFx();
  const pageVisible = usePageVisible();
  const timeline = useMemo(() => buildStampTimeline(ctx.history, ctx.stamps), [ctx.history, ctx.stamps]);

  // Slots whose slam/unwrap already started render inked even while the
  // moments layer still has them as pending/wrapped.
  const [forced, setForced] = useState<Record<number, true>>({});
  const setForcedInk = useCallback((index: number, value: boolean) => {
    setForced((prev) => {
      if (!!prev[index] === value) return prev;
      const next = { ...prev };
      if (value) next[index] = true;
      else delete next[index];
      return next;
    });
  }, []);
  // A slot that becomes pending/wrapped again (new event after a removal)
  // drops its local override.
  const prevStates = useRef<Record<number, SlotFxState>>(slotStates);
  useEffect(() => {
    const prev = prevStates.current;
    prevStates.current = slotStates;
    Object.entries(slotStates).forEach(([key, state]) => {
      if (prev[Number(key)] === state) return;
      setForcedInk(Number(key), false);
      setCounted((c) => {
        if (!c[Number(key)]) return c;
        const next = { ...c };
        delete next[Number(key)];
        return next;
      });
    });
  }, [slotStates, setForcedInk]);

  // Mount fill-in sequence (once).
  const [stagger] = useState(() => !reducedMotion);
  const [mounting, setMounting] = useState(stagger);

  // The counter ticks when a stamp has actually landed / been unwrapped.
  const [counted, setCounted] = useState<Record<number, true>>({});
  useEffect(() => {
    const add = ({ index }: { index: number }) => setCounted((prev) => (prev[index] ? prev : { ...prev, [index]: true }));
    const offLanded = bus.on('stamp:landed', add);
    const offUnwrapped = bus.on('gift:unwrapped', add);
    return () => {
      offLanded();
      offUnwrapped();
    };
  }, [bus]);
  const isCounted = (i: number) => i < ctx.stamps && (!slotStates[i] || !!counted[i]);
  const inkedCount = Array.from({ length: ctx.totalStamps }, (_, i) => i).filter(isCounted).length;

  // Counter rolls up in step with the fill-in, then follows the real count.
  const [rolled, setRolled] = useState(stagger ? 0 : inkedCount);
  useEffect(() => {
    if (!mounting) return;
    let n = 0;
    let interval = 0;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        n += 1;
        setRolled(n);
        if (n >= inkedCount) {
          window.clearInterval(interval);
          setMounting(false);
        }
      }, STAGGER_MS);
      if (inkedCount === 0) setMounting(false);
    }, MOUNT_LEAD_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shownCount = mounting ? Math.min(rolled, inkedCount) : inkedCount;

  // Tooltips: one at a time.
  const [tooltip, setTooltip] = useState<TooltipRequest | null>(null);
  const tooltipSeq = useRef(0);
  const showTooltip = useCallback((input: SlotTooltipInput) => {
    setTooltip({ id: ++tooltipSeq.current, anchor: input.anchor, title: input.title, detail: input.detail, ms: input.ms });
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadTooltip().catch(() => {}), 900);
    return () => window.clearTimeout(t);
  }, []);

  // Dev hook so the slam/unwrap can be driven from devtools / Playwright.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __fxBus?: unknown; __fxSetSlotState?: unknown };
    w.__fxBus = bus;
    w.__fxSetSlotState = setSlotState;
  }, [bus, setSlotState]);

  const remaining = ctx.totalStamps - ctx.stamps;
  const almostThere = !ctx.isCompleted && remaining > 0 && remaining <= 2;
  const nextIndex = ctx.isCompleted ? -1 : ctx.stamps;

  return (
    <>
      <div className={cn('grid grid-cols-4 justify-items-center', ctx.isHighDensity ? 'gap-2' : 'gap-4')}>
        {Array.from({ length: ctx.totalStamps }).map((_, index) => (
          <PublicStampSlot
            key={index}
            index={index}
            ctx={ctx}
            earned={index < ctx.stamps}
            fxState={slotStates[index]}
            forcedInk={!!forced[index]}
            setForcedInk={setForcedInk}
            gifted={ctx.isGifted(index)}
            origin={timeline[index]}
            isNext={index === nextIndex}
            almostThere={almostThere}
            mountDelay={stagger ? MOUNT_LEAD_MS + index * STAGGER_MS : null}
            pageVisible={pageVisible}
            showTooltip={showTooltip}
          />
        ))}
      </div>

      {!ctx.isCompleted && !ctx.isRedeemed && (
        // Sits in the grid's bottom margin so it never shifts the layout.
        <div className="pointer-events-none absolute left-1/2 top-full mt-3 -translate-x-1/2">
          <div
            className="flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium tracking-wide backdrop-blur-sm"
            style={{
              color: ctx.colors.text,
              backgroundColor: withAlpha(ctx.colors.text, theme.surface === 'dark' ? 0.08 : 0.06),
              borderColor: withAlpha(ctx.colors.text, 0.1),
            }}
            aria-hidden
          >
            <strong className="font-bold">
              <RollingNumber value={shownCount} animate={!reducedMotion} />
            </strong>
            <span className="opacity-70">/ {ctx.totalStamps} sellos</span>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        {tooltip && <SlotTooltip key={tooltip.id} request={tooltip} theme={theme} reducedMotion={reducedMotion} onDone={hideTooltip} />}
        <ParticleLayer />
      </Suspense>
    </>
  );
};
