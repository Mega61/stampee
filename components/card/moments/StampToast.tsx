// OWNER: agent E (moments). Toasts that slide up from the bottom of the card
// after a moment ("+1 sello · hoy"). Newest in front; older ones tuck behind
// it, so a quick chain stacks instead of piling up.
import React from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Check, Gift, PartyPopper, Sparkles } from 'lucide-react';
import { readableOn, withAlpha } from '../../../lib/card/gridFx';
import type { ToastCopy } from '../../../lib/card/momentQueue';
import type { FxTheme } from '../../../lib/card/types';

export interface ToastItem extends ToastCopy {
  id: number;
}

const MAX_VISIBLE = 3;

const ICONS = { stamp: Check, bonus: Sparkles, gift: Gift, complete: PartyPopper } as const;

export const ToastStack: React.FC<{ toasts: ToastItem[]; theme: FxTheme; reducedMotion: boolean }> = ({ toasts, theme, reducedMotion }) => {
  // Newest first.
  const visible = toasts.slice(-MAX_VISIBLE).reverse();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)' }}
    >
      <AnimatePresence initial={false}>
        {visible.map((toast, depth) => {
          const Icon = ICONS[toast.tone];
          const chip = toast.tone === 'stamp' ? theme.accent : theme.giftAccent;
          return (
            <m.div
              key={toast.id}
              className="absolute bottom-0 flex max-w-[calc(100%-2rem)] items-center gap-2.5 whitespace-nowrap rounded-full py-2 pl-2 pr-4 text-[0.9375rem] font-semibold tracking-[-0.01em]"
              style={{
                backgroundColor: theme.bubble.bg,
                color: theme.bubble.fg,
                zIndex: MAX_VISIBLE - depth,
                transformOrigin: '50% 100%',
                boxShadow: `0 14px 34px -14px rgba(0,0,0,0.45), 0 3px 10px -4px rgba(0,0,0,0.18), 0 0 0 1px ${withAlpha(theme.bubble.fg, 0.08)}`,
              }}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 36, scale: 0.94 }}
              animate={{ opacity: depth === 0 ? 1 : depth === 1 ? 0.7 : 0, y: depth * -11, scale: 1 - depth * 0.06 }}
              exit={{ opacity: 0, y: depth === 0 && !reducedMotion ? 14 : depth * -11, scale: reducedMotion ? 1 - depth * 0.06 : 0.94, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
              transition={reducedMotion ? { duration: 0.2 } : { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 }}
              aria-hidden={depth > 0 || undefined}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: chip, color: readableOn(chip), boxShadow: `inset 0 -2px 3px rgba(0,0,0,0.12)` }}
              >
                <Icon size={15} strokeWidth={2.75} />
              </span>
              <span className="truncate">{toast.text}</span>
            </m.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
