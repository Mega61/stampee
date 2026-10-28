import { describe, expect, it } from 'vitest';
import { isoWeekKey, monthStart, nextWeekStart } from '../src/lib/period.js';

// Bogota is UTC-5: local 00:00 == 05:00Z.
describe('period: ISO week in America/Bogota', () => {
  it('Sunday 23:59 and Monday 00:00 Bogota fall in different weeks', () => {
    const sundayLate = new Date('2026-11-02T04:59:59Z'); // Sun 1 Nov 23:59:59 Bogota
    const mondayStart = new Date('2026-11-02T05:00:00Z'); // Mon 2 Nov 00:00 Bogota
    expect(isoWeekKey(sundayLate)).toBe('2026-W44');
    expect(isoWeekKey(mondayStart)).toBe('2026-W45');
  });

  it('uses Bogota time, not UTC (Monday in UTC is still Sunday in Bogota)', () => {
    expect(isoWeekKey(new Date('2026-11-02T02:00:00Z'))).toBe('2026-W44');
    expect(isoWeekKey(new Date('2026-11-02T02:00:00Z'), 'UTC')).toBe('2026-W45');
  });

  it('handles the ISO year boundary', () => {
    // 2026 starts on a Thursday, so it has 53 ISO weeks.
    expect(isoWeekKey(new Date('2026-12-31T17:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(new Date('2027-01-01T17:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(new Date('2027-01-03T17:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(new Date('2027-01-04T05:00:00Z'))).toBe('2027-W01');
    // Week 1 can start in the previous calendar year.
    expect(isoWeekKey(new Date('2025-12-29T17:00:00Z'))).toBe('2026-W01');
    // Bogota's 31 Dec evening is already 1 Jan in UTC.
    expect(isoWeekKey(new Date('2025-01-01T03:00:00Z'))).toBe('2025-W01');
    expect(isoWeekKey(new Date('2024-12-29T03:00:00Z'))).toBe('2024-W52');
  });

  it('pads single-digit weeks', () => {
    expect(isoWeekKey(new Date('2026-03-04T17:00:00Z'))).toBe('2026-W10');
    expect(isoWeekKey(new Date('2026-01-14T17:00:00Z'))).toBe('2026-W03');
  });
});

describe('period: nextWeekStart', () => {
  it('is the next Monday 00:00 Bogota', () => {
    expect(nextWeekStart(new Date('2026-10-28T15:00:00Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(nextWeekStart(new Date('2026-11-02T04:59:59Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('at Monday 00:00 exactly, points to the following Monday', () => {
    expect(nextWeekStart(new Date('2026-11-02T05:00:00Z')).toISOString()).toBe('2026-11-09T05:00:00.000Z');
  });

  it('crosses the year boundary', () => {
    expect(nextWeekStart(new Date('2026-12-31T17:00:00Z')).toISOString()).toBe('2027-01-04T05:00:00.000Z');
  });
});

describe('period: monthStart', () => {
  it('is the 1st at 00:00 Bogota', () => {
    expect(monthStart(new Date('2026-10-28T15:00:00Z')).toISOString()).toBe('2026-10-01T05:00:00.000Z');
    // 31 Oct 22:00 Bogota is 1 Nov in UTC but still October locally.
    expect(monthStart(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(monthStart(new Date('2026-11-01T05:00:00Z')).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });
});
