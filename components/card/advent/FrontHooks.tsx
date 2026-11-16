// What the calendar adds to the front of the card: the gold seal badge in the
// corner ("1 regalo sin abrir" / "Calendario de Adviento"), which is also the
// accessible way to turn the card, and the "Voltea tu tarjeta" chip.
import React, { useEffect, useRef } from 'react';
import { Gift, RefreshCw } from 'lucide-react';
import { Sprig } from './decor';
import './advent.css';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Gilda+Display&family=Hanken+Grotesk:wght@400;500;600;700&display=swap';

/** Brand fonts for the calendar (same stylesheet as the gift card pages, loaded once). */
export const useAdventFonts = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled || document.querySelector('link[data-gift-fonts]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    link.dataset.giftFonts = '1';
    document.head.appendChild(link);
  }, [enabled]);
};

export const SealBadge: React.FC<{
  /** Doors she can open now; 0 shows the calendar's name instead. */
  ready: number;
  eligible: boolean;
  reducedMotion: boolean;
  onClick: () => void;
}> = ({ ready, eligible, reducedMotion, onClick }) => {
  const count = eligible ? ready : 0;
  const label = count === 0 ? 'Calendario de Adviento' : count === 1 ? '1 regalo sin abrir' : `${count} regalos sin abrir`;
  return (
    <button
      type="button"
      className={`adv-front adv-seal${count && !reducedMotion ? ' idle' : ''}`}
      aria-label={count ? `Ver calendario de Adviento: ${label}` : 'Ver calendario de Adviento'}
      onClick={onClick}
    >
      <Sprig />
      <span className="disc">
        <Gift aria-hidden strokeWidth={1.8} />
        {count > 0 && <span className="num">{count}</span>}
      </span>
      <span className="lbl">{label}</span>
    </button>
  );
};

export const FlipChip: React.FC<{ onClick: () => void; pulse: number }> = ({ onClick, pulse }) => {
  const ref = useRef<HTMLButtonElement>(null);
  // Pulses along with the one-time peek.
  useEffect(() => {
    if (!pulse) return;
    ref.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 900, delay: 300 });
  }, [pulse]);
  return (
    <button ref={ref} type="button" className="adv-front adv-flip-chip" onClick={onClick}>
      <RefreshCw aria-hidden strokeWidth={1.8} />
      Voltea tu tarjeta
    </button>
  );
};
