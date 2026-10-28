// Pure helpers for the engagement beacon (plan §4.3). The hook lives in
// useEngagementBeacon.ts; everything here is DOM-free and unit-tested.
import type { CardVariant, CardViewEvent, CardViewSource } from '../../types';

export const MAX_DURATION_MS = 3_600_000;
export const MAX_INTERACTIONS = 10_000;

const SOURCES: CardViewSource[] = ['link', 'pwa', 'wallet', 'whatsapp'];

/** `?src=` wins (links we send carry it); else an installed app is 'pwa'; else 'link'. */
export const detectSource = (search: string, standalone: boolean): CardViewSource => {
  let src: string | null = null;
  try {
    src = new URLSearchParams(search).get('src');
  } catch {
    src = null;
  }
  const normalized = src?.trim().toLowerCase();
  if (normalized && (SOURCES as string[]).includes(normalized)) return normalized as CardViewSource;
  return standalone ? 'pwa' : 'link';
};

export const clampInt = (value: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : 0;

export const buildViewPayload = (input: {
  sessionId: string;
  source: CardViewSource;
  variant: CardVariant;
  durationMs: number;
  interactions: number;
  sawNewStamps: boolean;
}): CardViewEvent => ({
  sessionId: input.sessionId,
  source: input.source,
  variant: input.variant,
  durationMs: clampInt(input.durationMs, MAX_DURATION_MS),
  interactions: clampInt(input.interactions, MAX_INTERACTIONS),
  sawNewStamps: input.sawNewStamps,
});

export const viewsUrl = (apiBase: string, slug: string, uniqueId: string) =>
  `${apiBase.replace(/\/+$/, '')}/public/cards/${encodeURIComponent(slug)}/${encodeURIComponent(uniqueId)}/views`;

/** The playground and missing params never report. */
export const shouldTrack = (slug: string | undefined, uniqueId: string | undefined, pathname: string) =>
  !!slug && !!uniqueId && !pathname.startsWith('/dev/');

/** crypto.randomUUID when available; otherwise a 32-char random string (server accepts 8..64). */
export const createSessionId = (cryptoLike: { randomUUID?: () => string } | undefined = globalThis.crypto) => {
  try {
    if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  } catch {
    // insecure context (http on a LAN IP) throws
  }
  let out = '';
  while (out.length < 32) out += Math.random().toString(36).slice(2);
  return out.slice(0, 32);
};
