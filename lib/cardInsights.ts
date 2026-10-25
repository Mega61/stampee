import type { Customer, IssuedCard, Template } from '../types';
import { resolveCardTemplate } from './templateSerialization';
import { getBonusStamps } from './utils';

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a card sits in its lifecycle. "almost" = within ALMOST_THERE_STAMPS of
 * the reward — the customers most worth nudging.
 */
export type CardStage = 'redeemed' | 'ready' | 'almost' | 'in_progress' | 'not_started';

export const ALMOST_THERE_STAMPS = 2;

export const STAGE_LABELS: Record<CardStage, string> = {
  ready: 'Ready to redeem',
  almost: 'Almost there',
  in_progress: 'In progress',
  not_started: 'No visits yet',
  redeemed: 'Redeemed',
};

export interface CardInsight {
  customer: Customer;
  card: IssuedCard;
  template: Template;
  totalStamps: number;
  bonusStamps: number;
  /** Stamps earned through visits (excludes the gift). */
  earnedStamps: number;
  remaining: number;
  /** 0..1, what the customer sees on the card (gift included). */
  progress: number;
  stage: CardStage;
  issuedAt: number | null;
  /** Last stamp_add, i.e. the last real visit. */
  lastStampAt: number | null;
  /** Last activity of any kind (stamp, removal, redeem, issue). */
  lastActivityAt: number | null;
  redeemedAt: number | null;
  daysSinceActivity: number | null;
  isArchivedCampaign: boolean;
}

const parseDateOnly = (value?: string) => {
  if (!value) return null;
  const [y, m, d] = value.split('T')[0]!.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
};

export const buildCardInsight = (
  customer: Customer,
  card: IssuedCard,
  campaigns: Template[],
  now = Date.now(),
): CardInsight | null => {
  const template = resolveCardTemplate(card, campaigns);
  if (!template) return null;

  const totalStamps = Math.max(template.totalStamps, 1);
  const bonusStamps = getBonusStamps(template);
  let issuedAt: number | null = null;
  let lastStampAt: number | null = null;
  let lastActivityAt: number | null = null;
  let redeemedAt: number | null = null;

  for (const tx of card.history ?? []) {
    const ts = tx.timestamp;
    if (typeof ts !== 'number') continue;
    if (lastActivityAt === null || ts > lastActivityAt) lastActivityAt = ts;
    if (tx.type === 'issued' && (issuedAt === null || ts < issuedAt)) issuedAt = ts;
    if (tx.type === 'stamp_add' && (lastStampAt === null || ts > lastStampAt)) lastStampAt = ts;
    if (tx.type === 'redeem' && (redeemedAt === null || ts > redeemedAt)) redeemedAt = ts;
  }

  // Cards without history (very old imports) fall back to the stored dates.
  lastActivityAt ??= parseDateOnly(card.lastVisit);
  redeemedAt ??= card.status === 'Redeemed' ? parseDateOnly(card.completedDate) : null;

  const remaining = Math.max(totalStamps - card.stamps, 0);
  const earnedStamps = Math.max(card.stamps - bonusStamps, 0);

  let stage: CardStage;
  if (card.status === 'Redeemed') stage = 'redeemed';
  else if (remaining === 0) stage = 'ready';
  else if (remaining <= ALMOST_THERE_STAMPS) stage = 'almost';
  else if (lastStampAt === null) stage = 'not_started';
  else stage = 'in_progress';

  return {
    customer,
    card,
    template,
    totalStamps,
    bonusStamps,
    earnedStamps,
    remaining,
    progress: Math.min(card.stamps / totalStamps, 1),
    stage,
    issuedAt,
    lastStampAt,
    lastActivityAt,
    redeemedAt,
    daysSinceActivity: lastActivityAt === null ? null : Math.floor((now - lastActivityAt) / DAY_MS),
    isArchivedCampaign: card.campaignId === null,
  };
};

export const buildCardInsights = (customers: Customer[], campaigns: Template[], now = Date.now()) =>
  customers.flatMap((customer) =>
    customer.cards
      .map((card) => buildCardInsight(customer, card, campaigns, now))
      .filter((row): row is CardInsight => row !== null),
  );

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const formatRelativeDays = (timestamp: number | null, now = Date.now()) => {
  if (timestamp === null) return '—';
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThatDay = new Date(timestamp);
  startOfThatDay.setHours(0, 0, 0, 0);
  const days = Math.round((startOfThatDay.getTime() - startOfToday.getTime()) / DAY_MS);
  if (days === 0) return 'Today';
  if (Math.abs(days) < 30) return relativeFormatter.format(days, 'day');
  if (Math.abs(days) < 365) return relativeFormatter.format(Math.round(days / 30), 'month');
  return relativeFormatter.format(Math.round(days / 365), 'year');
};

export const formatShortDate = (timestamp: number | null) =>
  timestamp === null
    ? '—'
    : new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Best-effort WhatsApp link. Colombian mobiles are stored as 10 digits starting
 * with 3, so those get the +57 prefix; anything else is used as-is.
 */
export const buildWhatsAppUrl = (mobile?: string, text?: string) => {
  const digits = (mobile ?? '').replace(/\D+/g, '');
  if (digits.length < 7) return null;
  const international = digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits;
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${international}${query}`;
};

export const downloadCsv = (filename: string, rows: (string | number)[][]) => {
  const escape = (value: string | number) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = rows.map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
