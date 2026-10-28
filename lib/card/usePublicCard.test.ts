import { describe, expect, it } from 'vitest';
import type { IssuedCard, Transaction } from '../../types';
import { BACKOFF_AFTER, POLL_MS, SLOW_POLL_MS, cardFingerprint, nextPollDelay, type PublicCardData } from './usePublicCard';

const tx = (id: string, timestamp: number): Transaction =>
  ({ id, type: 'stamp_add', amount: 1, timestamp, date: '', title: '' });

const data = (history: Transaction[], stamps: number, extra: Partial<PublicCardData> = {}): PublicCardData => ({
  card: { id: 'c', uniqueId: 'u', campaignId: null, campaignName: '', stamps, lastVisit: '', status: 'Active', history } as IssuedCard,
  customer: { id: 'x', name: 'Ana' },
  template: {} as PublicCardData['template'],
  game: null,
  ...extra,
});

describe('cardFingerprint', () => {
  it('changes on stamps, history, status and game; ignores template churn', () => {
    const a = data([tx('a', 1)], 1);
    expect(cardFingerprint(a)).toBe(cardFingerprint({ ...a, template: { name: 'signed-url-2' } as PublicCardData['template'] }));
    expect(cardFingerprint(a)).not.toBe(cardFingerprint(data([tx('a', 1), tx('b', 2)], 2)));
    expect(cardFingerprint(a)).not.toBe(cardFingerprint(data([tx('b', 1)], 1)));
    expect(cardFingerprint(a)).not.toBe(cardFingerprint({ ...a, card: { ...a.card, status: 'Redeemed' } }));
    expect(cardFingerprint(a)).not.toBe(cardFingerprint({ ...a, game: { state: 'played', nextPlayAt: 'x' } }));
  });
});

describe('nextPollDelay', () => {
  it('polls Active cards, backs off after unchanged polls, stops when redeemed', () => {
    expect(nextPollDelay('Active', 0)).toBe(POLL_MS);
    expect(nextPollDelay('Active', BACKOFF_AFTER - 1)).toBe(POLL_MS);
    expect(nextPollDelay('Active', BACKOFF_AFTER)).toBe(SLOW_POLL_MS);
    expect(nextPollDelay('Redeemed', 0)).toBeNull();
    expect(nextPollDelay(undefined, 0)).toBeNull();
  });
});
