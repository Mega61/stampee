import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../types';
import { buildStampTimeline, slotsForTransaction } from './stampTimeline';

const tx = (id: string, type: Transaction['type'], amount: number, timestamp: number): Transaction =>
  ({ id, type, amount, timestamp, date: '', title: '' });

describe('buildStampTimeline', () => {
  it('maps issue gift, visits, win-back and game stamps to slots in order', () => {
    const history = [
      tx('g', 'gift', 2, 40),
      tx('i', 'issued', 1, 10),
      tx('a', 'stamp_add', 1, 20),
      tx('b', 'bonus', 1, 50),
      tx('c', 'stamp_add', 1, 30),
    ];
    const timeline = buildStampTimeline(history, 6);
    expect(timeline.map((s) => s.txId)).toEqual(['i', 'a', 'c', 'g', 'g', 'b']);
    expect(slotsForTransaction(timeline, 'g')).toEqual([3, 4]);
  });

  it('pops the latest slot on removal and resets on redeem', () => {
    const history = [
      tx('a', 'stamp_add', 1, 1),
      tx('b', 'stamp_add', 1, 2),
      tx('r', 'stamp_remove', -1, 3),
      tx('c', 'stamp_add', 1, 4),
    ];
    expect(buildStampTimeline(history, 2).map((s) => s.txId)).toEqual(['a', 'c']);
    expect(buildStampTimeline([...history, tx('x', 'redeem', 0, 5)], 0)).toEqual([]);
  });

  it('trusts the card count when history disagrees', () => {
    expect(buildStampTimeline([tx('a', 'stamp_add', 1, 1)], 3).map((s) => s.txId)).toEqual(['a', null, null]);
    expect(buildStampTimeline([tx('a', 'stamp_add', 3, 1)], 1)).toHaveLength(1);
  });
});
