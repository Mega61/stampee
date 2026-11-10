import { describe, expect, it } from 'vitest';
import { getStampGridLayout, stampGridStyles } from './stampLayout';

const rows = (n: number) => {
  const { columns } = getStampGridLayout(n);
  const out: number[] = [];
  for (let left = n; left > 0; left -= columns) out.push(Math.min(columns, left));
  return out;
};

describe('getStampGridLayout', () => {
  it('never leaves an orphan stamp in the common sizes', () => {
    expect(rows(8)).toEqual([4, 4]);
    expect(rows(9)).toEqual([3, 3, 3]);
    expect(rows(10)).toEqual([4, 4, 2]);
    expect(rows(7)).toEqual([4, 3]);
    expect(rows(6)).toEqual([3, 3]);
    expect(rows(5)).toEqual([3, 2]);
    expect(rows(12)).toEqual([4, 4, 4]);
    expect(rows(13)).toEqual([5, 5, 3]);
    // 21 is the one size where 4 and 5 both leave a single stamp (3 columns
    // would be 7 rows); it stays centered.
    for (let n = 2; n <= 30; n++) if (n !== 21) expect(rows(n).at(-1)).toBeGreaterThan(1);
  });

  it('keeps ≤12 stamps to at most 4 columns (wider overflows a phone)', () => {
    for (let n = 1; n <= 12; n++) expect(getStampGridLayout(n).columns).toBeLessThanOrEqual(4);
  });

  it('small cards are one row', () => {
    expect(getStampGridLayout(3)).toEqual({ columns: 3, lastRowStart: null });
  });

  it('centers the short last row', () => {
    // 10 → 4 columns (8 tracks); the last row has 2, so it starts at track 3.
    expect(getStampGridLayout(10)).toEqual({ columns: 4, lastRowStart: 3 });
    const s = stampGridStyles(10);
    expect(s.container.gridTemplateColumns).toBe('repeat(8, minmax(0, 1fr))');
    expect(s.slot(8)).toEqual({ gridColumn: '3 / span 2' });
    expect(s.slot(9)).toEqual({ gridColumn: 'span 2' });
    expect(stampGridStyles(8).slot(4)).toEqual({ gridColumn: 'span 2' });
  });
});
