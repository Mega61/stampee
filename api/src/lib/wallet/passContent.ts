// What both wallet passes show beyond the stamp count: the client's level,
// the "Te faltan…" line, the business's contact links, and the copy of every
// notification. Pure helpers shared by google.ts and apple.ts.
import type { ClientLevel, WalletNotificationKind } from '../../db/types.js';

// ---------------------------------------------------------------------------
// Client level
// ---------------------------------------------------------------------------

/** Visits = stamp_add transactions on all of the client's cards with this business. */
export const LEVELS: ReadonlyArray<{ level: ClientLevel; label: string; minVisits: number }> = [
  { level: 'bronce', label: 'Bronce', minVisits: 0 },
  { level: 'plata', label: 'Plata', minVisits: 5 },
  { level: 'oro', label: 'Oro', minVisits: 15 },
];

export const levelFor = (visits: number): ClientLevel => {
  let out: ClientLevel = 'bronce';
  for (const l of LEVELS) if (visits >= l.minVisits) out = l.level;
  return out;
};

export const levelLabel = (level: ClientLevel) => LEVELS.find((l) => l.level === level)!.label;
export const levelRank = (level: ClientLevel) => LEVELS.findIndex((l) => l.level === level);

// ---------------------------------------------------------------------------
// Business contact (campaign `social`)
// ---------------------------------------------------------------------------

export interface BusinessContact {
  /** WhatsApp number as entered, e.g. "+57 301 464 8943". */
  whatsapp: string | null;
  phone: string | null;
  mapsUrl: string | null;
  hours: string | null;
  instagram: string | null;
}

const text = (value: unknown, max = 500) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export const contactFrom = (social: unknown): BusinessContact => {
  const s = social && typeof social === 'object' ? (social as Record<string, unknown>) : {};
  const maps = text(s['mapsUrl'], 2000);
  return {
    whatsapp: text(s['whatsapp'], 40),
    phone: text(s['phone'], 40),
    // Only real web links end up as pass links.
    mapsUrl: maps && /^https:\/\//i.test(maps) ? maps : null,
    hours: text(s['hours'], 200),
    instagram: text(s['instagram'], 200),
  };
};

/**
 * International digits for a phone number. Colombian mobiles are stored as
 * 10 digits starting with 3, so those get 57 (same rule as buildWhatsAppUrl in
 * the SPA's lib/whatsapp.ts). Null when it can't be a phone number.
 */
export const internationalDigits = (phone: string | null | undefined): string | null => {
  const digits = (phone ?? '').replace(/\D+/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits;
};

export const BOOKING_TEXT = 'Hola. Quiero agendar!';

/** api.whatsapp.com (not wa.me: its redirect mangles emoji). */
export const whatsAppBookingUrl = (phone: string | null | undefined): string | null => {
  const digits = internationalDigits(phone);
  return digits ? `https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(BOOKING_TEXT)}` : null;
};

export const telUri = (phone: string | null | undefined): string | null => {
  const digits = internationalDigits(phone);
  return digits ? `tel:+${digits}` : null;
};

export const instagramUrl = (value: string | null | undefined): string | null => {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^https:\/\//i.test(v)) return v;
  if (/^http:\/\//i.test(v)) return null;
  const handle = v.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  return handle ? `https://instagram.com/${handle}` : null;
};

/** A business link for the pass (Google linksModuleData / Apple back fields). */
export interface ContactLink {
  id: 'whatsapp' | 'maps' | 'call' | 'instagram';
  uri: string;
  description: string;
}

/** Only the links that are set, in display order. */
export const contactLinks = (contact: BusinessContact): ContactLink[] => {
  const phone = contact.phone ?? contact.whatsapp;
  const links: Array<ContactLink | null> = [
    (() => {
      const uri = whatsAppBookingUrl(contact.whatsapp);
      return uri ? { id: 'whatsapp', uri, description: 'Agendar por WhatsApp' } : null;
    })(),
    contact.mapsUrl ? { id: 'maps', uri: contact.mapsUrl, description: 'Cómo llegar' } : null,
    (() => {
      const uri = telUri(phone);
      return uri ? { id: 'call', uri, description: 'Llamar' } : null;
    })(),
    (() => {
      const uri = instagramUrl(contact.instagram);
      return uri ? { id: 'instagram', uri, description: 'Instagram' } : null;
    })(),
  ];
  return links.filter((l): l is ContactLink => l !== null);
};

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const rewardOr = (reward: string) => reward.trim() || 'premio';

/** "Te faltan 3 sellos para tu Manicure", or the ready line when complete. */
export const progressText = (stamps: number, total: number, reward: string): string => {
  const left = Math.max(0, total - Math.max(0, stamps));
  if (left === 0) return `¡Tu ${rewardOr(reward)} está listo! Muéstralo en el salón`;
  return left === 1 ? `Te falta 1 sello para tu ${rewardOr(reward)}` : `Te faltan ${left} sellos para tu ${rewardOr(reward)}`;
};

/** Last 6 characters of the card id, upper case: what staff read aloud. */
export const shortCode = (uniqueId: string) => uniqueId.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface WalletMessage {
  header: string;
  body: string;
}

export const rewardReadyMessage = (reward: string): WalletMessage => ({
  header: `🎉 ¡Tu ${rewardOr(reward)} está listo!`,
  body: 'Muéstralo en el salón para reclamarlo.',
});

export const giftMessage = (business: string, stamps: number): WalletMessage => ({
  header: `🎁 ${business.trim() || 'Tu salón'} te regaló ${stamps} ${stamps === 1 ? 'sello' : 'sellos'}`,
  body: 'Te esperamos pronto 💛',
});

export const levelUpMessage = (level: ClientLevel): WalletMessage => ({
  header: `⭐ ¡Subiste a nivel ${levelLabel(level)}!`,
  body: 'Gracias por visitarnos. ¡Sigue sumando sellos!',
});

export const weeklyGameMessage = (): WalletMessage => ({
  header: '🎟️ Tu raspa y gana de la semana está listo',
  body: 'Ábrelo en tu tarjeta',
});

/**
 * Highest first. At most one notification per sync: the top candidate rings
 * if the budget allows; everything else in that update applies silently.
 */
export const NOTIFY_PRIORITY: readonly WalletNotificationKind[] = [
  'reward_ready',
  'stamp',
  'gift',
  'level_up',
  'weekly_game',
];

/** Google: max 3 notifying updates + messages per pass per 24 h. Enforced on our side for both wallets. */
export const DAILY_NOTIFY_BUDGET = 3;

/**
 * Slots a kind must leave free for more important ones: low-priority
 * notifications never spend the last slot of the day, so a reward that
 * completes later that day can still ring.
 */
export const NOTIFY_RESERVE: Record<WalletNotificationKind, number> = {
  reward_ready: 0,
  stamp: 0,
  gift: 1,
  level_up: 1,
  weekly_game: 1,
};

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

/** Why a card changed, as reported to onCardChanged. */
export type CardChangeCause = 'stamp' | 'gift' | 'bonus' | 'other';

export interface CardChanges {
  causes: Set<CardChangeCause>;
  /** Stamps gifted in this batch (sum of 'gift' amounts). */
  giftedStamps: number;
}

export const noChanges = (): CardChanges => ({ causes: new Set(), giftedStamps: 0 });

export interface PassState {
  stamps: number;
  totalStamps: number;
  status: 'Active' | 'Redeemed';
  level: ClientLevel;
}

export type PlannedNotification =
  | { kind: 'reward_ready' }
  | { kind: 'stamp' }
  | { kind: 'gift'; stamps: number }
  | { kind: 'level_up'; level: ClientLevel };

/**
 * What deserves a notification, given what the pass showed before
 * (`prev`, null fields = unknown: pass synced before 0017) and the causes
 * collected since. Sorted by NOTIFY_PRIORITY.
 */
export const planNotifications = (
  prev: { stamps: number | null; level: ClientLevel | null },
  next: PassState,
  changes: CardChanges,
): PlannedNotification[] => {
  const out: PlannedNotification[] = [];
  const earned = changes.causes.has('stamp') || changes.causes.has('gift');
  const stampsUp = prev.stamps === null ? earned : next.stamps > prev.stamps;
  // A game win only: the client is looking at the card already.
  const onlyBonus = changes.causes.has('bonus') && !earned;

  if (stampsUp && !onlyBonus) {
    const wasComplete = prev.stamps !== null && prev.stamps >= next.totalStamps;
    if (next.status === 'Active' && next.stamps >= next.totalStamps && !wasComplete) out.push({ kind: 'reward_ready' });
    if (changes.causes.has('gift') && !changes.causes.has('stamp')) {
      const gifted = changes.giftedStamps || (prev.stamps === null ? 0 : next.stamps - prev.stamps);
      out.push({ kind: 'gift', stamps: Math.max(1, gifted) });
    } else {
      out.push({ kind: 'stamp' });
    }
  }
  if (prev.level !== null && levelRank(next.level) > levelRank(prev.level)) {
    out.push({ kind: 'level_up', level: next.level });
  }
  return out.sort((a, b) => NOTIFY_PRIORITY.indexOf(a.kind) - NOTIFY_PRIORITY.indexOf(b.kind));
};

export const messageFor = (
  n: PlannedNotification | { kind: 'weekly_game' },
  ctx: { rewardName: string; businessName: string },
): WalletMessage | null => {
  switch (n.kind) {
    case 'reward_ready':
      return rewardReadyMessage(ctx.rewardName);
    case 'gift':
      return giftMessage(ctx.businessName, n.stamps);
    case 'level_up':
      return levelUpMessage(n.level);
    case 'weekly_game':
      return weeklyGameMessage();
    case 'stamp':
      return null; // the balance update itself notifies
  }
};
