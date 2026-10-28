import { describe, expect, it } from 'vitest';
import {
  MAX_DURATION_MS,
  MAX_INTERACTIONS,
  buildViewPayload,
  clampInt,
  createSessionId,
  detectSource,
  shouldTrack,
  viewsUrl,
} from './beaconSource';

describe('detectSource', () => {
  it('prefers a known ?src= value', () => {
    expect(detectSource('?src=whatsapp', true)).toBe('whatsapp');
    expect(detectSource('?a=1&src=Wallet', false)).toBe('wallet');
    expect(detectSource('?src=pwa', false)).toBe('pwa');
    expect(detectSource('?src=link', true)).toBe('link');
  });

  it('falls back to standalone → pwa, else link', () => {
    expect(detectSource('?src=instagram', true)).toBe('pwa');
    expect(detectSource('', true)).toBe('pwa');
    expect(detectSource('', false)).toBe('link');
  });
});

describe('payload', () => {
  it('clamps and rounds numbers', () => {
    expect(clampInt(-5, 10)).toBe(0);
    expect(clampInt(12.6, 100)).toBe(13);
    expect(clampInt(Number.NaN, 10)).toBe(0);
    expect(clampInt(Infinity, 10)).toBe(0);
    const payload = buildViewPayload({
      sessionId: 's',
      source: 'link',
      variant: 'holdout',
      durationMs: MAX_DURATION_MS * 2,
      interactions: MAX_INTERACTIONS + 1,
      sawNewStamps: true,
    });
    expect(payload).toEqual({
      sessionId: 's',
      source: 'link',
      variant: 'holdout',
      durationMs: MAX_DURATION_MS,
      interactions: MAX_INTERACTIONS,
      sawNewStamps: true,
    });
  });

  it('builds the views url', () => {
    expect(viewsUrl('https://api.x.co/', 'golden', 'abc')).toBe('https://api.x.co/public/cards/golden/abc/views');
  });
});

describe('shouldTrack', () => {
  it('skips missing params and the playground', () => {
    expect(shouldTrack('s', 'u', '/s/u')).toBe(true);
    expect(shouldTrack(undefined, 'u', '/s/u')).toBe(false);
    expect(shouldTrack('s', '', '/s/u')).toBe(false);
    expect(shouldTrack('s', 'u', '/dev/cards')).toBe(false);
  });
});

describe('createSessionId', () => {
  it('uses randomUUID when present, else a random 32-char string', () => {
    expect(createSessionId({ randomUUID: () => 'uuid-1234' })).toBe('uuid-1234');
    const thrower = { randomUUID: () => { throw new Error('insecure'); } };
    const id = createSessionId(thrower);
    expect(id).toHaveLength(32);
    expect(createSessionId({})).not.toBe(createSessionId({}));
  });
});
