// The gift card itself (credit-card ratio): Moka with gold-foil type and a
// guilloche flourish. Used by the public page and the admin preview.
import React, { useEffect } from 'react';
import { formatCop, formatGiftDate, type GiftCardEffectiveStatus } from '../../lib/db/giftCards';

export const GIFT_BRAND = {
  moka: '#4A3426',
  mokaDeep: '#302621',
  oro: '#AC8231',
  oroLight: '#D8AD57',
  oroPale: '#F2DFB9',
  cream: '#FBF6F4',
  ink: '#241912',
} as const;

export const GIFT_FONTS = {
  display: '"Gilda Display", Didot, "Bodoni 72", Georgia, serif',
  text: '"Hanken Grotesk", system-ui, -apple-system, sans-serif',
} as const;

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Gilda+Display&family=Hanken+Grotesk:wght@400;500;600;700&display=swap';

/** Loads the brand fonts once (only on gift pages; the rest of the app keeps its stack). */
export const useGiftFonts = () => {
  useEffect(() => {
    if (document.querySelector('link[data-gift-fonts]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    link.dataset.giftFonts = '1';
    document.head.appendChild(link);
  }, []);
};

const FOIL = 'linear-gradient(115deg, #936620 0%, #D8AD57 22%, #F7E7C4 38%, #C79C45 55%, #AC8231 72%, #EEC87B 88%, #936620 100%)';

const foilText: React.CSSProperties = {
  backgroundImage: FOIL,
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
};

const STAMP_LABEL: Partial<Record<GiftCardEffectiveStatus, string>> = {
  redeemed: 'Disfrutada',
  expired: 'Vencida',
  void: 'Anulada',
};

const Guilloche: React.FC = () => (
  <svg className="absolute -right-16 -top-20 h-[150%] w-[85%] opacity-[0.16]" viewBox="0 0 200 200" aria-hidden>
    {Array.from({ length: 14 }, (_, i) => (
      <ellipse
        key={i}
        cx="100"
        cy="100"
        rx={30 + i * 5}
        ry={70 - i * 2.5}
        transform={`rotate(${i * 13} 100 100)`}
        fill="none"
        stroke="#D8AD57"
        strokeWidth="0.5"
      />
    ))}
  </svg>
);

export const GiftCardFace: React.FC<{
  amountCop: number;
  tierName: string;
  code: string;
  validTo: string | null;
  status: GiftCardEffectiveStatus;
  businessName: string;
  logo?: string | null;
  hideCode?: boolean;
  className?: string;
}> = ({ amountCop, tierName, code, validTo, status, businessName, logo, hideCode, className }) => {
  const spent = status === 'redeemed' || status === 'expired' || status === 'void';
  const stamp = STAMP_LABEL[status];
  return (
    <div
      className={`gc-card relative aspect-[1.586] w-full select-none overflow-hidden rounded-[22px] ${className ?? ''}`}
      style={{
        background: `radial-gradient(120% 95% at 0% 0%, #5C4231 0%, ${GIFT_BRAND.moka} 42%, ${GIFT_BRAND.mokaDeep} 100%)`,
        boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset, 0 30px 60px -28px rgba(48,38,33,0.75), 0 12px 24px -16px rgba(48,38,33,0.5)',
        filter: spent ? 'grayscale(0.55) brightness(0.92)' : undefined,
        fontFamily: GIFT_FONTS.text,
      }}
      data-testid="gift-card-face"
    >
      <style>{`
        .gc-card .gc-sheen{position:absolute;inset:-40%;background:linear-gradient(105deg,transparent 40%,rgba(255,240,210,.16) 50%,transparent 60%);
          transform:translateX(-60%);animation:gc-sheen 6s ease-in-out 1.2s infinite;}
        @keyframes gc-sheen{0%,70%{transform:translateX(-60%)}100%{transform:translateX(60%)}}
        @media (prefers-reduced-motion: reduce){.gc-card .gc-sheen{animation:none;opacity:0}}
      `}</style>
      <Guilloche />
      {!spent && <div className="gc-sheen pointer-events-none" aria-hidden />}
      <div className="pointer-events-none absolute inset-[10px] rounded-[16px] border sm:inset-3" style={{ borderColor: 'rgba(216,173,87,0.38)' }} />

      <div className="relative flex h-full flex-col justify-between p-[7%]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold uppercase sm:text-[10px]" style={{ color: GIFT_BRAND.oroLight, letterSpacing: '0.34em' }}>
              Tarjeta regalo
            </p>
            <p className="mt-1 max-w-[12rem] truncate text-[13px] sm:text-[15px]" style={{ fontFamily: GIFT_FONTS.display, color: 'rgba(251,246,244,0.82)' }}>
              {businessName}
            </p>
          </div>
          {logo ? (
            <img src={logo} alt="" className="h-9 w-9 rounded-full object-cover ring-1 sm:h-11 sm:w-11" style={{ ['--tw-ring-color' as string]: 'rgba(216,173,87,0.55)' }} />
          ) : null}
        </div>

        <div>
          <p className="text-[clamp(2rem,9vw,3.4rem)] leading-none tracking-tight" style={{ ...foilText, fontFamily: GIFT_FONTS.display }} data-testid="gift-amount">
            {formatCop(amountCop)}
          </p>
          {tierName && (
            <p className="mt-2 text-[10px] font-semibold uppercase sm:text-[11px]" style={{ color: 'rgba(242,223,185,0.8)', letterSpacing: '0.3em' }}>
              {tierName}
            </p>
          )}
        </div>

        <div className="flex items-end justify-between gap-3">
          <p
            className="text-[12px] font-medium tabular-nums sm:text-[14px]"
            style={{ color: GIFT_BRAND.cream, letterSpacing: '0.2em', filter: hideCode ? 'blur(5px)' : undefined }}
            data-testid="gift-code"
          >
            {hideCode ? 'TR-••••-••••' : code}
          </p>
          {validTo && (
            <p className="text-right text-[9px] uppercase leading-tight sm:text-[10px]" style={{ color: 'rgba(251,246,244,0.6)', letterSpacing: '0.18em' }}>
              Válida hasta
              <span className="block text-[11px] normal-case tracking-normal sm:text-[12px]" style={{ color: 'rgba(251,246,244,0.85)' }}>
                {formatGiftDate(validTo)}
              </span>
            </p>
          )}
        </div>
      </div>

      {stamp && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-end pr-[8%] pt-[30%]">
          <span
            className="rotate-[-14deg] rounded-md border-2 px-4 py-1.5 text-sm font-bold uppercase sm:text-base"
            style={{ borderColor: 'rgba(242,223,185,0.85)', color: 'rgba(242,223,185,0.92)', letterSpacing: '0.3em', background: 'rgba(48,38,33,0.35)' }}
          >
            {stamp}
          </span>
        </div>
      )}
    </div>
  );
};
