import { describe, expect, it } from 'vitest';
import type { IssuedCard, Transaction } from '../../types';
import {
  SEEN_TX_LIMIT,
  acknowledgeSeen,
  baselineSeen,
  diffCard,
  parseSeenState,
  syncRewardRevealed,
  type SeenState,
} from './diffCard';
import { loadSeen, saveSeen, seenKey, type SeenStorage } from './seenStorage';

const tx = (id: string, type: Transaction['type'], amount: number, timestamp: number): Transaction =>
  ({ id, type, amount, timestamp, date: '', title: '' });

const card = (history: Transaction[], stamps: number, status: IssuedCard['status'] = 'Active'): IssuedCard => ({
  id: 'c1',
  uniqueId: 'u1',
  campaignId: null,
  campaignName: '',
  stamps,
  lastVisit: '',
  status,
  history,
});

const memoryStorage = () => {
  const map = new Map<string, string>();
  const storage: SeenStorage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  return { storage, map };
};

describe('first visit', () => {
  it('treats existing history as seen (returning client on a new device)', () => {
    const c = card([tx('i', 'issued', 1, 1), tx('a', 'stamp_add', 1, 2), tx('b', 'stamp_add', 1, 3)], 3);
    const seen = baselineSeen(c);
    expect(diffCard(c, seen)).toEqual([]);
    expect(seen.stamps).toBe(3);
    expect(seen.txIds).toEqual(['b', 'a', 'i']);
  });

  it('gives a fresh card a single welcome event for the issue gift', () => {
    const c = card([tx('i', 'issued', 2, 1)], 2);
    const seen = baselineSeen(c);
    expect(seen.stamps).toBe(0);
    expect(diffCard(c, seen)).toEqual([{ id: 'i', kind: 'welcome', amount: 2, slots: [0, 1], timestamp: 1 }]);
  });

  it('no welcome when the issue had no stamps or the card already has visits', () => {
    expect(diffCard(card([tx('i', 'issued', 0, 1)], 0), baselineSeen(card([tx('i', 'issued', 0, 1)], 0)))).toEqual([]);
    const withGift = card([tx('i', 'issued', 1, 1), tx('g', 'gift', 1, 2)], 2);
    expect(diffCard(withGift, baselineSeen(withGift))).toEqual([]);
  });

  it('redeemed cards are closed', () => {
    const c = card([tx('i', 'issued', 2, 1), tx('r', 'redeem', 0, 2)], 0, 'Redeemed');
    expect(diffCard(c, baselineSeen(c))).toEqual([]);
  });
});

describe('returning visits', () => {
  const base = [tx('i', 'issued', 1, 1), tx('a', 'stamp_add', 1, 2)];
  const seen = baselineSeen(card(base, 2));

  it('one new stamp → stamp event on the next slot', () => {
    const c = card([...base, tx('b', 'stamp_add', 1, 3)], 3);
    expect(diffCard(c, seen)).toEqual([{ id: 'b', kind: 'stamp', amount: 1, slots: [2], timestamp: 3 }]);
  });

  it('a win-back gift of 2 → gift event with both slots', () => {
    const c = card([...base, tx('g', 'gift', 2, 3)], 4);
    expect(diffCard(c, seen)).toEqual([{ id: 'g', kind: 'gift', amount: 2, slots: [2, 3], timestamp: 3 }]);
  });

  it('a game bonus → bonus event', () => {
    const c = card([...base, tx('x', 'bonus', 1, 3)], 3);
    expect(diffCard(c, seen).map((e) => [e.kind, e.slots])).toEqual([['bonus', [2]]]);
  });

  it('several new things come oldest first', () => {
    const c = card([...base, tx('g', 'gift', 1, 5), tx('b', 'stamp_add', 1, 3)], 4);
    expect(diffCard(c, seen).map((e) => e.id)).toEqual(['b', 'g']);
  });

  it('skips a stamp that was removed again', () => {
    const c = card([...base, tx('b', 'stamp_add', 1, 3), tx('rm', 'stamp_remove', -1, 4)], 2);
    expect(diffCard(c, seen)).toEqual([]);
  });

  it('only counts slots still filled after a partial removal', () => {
    const c = card([...base, tx('g', 'gift', 2, 3), tx('rm', 'stamp_remove', -1, 4)], 3);
    expect(diffCard(c, seen)).toEqual([{ id: 'g', kind: 'gift', amount: 1, slots: [2], timestamp: 3 }]);
  });

  it('nothing after a redeem', () => {
    const c = card([...base, tx('b', 'stamp_add', 1, 3), tx('r', 'redeem', 0, 4)], 0, 'Redeemed');
    expect(diffCard(c, seen)).toEqual([]);
  });

  it('ignores history older than the remembered window', () => {
    const history = Array.from({ length: SEEN_TX_LIMIT + 5 }, (_, i) => tx(`t${i}`, 'stamp_add', 1, i));
    const c = card(history, 10);
    const s = baselineSeen(c);
    expect(s.txIds).toHaveLength(SEEN_TX_LIMIT);
    expect(diffCard(c, s)).toEqual([]);
  });
});

describe('live arrival + acknowledge', () => {
  it('a stamp landing while the page is open becomes an event against the baseline', () => {
    const before = card([tx('i', 'issued', 1, 1), tx('a', 'stamp_add', 1, 2)], 2);
    const seen = baselineSeen(before);
    expect(diffCard(before, seen)).toEqual([]);
    const after = card([...before.history, tx('b', 'stamp_add', 1, 3)], 3);
    expect(diffCard(after, seen).map((e) => e.id)).toEqual(['b']);
  });

  it('welcome still pending when a stamp lands live', () => {
    const fresh = card([tx('i', 'issued', 1, 1)], 1);
    const seen = baselineSeen(fresh);
    const after = card([...fresh.history, tx('b', 'stamp_add', 1, 2)], 2);
    expect(diffCard(after, seen).map((e) => [e.kind, e.slots])).toEqual([['welcome', [0]], ['stamp', [1]]]);
  });

  it('acknowledged events disappear and persist; unacknowledged ones replay', () => {
    const { storage, map } = memoryStorage();
    const base = card([tx('i', 'issued', 1, 1)], 1);
    let seen = baselineSeen(base);
    const c = card([...base.history, tx('a', 'stamp_add', 1, 2), tx('g', 'gift', 2, 3)], 4);
    expect(diffCard(c, seen).map((e) => e.id)).toEqual(['i', 'a', 'g']);

    seen = acknowledgeSeen(seen, c, ['i', 'a']);
    expect(diffCard(c, seen).map((e) => e.id)).toEqual(['g']);
    expect(seen.stamps).toBe(2);
    expect(seen.unwrapped).toEqual(['i']);
    saveSeen(storage, 'u1', seen);
    expect(map.has(seenKey('u1'))).toBe(true);

    // tab closed mid-gift → next visit replays the gift only
    const reloaded = loadSeen(storage, 'u1')!;
    expect(diffCard(c, reloaded).map((e) => e.id)).toEqual(['g']);

    const done = acknowledgeSeen(reloaded, c, ['g']);
    expect(diffCard(c, done)).toEqual([]);
    expect(done.stamps).toBe(4);
    expect(done.unwrapped).toEqual(['g', 'i']);
    expect(done.txIds).toEqual(['g', 'a', 'i']);
  });
});

describe('reward + storage', () => {
  const seen: SeenState = { v: 1, stamps: 5, txIds: [], revealedReward: true, unwrapped: [] };

  it('resets the reveal when a new cycle drops stamps below the total', () => {
    expect(syncRewardRevealed(seen, card([], 5), 5)).toBe(seen);
    expect(syncRewardRevealed(seen, card([], 1), 5).revealedReward).toBe(false);
  });

  it('survives broken or throwing storage', () => {
    const throwing: SeenStorage = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceeded'); },
    };
    expect(loadSeen(throwing, 'u1')).toBeNull();
    expect(() => saveSeen(throwing, 'u1', seen)).not.toThrow();
    expect(loadSeen(null, 'u1')).toBeNull();
    const { storage, map } = memoryStorage();
    map.set(seenKey('u1'), '{not json');
    expect(loadSeen(storage, 'u1')).toBeNull();
    map.set(seenKey('u1'), JSON.stringify({ v: 2, txIds: [] }));
    expect(loadSeen(storage, 'u1')).toBeNull();
  });

  it('parses and sanitizes stored state', () => {
    expect(parseSeenState({ v: 1, stamps: 2.7, txIds: ['a', 3], revealedReward: 'yes' })).toEqual({
      v: 1, stamps: 2, txIds: ['a'], revealedReward: false, unwrapped: [],
    });
  });
});
