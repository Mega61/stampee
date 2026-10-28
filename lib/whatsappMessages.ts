// Prefilled WhatsApp messages staff send to a client after a counter action
// (docs/CARD_ENGAGEMENT_PLAN.md §7.1). Card links carry `?src=whatsapp` so the
// engagement beacon attributes the open to the ping.

export type CardViewLinkSource = 'whatsapp' | 'pwa' | 'wallet';

/** Adds `src=<source>` to a card URL, keeping any query it already has. */
export const withCardSource = (url: string, source: CardViewLinkSource) => {
  if (!url) return url;
  const [base, hash = ''] = url.split('#');
  const joined = `${base}${base!.includes('?') ? '&' : '?'}src=${source}`;
  return hash ? `${joined}#${hash}` : joined;
};

export type KioskNoticeKind = 'stamp' | 'complete' | 'redeem';

export interface KioskMessageParams {
  kind: KioskNoticeKind;
  businessName?: string | null;
  /** Stamps on the card after the action. */
  stamps: number;
  totalStamps: number;
  rewardName?: string | null;
  /** Public card URL (without `src`). */
  cardUrl?: string | null;
}

/** Stamp added → "stamp", or "complete" when that stamp filled the card. */
export const kioskNoticeKindForStamp = (stamps: number, totalStamps: number): KioskNoticeKind =>
  stamps >= totalStamps ? 'complete' : 'stamp';

export const buildKioskWhatsAppMessage = (params: KioskMessageParams) => {
  const business = params.businessName?.trim();
  const at = business ? ` en ${business}` : '';
  const reward = params.rewardName?.trim() || 'recompensa';
  const link = params.cardUrl ? withCardSource(params.cardUrl, 'whatsapp') : '';
  const seeCard = link ? ` Mira tu tarjeta: ${link}` : '';

  switch (params.kind) {
    case 'complete':
      return `¡Completaste tu tarjeta${at}! 🎉 Llevas ${params.stamps}/${params.totalStamps} y tu ${reward} ya te espera 💛${seeCard}`;
    case 'redeem':
      return `¡Tu ${reward} ya es tuyo! 🎁 Gracias por tu fidelidad${at} 💛 En tu próxima visita empezamos una tarjeta nueva.${link ? ` Tu tarjeta: ${link}` : ''}`;
    default:
      return `¡Sumaste un sello${at}! Llevas ${params.stamps}/${params.totalStamps} 💛${seeCard}`;
  }
};
