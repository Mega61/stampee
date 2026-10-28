import { describe, expect, it } from 'vitest';
import { appleWalletPassUrl, canOfferAppleWallet, canOfferGoogleWallet, isAppleMobile } from './walletApi';

const UA = {
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iPadOld:
    'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ asks for desktop sites: a Mac UA, but with touch.
  iPadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('wallet device detection', () => {
  it('treats iPhone, iPad and touch Macs (iPadOS) as Apple mobile', () => {
    expect(isAppleMobile(UA.iPhone)).toBe(true);
    expect(isAppleMobile(UA.iPhoneChrome)).toBe(true);
    expect(isAppleMobile(UA.iPadOld)).toBe(true);
    expect(isAppleMobile(UA.iPadDesktop, 5)).toBe(true);
  });

  it('treats a real Mac (no touch), Android and Windows as not Apple mobile', () => {
    expect(isAppleMobile(UA.iPadDesktop, 0)).toBe(false);
    expect(isAppleMobile(UA.iPadDesktop)).toBe(false);
    expect(isAppleMobile(UA.android, 5)).toBe(false);
    expect(isAppleMobile(UA.windows, 10)).toBe(false);
  });

  it('offers exactly one wallet per device', () => {
    for (const [ua, touch] of [
      [UA.iPhone, 5],
      [UA.iPadDesktop, 5],
      [UA.iPadDesktop, 0],
      [UA.android, 5],
      [UA.windows, 0],
    ] as const) {
      expect(canOfferAppleWallet(ua, touch)).toBe(!canOfferGoogleWallet(ua, touch));
    }
    expect(canOfferAppleWallet(UA.iPhone, 5)).toBe(true);
    expect(canOfferGoogleWallet(UA.android, 5)).toBe(true);
  });
});

describe('appleWalletPassUrl', () => {
  it('points at the pass download and encodes path parts', () => {
    expect(appleWalletPassUrl('golden-beauty', 'abc-123')).toMatch(/\/public\/cards\/golden-beauty\/abc-123\/wallet\/apple$/);
    expect(appleWalletPassUrl('a b', 'x/y')).toMatch(/\/public\/cards\/a%20b\/x%2Fy\/wallet\/apple$/);
  });
});
