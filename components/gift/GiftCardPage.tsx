// Public gift card page (/:slug/regalo/:uniqueId). The buyer shares this link;
// whoever holds it sees the card, can name the recipient once, and books.
// Brand "Pan de oro": Moka, Oro and cream; Gilda Display + Hanken Grotesk.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Share2, CalendarHeart, Check, Copy, Loader2 } from 'lucide-react';
import {
  ApiError,
  fetchPublicGift,
  formatCop,
  formatGiftDate,
  GIFT_STATUS_LABEL,
  setPublicGiftRecipient,
  type GiftCardEffectiveStatus,
  type PublicGift,
} from '../../lib/db/giftCards';
import { GiftCardFace, GIFT_BRAND as B, GIFT_FONTS, useGiftFonts } from './GiftCardFace';

const BOOKING_URL = import.meta.env.VITE_GIFT_BOOKING_URL?.trim() || 'https://goldenbeautystudio.com.co/reservar';

const openedKey = (uniqueId: string) => `gift-opened:${uniqueId}`;
const readOpened = (uniqueId: string) => {
  try {
    return window.localStorage.getItem(openedKey(uniqueId)) === '1';
  } catch {
    return false;
  }
};
const writeOpened = (uniqueId: string) => {
  try {
    window.localStorage.setItem(openedKey(uniqueId), '1');
  } catch {
    // private mode: the unwrap just plays again next time
  }
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const STATUS_TONE: Record<GiftCardEffectiveStatus, { bg: string; fg: string; dot: string }> = {
  pending_payment: { bg: '#F7EFDD', fg: '#7B501A', dot: '#C79C45' },
  active: { bg: B.moka, fg: B.oroPale, dot: B.oroLight },
  redeemed: { bg: '#E9E5E3', fg: '#4B3E36', dot: '#7C706A' },
  expired: { bg: '#E9E5E3', fg: '#5F534B', dot: '#A89F9A' },
  void: { bg: '#FFE9E6', fg: '#922C27', dot: '#E0312E' },
};

const StatusRibbon: React.FC<{ status: GiftCardEffectiveStatus }> = ({ status }) => {
  const tone = STATUS_TONE[status];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase"
      style={{ background: tone.bg, color: tone.fg, letterSpacing: '0.16em' }}
      data-testid="gift-status"
    >
      <span className="relative flex h-1.5 w-1.5">
        {status === 'active' && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: tone.dot }} />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
      </span>
      {GIFT_STATUS_LABEL[status]}
    </span>
  );
};

const Divider = () => (
  <div className="flex items-center gap-3 py-1" aria-hidden>
    <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${B.oro}55)` }} />
    <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 0 6.2 3.8 10 5 6.2 6.2 5 10 3.8 6.2 0 5 3.8 3.8Z" fill={B.oro} /></svg>
    <span className="h-px flex-1" style={{ background: `linear-gradient(270deg, transparent, ${B.oro}55)` }} />
  </div>
);

/** "¿Para quién es este regalo?" — once, then it's fixed. */
const RecipientForm: React.FC<{ onSave: (name: string, phone?: string) => Promise<void> }> = ({ onSave }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const phoneDigits = phone.replace(/\D+/g, '');
  const phoneOk = phoneDigits.length === 0 || phoneDigits.length >= 10;
  const valid = trimmed.length >= 2 && trimmed.length <= 40 && phoneOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed, phoneDigits ? phone.trim() : undefined);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'RECIPIENT_ALREADY_SET'
          ? 'Alguien ya escribió el nombre de esta tarjeta.'
          : 'No pudimos guardar el nombre. Inténtalo de nuevo.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2.5" data-testid="gift-recipient-form">
      <label htmlFor="gift-recipient" className="block text-[15px]" style={{ fontFamily: GIFT_FONTS.display, color: B.moka }}>
        ¿Para quién es este regalo?
      </label>
      <div className="flex gap-2">
        <input
          id="gift-recipient"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder="Su nombre"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border bg-white px-4 py-3 text-[15px] outline-none transition focus:ring-2"
          style={{ borderColor: '#E7DAD2', color: B.ink, ['--tw-ring-color' as string]: `${B.oro}55` }}
        />
        <button
          type="submit"
          disabled={!valid || saving}
          className="inline-flex items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-40"
          style={{ background: B.moka, color: B.cream }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
        </button>
      </div>
      <input
        id="gift-recipient-phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 16))}
        placeholder="Su WhatsApp (opcional)"
        inputMode="tel"
        autoComplete="off"
        aria-label="WhatsApp de quien recibe (opcional)"
        className="w-full rounded-xl border bg-white px-4 py-3 text-[15px] outline-none transition focus:ring-2"
        style={{ borderColor: phoneOk ? '#E7DAD2' : '#B4312B', color: B.ink, ['--tw-ring-color' as string]: `${B.oro}55` }}
      />
      <p className="text-xs" style={{ color: error ? '#B4312B' : '#7C706A' }}>
        {error ?? 'Con su WhatsApp, la tarjeta también aparece en su tarjeta de puntos. Solo se puede escribir una vez, así que revísalo bien.'}
      </p>
    </form>
  );
};

/** Wrapping over the card on first view: a ribbon and bow that slide away. */
const Wrapping: React.FC<{ opening: boolean; onOpen: () => void }> = ({ opening, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    aria-label="Abrir mi regalo"
    data-testid="gift-unwrap"
    className="gc-wrap absolute inset-0 z-20 overflow-hidden rounded-[22px] outline-none"
    data-opening={opening ? '1' : '0'}
  >
    <span className="gc-wrap-paper absolute inset-0 rounded-[22px]" />
    <span className="gc-ribbon-v absolute inset-y-0 left-1/2 w-9 -translate-x-1/2" />
    <span className="gc-ribbon-h absolute inset-x-0 top-1/2 h-9 -translate-y-1/2" />
    <svg className="gc-bow absolute left-1/2 top-1/2 h-24 w-28 -translate-x-1/2 -translate-y-[62%]" viewBox="0 0 112 96" aria-hidden>
      <defs>
        <linearGradient id="gc-bow-g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#EEC87B" />
          <stop offset="0.45" stopColor="#AC8231" />
          <stop offset="1" stopColor="#7B501A" />
        </linearGradient>
      </defs>
      <path d="M56 52C40 26 10 18 8 38s28 26 48 14Z" fill="url(#gc-bow-g)" />
      <path d="M56 52c16-26 46-34 48-14S76 64 56 52Z" fill="url(#gc-bow-g)" />
      <path d="M52 54 38 92l10-4 6 8 4-42Z" fill="#936620" />
      <path d="M60 54l14 38-10-4-6 8-4-42Z" fill="#936620" />
      <ellipse cx="56" cy="52" rx="9" ry="8" fill="#C79C45" />
    </svg>
    <span className="gc-wrap-label absolute inset-x-0 bottom-[9%] flex justify-center">
      <span
        className="rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase shadow-sm"
        style={{ color: B.moka, background: B.cream, letterSpacing: '0.28em' }}
      >
        Toca para abrir
      </span>
    </span>
  </button>
);

const PageStyles = () => (
  <style>{`
    .gc-wrap-paper{background:
      radial-gradient(120% 80% at 20% 0%, #FFFDFB 0%, #F6EEE8 55%, #EBDDD3 100%);}
    .gc-wrap-paper::after{content:"";position:absolute;inset:0;border-radius:22px;opacity:.5;
      background-image:radial-gradient(#AC823122 1px, transparent 1.4px);background-size:14px 14px;}
    .gc-ribbon-v,.gc-ribbon-h{background:linear-gradient(90deg,#936620,#D8AD57 30%,#F2DFB9 50%,#C79C45 70%,#936620);
      box-shadow:0 0 0 1px #7B501A22;}
    .gc-ribbon-h{background:linear-gradient(180deg,#936620,#D8AD57 30%,#F2DFB9 50%,#C79C45 70%,#936620);}
    .gc-bow{filter:drop-shadow(0 6px 10px rgba(74,52,38,.28));animation:gc-bob 2.8s ease-in-out infinite;}
    @keyframes gc-bob{0%,100%{transform:translate(-50%,-62%) rotate(0)}50%{transform:translate(-50%,-66%) rotate(-3deg)}}
    .gc-wrap[data-opening="1"] .gc-ribbon-v{transition:transform .7s cubic-bezier(.7,0,.3,1),opacity .7s;transform:translate(-50%,-110%);opacity:0}
    .gc-wrap[data-opening="1"] .gc-ribbon-h{transition:transform .7s cubic-bezier(.7,0,.3,1) .05s,opacity .7s;transform:translate(110%,-50%);opacity:0}
    .gc-wrap[data-opening="1"] .gc-bow{animation:none;transition:transform .55s cubic-bezier(.5,-0.4,.7,1),opacity .5s;transform:translate(-50%,-160%) scale(.6) rotate(-20deg);opacity:0}
    .gc-wrap[data-opening="1"] .gc-wrap-paper{transition:opacity .6s ease .35s,transform .8s cubic-bezier(.7,0,.3,1) .3s;opacity:0;transform:translateY(18%) scale(1.04)}
    .gc-wrap[data-opening="1"] .gc-wrap-label{transition:opacity .2s;opacity:0}
    .gc-reveal{animation:gc-reveal .9s cubic-bezier(.2,.8,.2,1) both}
    @keyframes gc-reveal{0%{transform:translateY(10px) scale(.97)}60%{transform:translateY(-4px) scale(1.01)}100%{transform:none}}
    .gc-fade{animation:gc-fade .7s ease both}
    @keyframes gc-fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    @media (prefers-reduced-motion: reduce){.gc-bow,.gc-reveal,.gc-fade{animation:none!important}}
  `}</style>
);

const Terms: React.FC<{ gift: PublicGift }> = ({ gift }) => (
  <ul className="space-y-2 text-[13px] leading-relaxed" style={{ color: '#5F534B' }}>
    {gift.terms.map((t) => (
      <li key={t}>{t}</li>
    ))}
  </ul>
);

const validityLine = (gift: PublicGift) => {
  switch (gift.effectiveStatus) {
    case 'pending_payment':
      return 'Tu tarjeta se activa cuando el estudio confirme el pago. Desde ese día tienes un año para usarla.';
    case 'active':
      return gift.validTo ? `Válida hasta el ${formatGiftDate(gift.validTo, { day: 'numeric', month: 'long', year: 'numeric' })}.` : '';
    case 'redeemed':
      return 'Esta tarjeta ya se usó. Esperamos que la hayas disfrutado.';
    case 'expired':
      return gift.validTo ? `Venció el ${formatGiftDate(gift.validTo, { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Esta tarjeta venció.';
    case 'void':
      return 'Esta tarjeta fue anulada. Si crees que es un error, escríbenos.';
  }
};

const GiftCardPage: React.FC = () => {
  const { slug, uniqueId } = useParams<{ slug: string; uniqueId: string }>();
  const [gift, setGift] = useState<PublicGift | null>(null);
  const [loading, setLoading] = useState(true);
  const [wrapped, setWrapped] = useState(false);
  const [opening, setOpening] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  useGiftFonts();

  useEffect(() => {
    if (!slug || !uniqueId) return;
    let alive = true;
    void fetchPublicGift(slug, uniqueId).then((g) => {
      if (!alive) return;
      setGift(g);
      setLoading(false);
      // Unwrap only for a card that is still a present (not used / voided).
      const giftable = g && (g.effectiveStatus === 'active' || g.effectiveStatus === 'pending_payment');
      setWrapped(Boolean(giftable && !readOpened(uniqueId)));
    });
    return () => {
      alive = false;
      clearTimeout(openTimer.current);
    };
  }, [slug, uniqueId]);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = gift ? `Tarjeta regalo · ${gift.business.name}` : 'Tarjeta regalo';
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevColor = meta?.getAttribute('content');
    meta?.setAttribute('content', B.cream);
    return () => {
      document.title = prevTitle;
      if (meta && prevColor) meta.setAttribute('content', prevColor);
    };
  }, [gift]);

  const open = useCallback(() => {
    if (!uniqueId || opening) return;
    writeOpened(uniqueId);
    if (prefersReducedMotion()) {
      setWrapped(false);
      return;
    }
    setOpening(true);
    openTimer.current = setTimeout(() => {
      setWrapped(false);
      setOpening(false);
      setJustOpened(true);
    }, 1050);
  }, [uniqueId, opening]);

  const shareUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0]! : '';
  const shareText = useMemo(
    () => `Tienes un regalo de ${gift?.business.name ?? 'Golden Beauty Studio'} 🎁 Ábrelo aquí:`,
    [gift?.business.name],
  );

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Tarjeta regalo', text: shareText, url: shareUrl });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`, '_blank', 'noopener');
  };

  const copyCode = async () => {
    if (!gift) return;
    try {
      await navigator.clipboard.writeText(gift.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: the code is on screen anyway
    }
  };

  const saveRecipient = async (name: string, phone?: string) => {
    if (!slug || !uniqueId) return;
    const next = await setPublicGiftRecipient(slug, uniqueId, name, phone);
    setGift(next);
  };

  const shell = (children: React.ReactNode) => (
    <div
      className="relative min-h-[100dvh] overflow-x-hidden"
      style={{ background: B.cream, color: B.ink, fontFamily: GIFT_FONTS.text }}
    >
      <PageStyles />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background: `radial-gradient(60% 70% at 50% 0%, ${B.oroPale}aa 0%, transparent 70%), radial-gradient(40% 50% at 100% 10%, #E7DAD2 0%, transparent 70%)`,
        }}
      />
      <div className="relative mx-auto w-full max-w-[1040px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">{children}</div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: B.oro }} />
      </div>,
    );
  }

  if (!gift) {
    return shell(
      <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center text-center">
        <p className="text-3xl" style={{ fontFamily: GIFT_FONTS.display, color: B.moka }}>Tarjeta no encontrada</p>
        <p className="mt-3 text-sm" style={{ color: '#7C706A' }}>Revisa que el enlace esté completo o pide que te lo envíen de nuevo.</p>
      </div>,
    );
  }

  const status = gift.effectiveStatus;
  const canName = (status === 'pending_payment' || status === 'active') && !gift.recipientName;
  const live = status === 'active' || status === 'pending_payment';

  return shell(
    <>
      <header className="mb-8 flex flex-col items-center gap-3 text-center sm:mb-12">
        {gift.business.logo ? (
          <img src={gift.business.logo} alt={gift.business.name} className="h-14 w-14 rounded-full object-cover shadow-sm ring-1" style={{ ['--tw-ring-color' as string]: `${B.oro}40` }} />
        ) : null}
        <p className="text-[11px] font-semibold uppercase" style={{ color: B.oro, letterSpacing: '0.34em' }}>
          {gift.business.name}
        </p>
      </header>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
        {/* Card */}
        <section className="mx-auto w-full max-w-[460px] lg:sticky lg:top-12">
          <div className="mb-5 flex justify-center lg:justify-start">
            <StatusRibbon status={status} />
          </div>
          <div className={`relative ${justOpened ? 'gc-reveal' : ''}`}>
            <GiftCardFace
              amountCop={gift.amountCop}
              tierName={gift.tierName}
              code={gift.code}
              validTo={gift.validTo}
              status={status}
              businessName={gift.business.name}
              logo={gift.business.logo}
              hideCode={wrapped}
            />
            {wrapped && <Wrapping opening={opening} onOpen={open} />}
          </div>
          {!wrapped && live && (
            <button
              type="button"
              onClick={copyCode}
              className="mx-auto mt-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition hover:bg-white/70 lg:mx-0"
              style={{ color: B.moka }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Código copiado' : 'Copiar código'}
            </button>
          )}
        </section>

        {wrapped && (
          <p className="gc-fade mx-auto max-w-[460px] text-center text-[28px] leading-tight lg:self-center lg:text-left lg:text-[40px]" style={{ fontFamily: GIFT_FONTS.display, color: B.moka }}>
            {gift.buyerFirstName ? `${gift.buyerFirstName} te envió un regalo` : 'Tienes un regalo'}
          </p>
        )}

        {/* Details */}
        <section className={`mx-auto w-full max-w-[460px] space-y-7 ${wrapped ? 'hidden' : 'gc-fade'}`}>
          <div className="space-y-2 text-center lg:text-left">
            <h1 className="text-[34px] leading-[1.1] sm:text-[42px]" style={{ fontFamily: GIFT_FONTS.display, color: B.moka }}>
              {status === 'redeemed' ? 'Un regalo disfrutado' : gift.recipientName ? `Un regalo para ${gift.recipientName}` : 'Un regalo para ti'}
            </h1>
            <p className="text-[15px]" style={{ color: '#5F534B' }}>{validityLine(gift)}</p>
          </div>

          <div className="rounded-2xl border bg-white/70 p-5 shadow-[0_1px_0_rgba(74,52,38,0.04),0_12px_32px_-18px_rgba(74,52,38,0.35)] backdrop-blur-sm sm:p-6" style={{ borderColor: '#E7DAD2' }}>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-3">
              {gift.buyerFirstName && (
                <>
                  <dt className="text-[11px] font-semibold uppercase" style={{ color: B.oro, letterSpacing: '0.24em' }}>De</dt>
                  <dd className="text-xl" style={{ fontFamily: GIFT_FONTS.display, color: B.moka }}>{gift.buyerFirstName}</dd>
                </>
              )}
              {gift.recipientName && (
                <>
                  <dt className="text-[11px] font-semibold uppercase" style={{ color: B.oro, letterSpacing: '0.24em' }}>Para</dt>
                  <dd className="text-xl" style={{ fontFamily: GIFT_FONTS.display, color: B.moka }} data-testid="gift-recipient">{gift.recipientName}</dd>
                </>
              )}
            </dl>
            {canName && (
              <div className={gift.buyerFirstName ? 'mt-5 border-t pt-5' : ''} style={{ borderColor: '#F3EDE9' }}>
                <RecipientForm onSave={saveRecipient} />
              </div>
            )}
            {gift.message && (
              <>
                <div className="my-5"><Divider /></div>
                <blockquote className="px-2 text-center">
                  <span aria-hidden className="block h-6 text-5xl leading-none" style={{ fontFamily: GIFT_FONTS.display, color: `${B.oro}88` }}>“</span>
                  <p className="text-[19px] leading-snug" style={{ fontFamily: GIFT_FONTS.display, color: B.moka }}>{gift.message}</p>
                </blockquote>
              </>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {status !== 'void' && (
              <a
                href={BOOKING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[15px] font-semibold shadow-[0_10px_24px_-12px_rgba(74,52,38,0.6)] transition hover:brightness-110"
                style={{ background: `linear-gradient(135deg, ${B.moka}, #5C4231)`, color: B.cream }}
              >
                <CalendarHeart className="h-4 w-4" style={{ color: B.oroLight }} />
                {status === 'redeemed' || status === 'expired' ? 'Reservar otra cita' : 'Reservar mi cita'}
              </a>
            )}
            {live && (
              <button
                type="button"
                onClick={share}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-5 py-3.5 text-[15px] font-semibold transition hover:bg-white"
                style={{ borderColor: `${B.oro}80`, color: B.moka }}
              >
                <Share2 className="h-4 w-4" style={{ color: B.oro }} />
                Compartir
              </button>
            )}
          </div>

          <details className="group rounded-2xl border px-5 py-4" style={{ borderColor: '#E7DAD2' }} open={status === 'active'}>
            <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold uppercase" style={{ color: B.moka, letterSpacing: '0.16em' }}>
              Condiciones
              <span className="text-lg transition group-open:rotate-45" style={{ color: B.oro }}>+</span>
            </summary>
            <div className="mt-3"><Terms gift={gift} /></div>
          </details>
        </section>
      </div>

      <footer className="mt-16 text-center text-[11px] uppercase" style={{ color: '#A89F9A', letterSpacing: '0.24em' }}>
        {gift.business.name}
      </footer>
    </>,
  );
};

export default GiftCardPage;
