// "Add to home screen" cadence + platform plumbing (docs/CARD_ENGAGEMENT_PLAN.md
// §7.2). Pure helpers are unit-tested; the capture half is imported by
// index.tsx so `beforeinstallprompt` isn't missed before the lazy card chunk
// loads — keep this module tiny and dependency-free.

export const INSTALL_DISMISS_DAYS = 14;
const DAY_MS = 86_400_000;

const OPENS_KEY = (cardId: string) => `stampee.card.${cardId}.opens`;
const DISMISSED_KEY = 'stampee.install.dismissedAt';
// Installed is per card page: each card installs as its own app.
const INSTALLED_KEY = (path: string) => `stampee.install.installed:${path}`;

/** `/:slug/:uniqueId` — the public card route (see App.tsx). */
const RESERVED_FIRST = new Set(['active', 'preview', 'editor', 'dev', 'assets', 'api', 'login', 'forgot-password']);
const RESERVED_SECOND = new Set(['staff', 'scan', 'join']);
export const isPublicCardPath = (pathname: string) => {
  const parts = pathname.split('/').filter(Boolean);
  return parts.length === 2 && !RESERVED_FIRST.has(parts[0]!) && !RESERVED_SECOND.has(parts[1]!);
};

// ---------------------------------------------------------------------------
// Storage (never throws: private mode / blocked storage just disables cadence)
// ---------------------------------------------------------------------------

type KV = Pick<Storage, 'getItem' | 'setItem'>;

const safeStorage = (): KV | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const read = (store: KV | null, key: string) => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (store: KV | null, key: string, value: string) => {
  try {
    store?.setItem(key, value);
  } catch {
    // ignore
  }
};

// Opens are counted once per page load, even if the prompt remounts
// (StrictMode, live refresh swapping the view).
const countedThisLoad = new Set<string>();

/** Count this page load as an open of `cardId`; returns the total so far. */
export const recordCardOpen = (cardId: string, store: KV | null = safeStorage()) => {
  const current = Number(read(store, OPENS_KEY(cardId))) || 0;
  if (countedThisLoad.has(cardId)) return current;
  countedThisLoad.add(cardId);
  write(store, OPENS_KEY(cardId), String(current + 1));
  return current + 1;
};

export const recordInstallDismissed = (now = Date.now(), store: KV | null = safeStorage()) =>
  write(store, DISMISSED_KEY, String(now));

export const recordInstalled = (path: string, store: KV | null = safeStorage()) =>
  write(store, INSTALLED_KEY(path), '1');

export const readInstallState = (path: string, store: KV | null = safeStorage()) => ({
  dismissedAt: Number(read(store, DISMISSED_KEY)) || null,
  installed: read(store, INSTALLED_KEY(path)) === '1',
});

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

export interface InstallCadenceInput {
  /** Opens of this card on this device, including the current one. */
  opens: number;
  /** A stamp just landed in this session (high-intent moment). */
  stampLanded: boolean;
  dismissedAt: number | null;
  installed: boolean;
  standalone: boolean;
  now: number;
}

/** Offer on the 2nd open or right after a stamp lands; 14-day snooze. */
export const shouldOfferInstall = (input: InstallCadenceInput) => {
  if (input.standalone || input.installed) return false;
  if (input.dismissedAt !== null && input.now - input.dismissedAt < INSTALL_DISMISS_DAYS * DAY_MS) return false;
  return input.opens >= 2 || input.stampLanded;
};

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export type InstallPlatform = 'prompt' | 'ios' | 'none';

/**
 * 'prompt': the browser fires `beforeinstallprompt` (Chrome/Edge/Samsung on
 * Android) — we only know for sure once the event arrives.
 * 'ios': iOS Safari, which needs the manual Share → "Agregar a inicio" steps.
 */
export const detectInstallPlatform = (ua: string, maxTouchPoints = 0): InstallPlatform => {
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (iOS) {
    // In-app browsers (Instagram, Facebook…) and other iOS browsers hide the
    // Add to Home Screen action or put it elsewhere.
    const inApp = /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\/|GSA\//.test(ua);
    return !inApp && /Safari/.test(ua) ? 'ios' : 'none';
  }
  return 'prompt';
};

export const isStandaloneDisplay = () => {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
};

// ---------------------------------------------------------------------------
// beforeinstallprompt capture
// ---------------------------------------------------------------------------

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
let capturing = false;

/** Start listening (idempotent). Called from index.tsx on card routes. */
export const startInstallPromptCapture = () => {
  if (capturing || typeof window === 'undefined') return;
  capturing = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress Chrome's own mini-infobar; we show the pill at a better moment.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    recordInstalled(window.location.pathname);
    notify();
  });
};

export const getDeferredInstallPrompt = () => deferred;

/** The prompt can only be used once. */
export const consumeDeferredInstallPrompt = () => {
  const event = deferred;
  deferred = null;
  notify();
  return event;
};

export const subscribeInstallPrompt = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
