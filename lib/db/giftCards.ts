import { api, ApiError } from '../api';

// Gift cards ("tarjetas regalo"). Shapes mirror api/src/lib/giftCards.ts
// (toGiftCardDto) and api/src/routes/{giftCards,publicGifts}.ts.

export type GiftCardStatus = 'pending_payment' | 'active' | 'redeemed' | 'void';
export type GiftCardEffectiveStatus = GiftCardStatus | 'expired';
export type GiftCardSource = 'sale' | 'advent' | 'manual';

export interface GiftCardRules {
  recipient?: 'any' | 'new_or_dormant';
  giverStampOnRedeem?: boolean;
  buyerStampOnPaid?: boolean;
  ref?: string;
}

export interface GiftCardTier {
  id: string;
  name: string;
  amountCop: number;
  description: string;
  validityDays: number;
  isEnabled: boolean;
  sort: number;
  design: Record<string, unknown> | null;
  createdAt: string;
}

export interface GiftCard {
  id: string;
  uniqueId: string;
  code: string;
  amountCop: number;
  status: GiftCardStatus;
  effectiveStatus: GiftCardEffectiveStatus;
  funded: boolean;
  source: GiftCardSource;
  tierId: string | null;
  tierName: string;
  buyerCustomerId: string | null;
  buyerName: string;
  buyerPhone: string;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientCustomerId: string | null;
  message: string;
  validFrom: string | null;
  validTo: string | null;
  minTicketCop: number | null;
  transferable: boolean;
  rules: GiftCardRules;
  paidAt: string | null;
  paidMethod: string | null;
  paidAmountCop: number | null;
  paidRef: string | null;
  redeemedAt: string | null;
  redeemedRef: string | null;
  redeemedAmountCop: number | null;
  voidedAt: string | null;
  voidReason: string | null;
  externalRef: string | null;
  publicUrl: string | null;
  createdAt: string;
}

export interface GiftCardEvent {
  id: number;
  type: 'created' | 'paid' | 'recipient_set' | 'redeemed' | 'unredeemed' | 'voided' | 'updated' | 'viewed';
  data: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
}

export type GiftCardDetail = GiftCard & { events: GiftCardEvent[] };

interface CountAmount {
  count: number;
  amountCop: number;
}

export interface GiftCardStats {
  sold: CountAmount;
  pending: CountAmount;
  active: CountAmount;
  redeemed: CountAmount;
  expired: CountAmount;
  outstandingLiabilityCop: number;
  byTier: Array<{ tierId: string | null; name: string } & CountAmount>;
  bySource: Array<{ source: GiftCardSource } & CountAmount>;
  last30d: Array<{ date: string } & CountAmount>;
  avgDaysToRedeem: number | null;
  viewsWithoutRecipient: number;
}

export interface PublicGift {
  code: string;
  amountCop: number;
  tierName: string;
  effectiveStatus: GiftCardEffectiveStatus;
  funded: boolean;
  source: GiftCardSource;
  buyerFirstName: string;
  recipientName: string | null;
  message: string;
  validFrom: string | null;
  validTo: string | null;
  minTicketCop: number | null;
  /** Holder-facing terms, built by the API (single source). */
  terms: string[];
  business: { name: string; logo: string | null; slug: string | null };
  design: Record<string, unknown> | null;
}

// ---- tiers

export const fetchGiftCardTiers = () => api.get<GiftCardTier[]>('/gift-card-tiers');

export const createGiftCardTier = (body: {
  name: string;
  amountCop: number;
  description?: string;
  validityDays?: number;
  isEnabled?: boolean;
  sort?: number;
}) => api.post<GiftCardTier>('/gift-card-tiers', body);

export const updateGiftCardTier = (id: string, body: Partial<Omit<GiftCardTier, 'id' | 'createdAt'>>) =>
  api.patch<GiftCardTier>(`/gift-card-tiers/${id}`, body);

// ---- cards

export const fetchGiftCards = (query: { status?: GiftCardEffectiveStatus | ''; q?: string; source?: GiftCardSource | ''; limit?: number }) =>
  api.get<GiftCard[]>('/gift-cards', {
    status: query.status || undefined,
    q: query.q?.trim() || undefined,
    source: query.source || undefined,
    limit: query.limit ?? 200,
  });

export const fetchGiftCardStats = () => api.get<GiftCardStats>('/gift-cards/stats');

export const fetchGiftCard = (id: string) => api.get<GiftCardDetail>(`/gift-cards/${id}`);

export const issueManualGiftCard = (body: {
  tierId?: string;
  amountCop?: number;
  buyer: { name: string; phone: string };
  recipientName?: string;
  message?: string;
  funded: boolean;
  minTicketCop?: number | null;
}) => api.post<GiftCard>('/gift-cards', { ...body, source: 'manual' });

export const updateGiftCard = (
  id: string,
  body: { recipientName?: string | null; recipientPhone?: string | null; message?: string; validTo?: string },
) => api.patch<GiftCard>(`/gift-cards/${id}`, body);

export const voidGiftCard = (id: string, reason: string) => api.post<GiftCard>(`/gift-cards/${id}/void`, { reason });

// ---- public

export async function fetchPublicGift(slug: string, uniqueId: string): Promise<PublicGift | null> {
  try {
    return await api.get<PublicGift>(`/public/gift/${encodeURIComponent(slug)}/${encodeURIComponent(uniqueId)}`);
  } catch {
    return null;
  }
}

export const setPublicGiftRecipient = (slug: string, uniqueId: string, name: string, phone?: string) =>
  api.post<PublicGift>(`/public/gift/${encodeURIComponent(slug)}/${encodeURIComponent(uniqueId)}/recipient`, {
    name,
    ...(phone ? { phone } : {}),
  });

// ---- formatting (shared by the public page and the admin)

const copFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const formatCop = (amount: number) => copFormatter.format(amount);

/** "2026-12-24" → "24 dic 2026" (date-only values, no time zone shift). */
export const formatGiftDate = (date: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('es-CO', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)));
};

export const GIFT_STATUS_LABEL: Record<GiftCardEffectiveStatus, string> = {
  pending_payment: 'Esperando pago',
  active: 'Lista para usar',
  redeemed: 'Disfrutada',
  expired: 'Vencida',
  void: 'Anulada',
};

export { ApiError };
