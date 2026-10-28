// Lazy chunk behind WalletButtons: the "Agregar a Google Wallet" pill.
// Black pill per Google's button guidance (outlined on dark cards), with our
// own wallet glyph — no Google assets. The save link is fetched on tap (that
// call creates the pass server-side), then the tab navigates to Google, which
// hands off to the Wallet app on Android.
import React, { useCallback, useEffect, useState } from 'react';
import { m } from 'motion/react';
import { useCardFx } from './CardFxContext';
import { fetchGoogleSaveUrl } from '../../lib/card/walletApi';

const SPRING = { type: 'spring', stiffness: 260, damping: 24, mass: 0.9 } as const;

/** Three stacked cards in a wallet pocket. */
const WalletGlyph: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3.5" y="3" width="17" height="7" rx="2" fill="#fff" fillOpacity="0.5" />
    <rect x="3.5" y="5.5" width="17" height="7" rx="2" fill="#fff" fillOpacity="0.75" />
    <rect x="3.5" y="8" width="17" height="7" rx="2" fill="#fff" fillOpacity="0.9" />
    <path d="M2.5 11.5h6.2a3.3 3.3 0 0 0 6.6 0h6.2v7A2.5 2.5 0 0 1 19 21H5a2.5 2.5 0 0 1-2.5-2.5z" fill="#fff" />
  </svg>
);

const Spinner: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" className="animate-spin motion-reduce:animate-none" aria-hidden>
    <circle cx="12" cy="12" r="8.5" stroke="#fff" strokeOpacity="0.25" strokeWidth="2.5" fill="none" />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
  </svg>
);

const GoogleWalletButton: React.FC = () => {
  const { slug, card, theme, reducedMotion, trackInteraction } = useCardFx();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Coming back from Google via the back button restores this page from the
  // bfcache with the spinner still on.
  useEffect(() => {
    const onShow = () => setLoading(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), 4000);
    return () => clearTimeout(timer);
  }, [failed]);

  const save = useCallback(async () => {
    if (loading) return;
    trackInteraction('wallet_save');
    setLoading(true);
    setFailed(false);
    try {
      const url = await fetchGoogleSaveUrl(slug, card.uniqueId);
      window.location.assign(url);
    } catch {
      setLoading(false);
      setFailed(true);
    }
  }, [card.uniqueId, loading, slug, trackInteraction]);

  const dark = theme.surface === 'dark';

  return (
    <m.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={reducedMotion ? { duration: 0.18 } : SPRING}
      className="flex flex-col items-center gap-2"
    >
      <button
        type="button"
        onClick={() => void save()}
        aria-busy={loading}
        className="flex h-11 min-w-[13.5rem] items-center justify-center gap-2.5 rounded-full bg-[#1f1f1f] pl-4 pr-5 text-[14px] font-medium tracking-[0.01em] text-white shadow-[0_8px_22px_-12px_rgba(0,0,0,0.6)] transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
        style={dark ? { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.32)' } : undefined}
      >
        {loading ? <Spinner /> : <WalletGlyph />}
        <span>Agregar a Google Wallet</span>
      </button>
      {failed && (
        <p
          role="status"
          className="rounded-full px-3 py-1 text-[12px] font-medium"
          style={{ backgroundColor: theme.bubble.bg, color: theme.bubble.fg }}
        >
          No pudimos abrir Google Wallet. Intenta de nuevo.
        </p>
      )}
    </m.div>
  );
};

export default GoogleWalletButton;
