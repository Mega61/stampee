// OWNER: agent E (moments). "Te regalaron sellos · Toca para abrir" banner at
// the top of the card (plan §6.3). Breathes gently until tapped; only the
// banner itself takes pointer events, the card stays usable underneath.
import React from 'react';
import { m } from 'motion/react';
import { Gift } from 'lucide-react';
import { readableOn, withAlpha } from '../../../lib/card/gridFx';
import type { FxTheme } from '../../../lib/card/types';

export const GiftBanner: React.FC<{
  title: string;
  action: string;
  theme: FxTheme;
  reducedMotion: boolean;
  onOpen: (el: HTMLElement) => void;
}> = ({ title, action, theme, reducedMotion, onOpen }) => {
  const gift = theme.giftAccent;
  const idle = !reducedMotion;
  return (
    <m.div
      // Leaves the card's QR button (top-right, 40 px at 24 px) uncovered.
      className="pointer-events-none absolute left-4 right-[74px] flex justify-center md:left-7"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
      initial={idle ? { opacity: 0, y: -28, scale: 0.96 } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={idle ? { opacity: 0, y: -18, scale: 0.94, transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } } : { opacity: 0, transition: { duration: 0.2 } }}
      transition={idle ? { type: 'spring', stiffness: 320, damping: 26 } : { duration: 0.2 }}
    >
      <m.button
        type="button"
        onClick={(e) => onOpen(e.currentTarget)}
        className="pointer-events-auto relative flex max-w-full items-center gap-3 rounded-[28px] py-2 pl-2 pr-4 text-left outline-none touch-manipulation focus-visible:ring-2"
        style={{
          backgroundColor: theme.bubble.bg,
          color: theme.bubble.fg,
          boxShadow: `0 16px 36px -16px rgba(0,0,0,0.5), 0 3px 10px -4px rgba(0,0,0,0.2), 0 0 0 1px ${withAlpha(gift, 0.45)}`,
          WebkitTapHighlightColor: 'transparent',
        } as React.CSSProperties}
        animate={idle ? { scale: [1, 1.025, 1] } : undefined}
        transition={idle ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.8 } : undefined}
        whileTap={idle ? { scale: 0.95 } : undefined}
        aria-label={`${title}. ${action}`}
      >
        {/* Soft halo in the gift color, breathing with the banner. */}
        {idle && (
          <m.span
            aria-hidden
            className="pointer-events-none absolute -inset-1 rounded-full"
            style={{ boxShadow: `0 0 0 2px ${withAlpha(gift, 0.35)}, 0 0 22px 2px ${withAlpha(gift, 0.4)}` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
          />
        )}
        <m.span
          aria-hidden
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: gift, color: readableOn(gift), boxShadow: 'inset 0 -3px 5px rgba(0,0,0,0.14)' }}
          animate={idle ? { rotate: [0, -12, 10, -6, 3, 0] } : undefined}
          transition={idle ? { duration: 0.7, repeat: Infinity, repeatDelay: 2.1, delay: 1.2, ease: 'easeInOut' } : undefined}
        >
          <Gift size={20} strokeWidth={2.4} />
        </m.span>
        <span className="relative min-w-0 leading-tight">
          <span className="line-clamp-2 text-[0.875rem] font-semibold tracking-[-0.01em]">{title}</span>
          <span className="mt-0.5 block text-[0.8125rem] font-medium opacity-70">{action}</span>
        </span>
      </m.button>
    </m.div>
  );
};
