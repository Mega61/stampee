// OWNER: agent C (tactile grid). Small bubble above a stamp slot. Rendered in
// a portal (fixed position) so the card's overflow/transforms never clip it,
// clamped to the viewport, auto-dismissed.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeBubble } from '../../lib/card/gridFx';
import type { FxTheme } from '../../lib/card/types';

export interface TooltipRequest {
  /** Changes on every request so repeated taps restart the timer. */
  id: number;
  anchor: DOMRect;
  title: string;
  detail?: string;
  ms: number;
}

const ARROW = 7;
const GAP = 8;

export const SlotTooltip: React.FC<{
  request: TooltipRequest;
  theme: FxTheme;
  reducedMotion: boolean;
  onDone: () => void;
}> = ({ request, theme, reducedMotion, onDone }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrowX: number; below: boolean } | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { anchor } = request;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const { left, arrowX } = placeBubble(anchor.left + anchor.width / 2, width, window.innerWidth);
    const above = anchor.top - GAP - ARROW - height;
    const below = above < 8;
    setPos({ left, arrowX, below, top: below ? anchor.bottom + GAP + ARROW : above });
  }, [request]);

  useEffect(() => {
    const el = ref.current;
    if (!pos || !el) return;
    const origin = `${pos.arrowX}px ${pos.below ? '0%' : '100%'}`;
    el.style.transformOrigin = origin;
    if (!reducedMotion) {
      el.animate(
        [
          { opacity: 0, transform: `translateY(${pos.below ? -4 : 4}px) scale(0.92)` },
          { opacity: 1, transform: 'translateY(0) scale(1.02)', offset: 0.7 },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
    let exit: Animation | null = null;
    const timer = window.setTimeout(() => {
      if (reducedMotion) return onDoneRef.current();
      exit = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
      exit.onfinish = () => onDoneRef.current();
    }, request.ms);
    return () => {
      window.clearTimeout(timer);
      exit?.cancel();
    };
  }, [pos, request.ms, reducedMotion]);

  const arrowStyle: React.CSSProperties = {
    left: (pos?.arrowX ?? 0) - ARROW,
    borderLeft: `${ARROW}px solid transparent`,
    borderRight: `${ARROW}px solid transparent`,
    ...(pos?.below
      ? { bottom: '100%', borderBottom: `${ARROW}px solid ${theme.bubble.bg}` }
      : { top: '100%', borderTop: `${ARROW}px solid ${theme.bubble.bg}` }),
  };

  return createPortal(
    <div
      ref={ref}
      role="status"
      className="pointer-events-none fixed z-[90] max-w-[min(260px,calc(100vw-24px))] rounded-2xl px-3.5 py-2 text-center font-sans shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        backgroundColor: theme.bubble.bg,
        color: theme.bubble.fg,
      }}
    >
      <div className="text-[13px] font-semibold leading-tight tracking-[-0.01em]">{request.title}</div>
      {request.detail && <div className="mt-0.5 text-[11px] font-medium leading-tight opacity-70">{request.detail}</div>}
      <span aria-hidden className="absolute h-0 w-0" style={arrowStyle} />
    </div>,
    document.body,
  );
};

export default SlotTooltip;
