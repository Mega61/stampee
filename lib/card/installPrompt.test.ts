import { describe, expect, it } from 'vitest';
import {
  INSTALL_DISMISS_DAYS,
  detectInstallPlatform,
  isPublicCardPath,
  readInstallState,
  recordCardOpen,
  recordInstallDismissed,
  recordInstalled,
  shouldOfferInstall,
} from './installPrompt';

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

const NOW = Date.UTC(2026, 9, 28);
const base = { opens: 1, stampLanded: false, dismissedAt: null, installed: false, standalone: false, now: NOW };

describe('shouldOfferInstall', () => {
  it('waits for the second open', () => {
    expect(shouldOfferInstall(base)).toBe(false);
    expect(shouldOfferInstall({ ...base, opens: 2 })).toBe(true);
    expect(shouldOfferInstall({ ...base, opens: 7 })).toBe(true);
  });

  it('offers right after a stamp lands, even on the first open', () => {
    expect(shouldOfferInstall({ ...base, stampLanded: true })).toBe(true);
  });

  it('snoozes for 14 days after a dismiss', () => {
    const day = 86_400_000;
    expect(shouldOfferInstall({ ...base, opens: 3, dismissedAt: NOW - day })).toBe(false);
    expect(shouldOfferInstall({ ...base, opens: 3, dismissedAt: NOW - (INSTALL_DISMISS_DAYS * day - 1) })).toBe(false);
    expect(shouldOfferInstall({ ...base, opens: 3, dismissedAt: NOW - INSTALL_DISMISS_DAYS * day })).toBe(true);
    expect(shouldOfferInstall({ ...base, stampLanded: true, dismissedAt: NOW - day })).toBe(false);
  });

  it('never offers when already installed or running standalone', () => {
    expect(shouldOfferInstall({ ...base, opens: 5, standalone: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, opens: 5, installed: true })).toBe(false);
  });
});

describe('storage helpers', () => {
  it('counts one open per card per page load', () => {
    const store = memoryStore();
    store.setItem('stampee.card.card-a.opens', '1');
    expect(recordCardOpen('card-a', store)).toBe(2);
    // Remount in the same page load: no double count.
    expect(recordCardOpen('card-a', store)).toBe(2);
    expect(recordCardOpen('card-b', store)).toBe(1);
  });

  it('round-trips dismiss and per-card installed state', () => {
    const store = memoryStore();
    expect(readInstallState('/gbs/a', store)).toEqual({ dismissedAt: null, installed: false });
    recordInstallDismissed(NOW, store);
    recordInstalled('/gbs/a', store);
    expect(readInstallState('/gbs/a', store)).toEqual({ dismissedAt: NOW, installed: true });
    expect(readInstallState('/gbs/b', store).installed).toBe(false);
  });

  it('survives a throwing storage', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(recordCardOpen('card-z', broken)).toBe(1);
    expect(readInstallState('/x/y', broken)).toEqual({ dismissedAt: null, installed: false });
  });
});

describe('detectInstallPlatform', () => {
  const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  it('detects iOS Safari, including iPadOS desktop UA', () => {
    expect(detectInstallPlatform(iphoneSafari)).toBe('ios');
    expect(detectInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5)).toBe('ios');
  });
  it('skips iOS in-app and third-party browsers', () => {
    expect(detectInstallPlatform(iphoneSafari.replace('Safari/604.1', 'Instagram 300.0'))).toBe('none');
    expect(detectInstallPlatform(iphoneSafari.replace('Version/18.0', 'CriOS/130.0'))).toBe('none');
  });
  it('treats everything else as a beforeinstallprompt candidate', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('prompt');
  });
});

describe('isPublicCardPath', () => {
  it('matches /:slug/:uniqueId only', () => {
    expect(isPublicCardPath('/golden-beauty/2f6c0c1e-1111-4a4a-9999-000000000000')).toBe(true);
    expect(isPublicCardPath('/golden-beauty/2f6c/')).toBe(true);
    for (const path of ['/', '/dashboard', '/golden/staff', '/golden/scan/abc', '/golden/join/c1', '/dev/cards', '/editor/1', '/active/x', '/a/b/c']) {
      expect(isPublicCardPath(path)).toBe(false);
    }
  });
});
