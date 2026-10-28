// "Agregar a tu inicio" (docs/CARD_ENGAGEMENT_PLAN.md §7.2).
// Android/Chrome: a small pill that fires the captured `beforeinstallprompt`.
// iOS Safari: the same pill opens a sheet with the Share → "Agregar a inicio"
// steps. Shown on the client's 2nd open of this card, or right after a stamp
// lands; dismiss snoozes it for 14 days; never shown when already installed.
// Also wires this card's manifest/theme-color/touch-icon into <head>.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'motion/react';
import { useCardFx } from './CardFxContext';
import { usePwaManifest } from '../../lib/card/usePwaManifest';
import {
  consumeDeferredInstallPrompt,
  detectInstallPlatform,
  getDeferredInstallPrompt,
  isStandaloneDisplay,
  readInstallState,
  recordCardOpen,
  recordInstallDismissed,
  shouldOfferInstall,
  startInstallPromptCapture,
  subscribeInstallPrompt,
  type InstallPlatform,
} from '../../lib/card/installPrompt';
import { resolveHexAndOpacity } from '../../lib/utils';

const SPRING = { type: 'spring', stiffness: 260, damping: 24, mass: 0.9 } as const;
// Let the slam/celebration finish before asking.
const AFTER_STAMP_DELAY_MS = 1400;

/**
 * Keeps an element mounted until its exit animation finishes. A few lines
 * instead of AnimatePresence, which costs ~5 kB gzip in the card chunk.
 */
const usePresence = (show: boolean) => {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) setMounted(true);
  }, [show]);
  const onAnimationComplete = useCallback(() => {
    if (!show) setMounted(false);
  }, [show]);
  return { mounted: mounted || show, onAnimationComplete };
};

const ShareGlyph: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
    <path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" />
  </svg>
);

const AddGlyph: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
);

/** Phone with Safari's toolbar: Share highlighted, then the menu row. */
const IosIllustration: React.FC<{ accent: string; fg: string }> = ({ accent, fg }) => (
  <svg viewBox="0 0 220 132" className="h-auto w-full max-w-[15rem]" aria-hidden>
    {/* phone */}
    <rect x="8" y="6" width="96" height="120" rx="16" fill="none" stroke={fg} strokeOpacity="0.35" strokeWidth="2" />
    <rect x="22" y="20" width="68" height="44" rx="8" fill={accent} fillOpacity="0.9" />
    <circle cx="36" cy="34" r="5" fill={fg} fillOpacity="0.0" stroke="#fff" strokeOpacity="0.85" strokeWidth="2" />
    <rect x="22" y="72" width="44" height="5" rx="2.5" fill={fg} fillOpacity="0.2" />
    <rect x="22" y="82" width="30" height="5" rx="2.5" fill={fg} fillOpacity="0.14" />
    {/* toolbar */}
    <line x1="9" y1="102" x2="103" y2="102" stroke={fg} strokeOpacity="0.2" strokeWidth="1.5" />
    <circle cx="56" cy="113" r="11" fill={accent} fillOpacity="0.18" />
    <g transform="translate(48 105)" color={accent}>
      <ShareGlyph size={16} />
    </g>
    {/* arrow */}
    <path d="M114 96c10 0 16-8 20-20" fill="none" stroke={fg} strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
    <path d="m129 79 5-4 2 6" fill="none" stroke={fg} strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    {/* share sheet row */}
    <rect x="118" y="30" width="98" height="40" rx="10" fill={fg} fillOpacity="0.08" stroke={fg} strokeOpacity="0.18" />
    <text x="126" y="53.5" fontSize="9.5" fontWeight="600" fill={fg} fontFamily="system-ui, -apple-system, sans-serif">Agregar a inicio</text>
    <g transform="translate(199 43)" color={fg}>
      <AddGlyph size={13} />
    </g>
  </svg>
);

export const InstallPrompt: React.FC = () => {
  const { slug, card, template, theme, reducedMotion, bus, trackInteraction } = useCardFx();
  const themeColor = resolveHexAndOpacity(template.colors.background, '#ffffff').hex;
  usePwaManifest({ slug, uniqueId: card.uniqueId, themeColor });

  const [platform] = useState<InstallPlatform>(() =>
    typeof navigator === 'undefined' ? 'none' : detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints),
  );
  const [opens, setOpens] = useState(0);
  const [stampLanded, setStampLanded] = useState(false);
  const [hasPrompt, setHasPrompt] = useState(() => getDeferredInstallPrompt() !== null);
  const [closed, setClosed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setOpens(recordCardOpen(card.uniqueId));
  }, [card.uniqueId]);

  useEffect(() => {
    startInstallPromptCapture();
    setHasPrompt(getDeferredInstallPrompt() !== null);
    return subscribeInstallPrompt(() => setHasPrompt(getDeferredInstallPrompt() !== null));
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = bus.on('stamp:landed', () => {
      clearTimeout(timer);
      timer = setTimeout(() => setStampLanded(true), AFTER_STAMP_DELAY_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [bus]);

  const path = typeof window === 'undefined' ? '' : window.location.pathname;
  const { dismissedAt, installed } = readInstallState(path);
  const eligible =
    opens > 0 &&
    shouldOfferInstall({ opens, stampLanded, dismissedAt, installed, standalone: isStandaloneDisplay(), now: Date.now() });
  const canInstall = platform === 'ios' || (platform === 'prompt' && hasPrompt);
  const visible = eligible && canInstall && !closed;

  const dismiss = useCallback(() => {
    recordInstallDismissed();
    setSheetOpen(false);
    setClosed(true);
  }, []);

  const handleInstall = useCallback(async () => {
    if (platform === 'ios') {
      trackInteraction('install_prompt');
      setSheetOpen(true);
      return;
    }
    const event = consumeDeferredInstallPrompt();
    if (!event) return;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') {
        trackInteraction('install_prompt');
        setClosed(true);
      } else {
        dismiss();
      }
    } catch {
      setClosed(true);
    }
  }, [dismiss, platform, trackInteraction]);

  const showPill = visible && !sheetOpen;
  const pill = usePresence(showPill);
  const sheet = usePresence(sheetOpen);

  const hidden = reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.94 };
  const shown = reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const fade = { duration: 0.18 };

  return (
    <>
      {pill.mounted && (
          <m.div
            initial={hidden}
            animate={showPill ? shown : hidden}
            transition={showPill && !reducedMotion ? SPRING : fade}
            onAnimationComplete={pill.onAnimationComplete}
            className="flex items-center rounded-full pl-1 pr-1 shadow-[0_10px_28px_-14px_rgba(0,0,0,0.45)] backdrop-blur-md"
            style={{ backgroundColor: theme.bubble.bg, color: theme.bubble.fg }}
          >
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="flex h-9 items-center gap-1.5 rounded-full pl-3 pr-2 text-[13px] font-semibold tracking-[0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <span aria-hidden>📲</span>
              Agregar a tu inicio
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Ahora no"
              className="flex h-7 w-7 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </m.div>
      )}

      {sheet.mounted &&
        typeof document !== 'undefined' &&
        createPortal(
              <div className={`fixed inset-0 z-[80] flex items-end justify-center ${sheetOpen ? '' : 'pointer-events-none'}`}>
                <m.button
                  type="button"
                  aria-label="Cerrar"
                  className="absolute inset-0 bg-black/40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: sheetOpen ? 1 : 0 }}
                  transition={{ duration: 0.22 }}
                  onAnimationComplete={sheet.onAnimationComplete}
                  onClick={() => setSheetOpen(false)}
                />
                <m.div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="install-sheet-title"
                  initial={reducedMotion ? { opacity: 0 } : { y: '100%' }}
                  animate={reducedMotion ? { opacity: sheetOpen ? 1 : 0 } : { y: sheetOpen ? '0%' : '100%' }}
                  transition={reducedMotion ? { duration: 0.2 } : { type: 'spring', stiffness: 300, damping: 32 }}
                  className="relative w-full max-w-md rounded-t-[28px] px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-3 shadow-[0_-18px_50px_-20px_rgba(0,0,0,0.5)] backdrop-blur-xl"
                  // Bubble colors may be translucent; doubling the layer keeps the
                  // sheet readable mid-slide, before backdrop blur settles.
                  style={{
                    backgroundColor: theme.bubble.bg,
                    backgroundImage: `linear-gradient(${theme.bubble.bg}, ${theme.bubble.bg})`,
                    color: theme.bubble.fg,
                  }}
                >
                  <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-current opacity-20" />
                  <h2 id="install-sheet-title" className="text-center text-lg font-bold tracking-tight" style={{ color: theme.bubble.fg }}>
                    Lleva tu tarjeta en tu inicio
                  </h2>
                  <p className="mt-1 text-center text-sm opacity-70">Ábrela con un toque, como una app.</p>
                  <div className="my-4 flex justify-center">
                    <IosIllustration accent={theme.accent} fg={theme.bubble.fg} />
                  </div>
                  <ol className="space-y-2.5 text-[15px]">
                    <li className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(127,127,127,0.18)' }}>1</span>
                      <span>
                        Toca <span className="inline-flex translate-y-[2px]" style={{ color: theme.accent }}><ShareGlyph /></span>{' '}
                        <b>Compartir</b> en la barra de Safari.
                      </span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(127,127,127,0.18)' }}>2</span>
                      <span>
                        Elige <b>Agregar a inicio</b> <span className="inline-flex translate-y-[2px]"><AddGlyph /></span>
                      </span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(127,127,127,0.18)' }}>3</span>
                      <span>
                        Toca <b>Agregar</b>. ¡Listo!
                      </span>
                    </li>
                  </ol>
                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={dismiss}
                      className="h-11 flex-1 rounded-full text-sm font-semibold opacity-70 transition-opacity hover:opacity-100"
                    >
                      Ahora no
                    </button>
                    <button
                      type="button"
                      // They're adding it now; if they didn't, ask again in 14 days.
                      onClick={dismiss}
                      className="h-11 flex-1 rounded-full text-sm font-semibold shadow-sm"
                      style={{ backgroundColor: theme.accent, color: theme.ink }}
                    >
                      Entendido
                    </button>
                  </div>
                </m.div>
              </div>,
          document.body,
        )}
    </>
  );
};
