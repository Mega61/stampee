// The gift as a ticket (stub + notches) and as a gift card, shared by the
// opening reveal and "Mis regalos".
import React, { useState } from 'react';
import { ChevronDown, Gift, QrCode, Send } from 'lucide-react';
import type { AdventReward, CustomerGiftCard } from '../../../lib/advent/types';
import {
  canGiveGiftCard,
  canShowAtCheckout,
  fmtCOP,
  giftCardChip,
  giftCardFaceLine,
  giftCardLaterLine,
  rewardChip,
  rewardValidity,
  type Chip,
} from '../../../lib/advent/viewModel';
import { assetUrl } from './assets';
import { CardBow } from './decor';

const chipClass = (chip: Chip) => `adv-chip ${chip.tone === 'plain' ? '' : chip.tone}`;
const spent = (chip: Chip) => chip.tone === 'used' || chip.tone === 'late';

/** Words stay whole; letters rise in one by one. */
export const Letters: React.FC<{ text: string }> = ({ text }) => {
  let i = 0;
  return (
    <>
      {text.split(' ').map((word, w) => (
        <React.Fragment key={w}>
          {w > 0 && ' '}
          <span className="w">
            {[...word].map((c, k) => (
              <span key={k} style={{ animationDelay: `${Math.min(i++ * 22, 700)}ms` }}>
                {c}
              </span>
            ))}
          </span>
        </React.Fragment>
      ))}
    </>
  );
};

/** "Términos y condiciones" that unfolds inside a ticket. */
export const TermsInline: React.FC<{ terms: string[]; onAll: () => void }> = ({ terms, onAll }) => {
  const [open, setOpen] = useState(false);
  const id = React.useId();
  return (
    <div>
      <button type="button" className="adv-terms-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Términos y condiciones <ChevronDown aria-hidden />
      </button>
      <div id={id} className="adv-terms-in" hidden={!open}>
        <ul>
          {terms.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        <div className="common">
          <button type="button" className="adv-terms-btn" onClick={onAll}>
            Ver las condiciones de todo el calendario
          </button>
        </div>
      </div>
    </div>
  );
};

export const GiftTicket: React.FC<{
  reward: AdventReward;
  /** Server time (ms). */
  now: number;
  opensUntil: number;
  month: string;
  /** The reveal: bigger, letters animate in, no chip or actions. */
  big?: boolean;
  lettersGo?: boolean;
  onShowCode?: () => void;
  onOpenTerms?: () => void;
}> = ({ reward, now, opensUntil, month, big, lettersGo, onShowCode, onOpenTerms }) => {
  const chip = rewardChip(reward, now, opensUntil);
  const validity = rewardValidity(reward, now);
  let act: React.ReactNode = null;
  if (!big && canShowAtCheckout(reward, now)) {
    act = (
      <button type="button" className="act" onClick={onShowCode}>
        <QrCode aria-hidden /> Mostrar en caja
      </button>
    );
  } else if (!big && reward.kind === 'link' && reward.url) {
    act = (
      <a className="act" href={reward.url} target="_blank" rel="noopener noreferrer">
        <Gift aria-hidden /> Regalar
      </a>
    );
  }
  return (
    <div className={`adv-ticket${big ? ' big' : ''}${!big && spent(chip) ? ' dim' : ''}`}>
      <div className="stub" aria-hidden>
        <span className="n">{reward.dayLabel}</span>
        <small>{month.slice(0, 3)}</small>
      </div>
      <div className="body">
        <div className={`tt${big ? ` adv-letters${lettersGo ? ' go' : ''}` : ''}`} aria-hidden={big || undefined}>{big ? <Letters text={reward.title} /> : reward.title}</div>
        {big && <span className="sr-only">{reward.title}</span>}
        {reward.subtitle && <div className="ts">{reward.subtitle}</div>}
        {validity && (
          <div className="ts" style={{ fontSize: 12 }}>
            {validity}
          </div>
        )}
        {!big && (
          <div className="meta">
            <span className={chipClass(chip)}>{chip.text}</span>
            {act}
          </div>
        )}
        {!big && reward.terms.length > 0 && onOpenTerms && <TermsInline terms={reward.terms} onAll={onOpenTerms} />}
      </div>
    </div>
  );
};

const Firma: React.FC = () => {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="firma">Golden</span> : <img src={assetUrl('firma')} alt="Golden" onError={() => setFailed(true)} />;
};

export const GiftCardFace: React.FC<{ giftCard: CustomerGiftCard; shine?: boolean; dim?: boolean }> = ({ giftCard, shine, dim }) => (
  <div className={`adv-gc${shine ? ' shine' : ''}${dim ? ' dim' : ''}`}>
    <span className="ribbon" aria-hidden />
    <CardBow />
    <div className="top">
      <Firma />
      <small>Gift card</small>
    </div>
    <div className="amt">{fmtCOP(giftCard.amountCop)}</div>
    {giftCardFaceLine(giftCard) && <div className="sub">{giftCardFaceLine(giftCard)}</div>}
    {giftCard.code && (
      <div className="code">
        <span>{giftCard.code}</span>
      </div>
    )}
  </div>
);

export const GiftCardItem: React.FC<{ giftCard: CustomerGiftCard; now: number; onOpenTerms: () => void }> = ({ giftCard, now, onOpenTerms }) => {
  const chip = giftCardChip(giftCard, now);
  const later = giftCardLaterLine(giftCard, now);
  const from = giftCard.role === 'recipient' && giftCard.buyerFirstName ? `De parte de ${giftCard.buyerFirstName}` : null;
  return (
    <div className="adv-gc-item">
      <GiftCardFace giftCard={giftCard} dim={spent(chip)} />
      <div className="row">
        <span className={chipClass(chip)}>{chip.text}</span>
        {canGiveGiftCard(giftCard) && (
          <a className="adv-btn-gold" href={giftCard.publicUrl!} target="_blank" rel="noopener noreferrer">
            <Send aria-hidden /> Regálala
          </a>
        )}
      </div>
      {from && <div className="note">{from}</div>}
      {later && <div className="note">{later}</div>}
      {giftCard.locked && <div className="note">{giftCard.lockedHint}</div>}
      <button type="button" className="adv-terms-btn" onClick={onOpenTerms}>
        Términos y condiciones
      </button>
    </div>
  );
};
