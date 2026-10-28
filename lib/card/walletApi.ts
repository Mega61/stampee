// Google Wallet client calls (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
// The config answer is cached for the tab session: it only changes when the
// API is redeployed with (or without) wallet credentials.
import { api } from '../api';

export interface WalletConfig {
  google: boolean;
}

const CONFIG_KEY = 'stampee:wallet-config';
const OFF: WalletConfig = { google: false };
let inflight: Promise<WalletConfig> | null = null;

const readCached = (): WalletConfig | null => {
  try {
    const raw = sessionStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WalletConfig>;
    return { google: parsed.google === true };
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
      const config = { google: data?.google === true };
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
 * Google Wallet is useless on iPhone/iPad (Apple Wallet only), so the button
 * is hidden there. Android and desktop browsers get it.
 */
export const canOfferGoogleWallet = (ua: string, maxTouchPoints = 0): boolean => {
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  return !iOS;
};
