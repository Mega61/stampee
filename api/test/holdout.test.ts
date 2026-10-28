import { describe, expect, it } from 'vitest';
import { cardBucket, fnv1a } from '../src/lib/holdout.js';

// Same vectors as the SPA's lib/card/holdout.test.ts.
describe('holdout hash', () => {
  it('matches FNV-1a reference vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
  it('is case-insensitive', () => {
    const id = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';
    expect(cardBucket(id)).toBe(cardBucket(id.toLowerCase()));
  });
});
