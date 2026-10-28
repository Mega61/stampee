// Lazy chunk behind WalletButtons: the "Agregar a Apple Wallet" pill (iOS).
// Black pill like Apple's own button (outlined on dark cards), with our own
// wallet glyph — no Apple badge artwork. Tapping navigates to the signed
// .pkpass: Safari answers a pass download with the "Add to Apple Wallet"
// sheet and the card page stays where it is.
import React, { useCallback, useEffect, useState } from 'react';
import { m } from 'motion/react';
import { useCardFx } from './CardFxContext';
import { appleWalletPassUrl } from '../../lib/card/walletApi';

const SPRING = { type: 'spring', stiffness: 260, damping: 24, mass: 0.9 } as const;
// The download gives the page no completion signal: release the button after
// the sheet has had time to appear.
const BUSY_MS = 3500;

/** A wallet pocket holding two cards. */
const WalletGlyph: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="4" y="3.5" width="16" height="8" rx="2" fill="#fff" fillOpacity="0.55" />
    <rect x="4" y="6.5" width="16" height="8" rx="2" fill="#fff" fillOpacity="0.85" />
    <path
      d="M2.5 11h5.6c.5 0 .9.3 1.1.7a3 3 0 0 0 5.6 0c.2-.4.6-.7 1.1-.7h5.6v7.5A2.5 2.5 0 0 1 19 21H5a2.5 2.5 0 0 1-2.5-2.5z"
      fill="#fff"
    />
  </svg>
);

const Spinner: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" className="animate-spin motion-reduce:animate-none" aria-hidden>
    <circle cx="12" cy="12" r="8.5" stroke="#fff" strokeOpacity="0.25" strokeWidth="2.5" fill="none" />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
  </svg>
);

const AppleWalletButton: React.FC = () => {
  const { slug, card, theme, reducedMotion, trackInteraction } = useCardFx();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setBusy(false), BUSY_MS);
    // Back from the sheet / another app: ready again.
    const onShow = () => setBusy(false);
    window.addEventListener('pageshow', onShow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pageshow', onShow);
    };
  }, [busy]);

  const add = useCallback(() => {
    if (busy) return;
    trackInteraction('wallet_save');
    setBusy(true);
    window.location.href = appleWalletPassUrl(slug, card.uniqueId);
  }, [busy, card.uniqueId, slug, trackInteraction]);

  const dark = theme.surface === 'dark';

  return (
    <m.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={reducedMotion ? { duration: 0.18 } : SPRING}
      className="flex flex-col items-center"
    >
      <button
        type="button"
        onClick={add}
        aria-busy={busy}
        className="flex h-11 min-w-[13.5rem] items-center justify-center gap-2.5 rounded-full bg-black pl-4 pr-5 text-[14px] font-medium tracking-[0.01em] text-white shadow-[0_8px_22px_-12px_rgba(0,0,0,0.6)] transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
        style={dark ? { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.32)' } : undefined}
      >
        {busy ? <Spinner /> : <WalletGlyph />}
        <span>Agregar a Apple Wallet</span>
      </button>
    </m.div>
  );
};

export default AppleWalletButton;
