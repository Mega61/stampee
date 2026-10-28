// Google / Apple Wallet client calls (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
// The config answer is cached for the tab session: it only changes when the
// API is redeployed with (or without) wallet credentials.
import { API_BASE, api } from '../api';

export interface WalletConfig {
  google: boolean;
  apple: boolean;
}

const CONFIG_KEY = 'stampee:wallet-config';
const OFF: WalletConfig = { google: false, apple: false };
let inflight: Promise<WalletConfig> | null = null;

const readCached = (): WalletConfig | null => {
  try {
    const raw = sessionStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WalletConfig>;
    return { google: parsed.google === true, apple: parsed.apple === true };
  } catch {
    return null;
  }
};

/** Which wallets the API can issue to. Never rejects (errors → all off). */
export const fetchWalletConfig = (): Promise<WalletConfig> => {
  const cached = readCached();
  if (cached) return Promise.resolve(cached);
  inflight ??= api
    .get<Partial<WalletConfig>>('/public/wallet/config')
    .then((data) => {
      const config = { google: data?.google === true, apple: data?.apple === true };
      try {
        sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      } catch {
        // private mode / storage blocked: the in-memory promise still dedupes
      }
      return config;
    })
    // A failed lookup isn't cached in storage: try again on the next page load.
    .catch(() => OFF);
  return inflight;
};

/** Signed "Save to Google Wallet" link for this card. */
export const fetchGoogleSaveUrl = async (slug: string, uniqueId: string): Promise<string> => {
  const data = await api.get<{ saveUrl: string }>(
    `/public/cards/${encodeURIComponent(slug)}/${encodeURIComponent(uniqueId)}/wallet/google`,
  );
  if (!data?.saveUrl?.startsWith('https://pay.google.com/')) throw new Error('Invalid save URL');
  return data.saveUrl;
};

/**
 * The signed `.pkpass` download. Navigating to it (not fetch) is what makes
 * Safari show the "Add to Apple Wallet" sheet.
 */
export const appleWalletPassUrl = (slug: string, uniqueId: string): string =>
  `${API_BASE}/public/cards/${encodeURIComponent(slug)}/${encodeURIComponent(uniqueId)}/wallet/apple`;

/** iPhone / iPod / iPad, including iPadOS's desktop-class "Macintosh" UA. */
export const isAppleMobile = (ua: string, maxTouchPoints = 0): boolean =>
  /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

/**
 * Google Wallet is useless on iPhone/iPad (Apple Wallet only), so the button
 * is hidden there. Android and desktop browsers get it.
 */
export const canOfferGoogleWallet = (ua: string, maxTouchPoints = 0): boolean => !isAppleMobile(ua, maxTouchPoints);

/** Apple Wallet: iPhone/iPad only (the exact complement of Google). */
export const canOfferAppleWallet = (ua: string, maxTouchPoints = 0): boolean => isAppleMobile(ua, maxTouchPoints);
