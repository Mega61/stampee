import { describe, expect, it } from 'vitest';
import {
  arcControl,
  clearedFraction,
  countdownAria,
  countdownParts,
  flapDigits,
  formatCountdown,
  periodWeekNumber,
  pointsAlong,
  quadPoint,
  sampleSize,
  seededRandom,
  shardTriangles,
  ticketSerial,
  triangleArea,
} from './scratch';

const rgba = (alphas: number[]) => {
  const out = new Uint8ClampedArray(alphas.length * 4);
  alphas.forEach((a, i) => (out[i * 4 + 3] = a));
  return out;
};

describe('clearedFraction', () => {
  it('counts pixels whose mask alpha reaches the threshold', () => {
    expect(clearedFraction(rgba([0, 0, 0, 0]))).toBe(0);
    expect(clearedFraction(rgba([255, 255, 255, 255]))).toBe(1);
    expect(clearedFraction(rgba([255, 0, 128, 127]))).toBe(0.5);
    expect(clearedFraction(rgba([255, 0, 128, 127]), 100)).toBe(0.75);
  });

  it('samples with a stride', () => {
    // Every 2nd pixel: 255, 255 → 1 (the zeros are skipped).
    expect(clearedFraction(rgba([255, 0, 255, 0]), 128, 2)).toBe(1);
  });

  it('handles empty input', () => {
    expect(clearedFraction(new Uint8ClampedArray(0))).toBe(0);
  });

  it('matches the 55 % auto-complete threshold on a half-cleared mask', () => {
    const alphas = Array.from({ length: 100 }, (_, i) => (i < 55 ? 255 : 0));
    expect(clearedFraction(rgba(alphas))).toBeGreaterThanOrEqual(0.55);
    alphas[54] = 0;
    expect(clearedFraction(rgba(alphas))).toBeLessThan(0.55);
  });
});

describe('sampleSize', () => {
  it('downscales the long side and keeps the aspect ratio', () => {
    expect(sampleSize(600, 300, 48)).toEqual({ width: 48, height: 24 });
    expect(sampleSize(300, 600, 48)).toEqual({ width: 24, height: 48 });
  });
  it('never upscales and never returns 0', () => {
    expect(sampleSize(20, 10, 48)).toEqual({ width: 20, height: 10 });
    expect(sampleSize(1000, 1, 48)).toEqual({ width: 48, height: 1 });
  });
});

describe('countdown', () => {
  const now = Date.UTC(2026, 9, 28, 12, 0, 0);
  const at = (d: number, h: number, m: number, s = 0) => now + ((d * 24 + h) * 60 + m) * 60_000 + s * 1000;

  it('splits into days / hours / minutes, rounding minutes up', () => {
    expect(countdownParts(at(3, 4, 0), now)).toMatchObject({ days: 3, hours: 4, minutes: 0 });
    expect(countdownParts(at(0, 0, 0, 1), now)).toMatchObject({ days: 0, hours: 0, minutes: 1 });
    expect(countdownParts(at(0, 23, 59, 30), now)).toMatchObject({ days: 1, hours: 0, minutes: 0 });
    expect(countdownParts(now - 5000, now)).toMatchObject({ days: 0, hours: 0, minutes: 0, ms: 0 });
  });

  it('formats the chip copy', () => {
    expect(formatCountdown(at(3, 4, 12), now)).toBe('3 d 4 h');
    expect(formatCountdown(at(0, 5, 12), now)).toBe('5 h 12 min');
    expect(formatCountdown(at(0, 0, 12), now)).toBe('12 min');
    expect(formatCountdown(now, now)).toBe('ahora');
  });

  it('formats screen-reader copy in Spanish', () => {
    expect(countdownAria(at(3, 4, 12), now)).toBe('3 días y 4 horas');
    expect(countdownAria(at(1, 1, 0), now)).toBe('1 día y 1 hora');
    expect(countdownAria(at(0, 2, 5), now)).toBe('2 horas y 5 minutos');
    expect(countdownAria(at(0, 0, 1), now)).toBe('1 minuto');
    expect(countdownAria(now, now)).toBe('ya disponible');
  });

  it('pads split-flap digits', () => {
    expect(flapDigits(4)).toEqual(['0', '4']);
    expect(flapDigits(12)).toEqual(['1', '2']);
    expect(flapDigits(3, 1)).toEqual(['3']);
    expect(flapDigits(-2)).toEqual(['0', '0']);
  });
});

describe('periodWeekNumber', () => {
  it('is the ISO week that ends at nextPlayAt (Monday 00:00 Bogota)', () => {
    // Mon 2 Nov 2026 00:00 Bogota → the period was 2026-W44.
    expect(periodWeekNumber('2026-11-02T05:00:00.000Z')).toBe(44);
    // Mon 4 Jan 2027 → the period was 2026-W53.
    expect(periodWeekNumber('2027-01-04T05:00:00.000Z')).toBe(53);
    // Mon 6 Jan 2025 → 2025-W01.
    expect(periodWeekNumber(Date.parse('2025-01-06T05:00:00.000Z'))).toBe(1);
  });
});

describe('flight path', () => {
  it('quadPoint hits both ends', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const c = { x: 50, y: -50 };
    expect(quadPoint(a, c, b, 0)).toEqual(a);
    expect(quadPoint(a, c, b, 1)).toEqual(b);
    expect(quadPoint(a, c, b, 0.5)).toEqual({ x: 50, y: -25 });
  });

  it('arcControl bows upwards by default and towards the center when given', () => {
    const from = { x: 200, y: 600 };
    const to = { x: 200, y: 200 };
    const up = arcControl({ x: 0, y: 100 }, { x: 100, y: 100 }, 0.3);
    expect(up.y).toBeLessThan(100);
    const right = arcControl(from, to, 0.25, 400);
    expect(right.x).toBeGreaterThan(200);
    const left = arcControl(from, to, 0.25, 0);
    expect(left.x).toBeLessThan(200);
    expect(Math.abs(right.x - 200)).toBeCloseTo(100);
  });

  it('pointsAlong spaces brush stamps evenly and ends at the target', () => {
    const pts = pointsAlong({ x: 0, y: 0 }, { x: 10, y: 0 }, 2.5);
    expect(pts).toHaveLength(4);
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 });
    expect(pointsAlong({ x: 0, y: 0 }, { x: 0, y: 0 }, 2)).toHaveLength(1);
  });
});

describe('shardTriangles', () => {
  it('tiles the whole rectangle', () => {
    const tris = shardTriangles(120, 90, 6, 4, 7);
    expect(tris).toHaveLength(6 * 4 * 2);
    const area = tris.reduce((s, t) => s + triangleArea(t), 0);
    expect(area).toBeCloseTo(120 * 90, 3);
  });

  it('is deterministic per seed', () => {
    expect(shardTriangles(50, 50, 3, 3, 3)).toEqual(shardTriangles(50, 50, 3, 3, 3));
    expect(shardTriangles(50, 50, 3, 3, 3)).not.toEqual(shardTriangles(50, 50, 3, 3, 4));
  });
});

describe('misc', () => {
  it('seededRandom stays in [0, 1)', () => {
    const r = seededRandom(42);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('ticketSerial', () => {
    expect(ticketSerial('00000000-0000-4000-8000-000000000dev', 44)).toBe('0DEV-44');
    expect(ticketSerial('ab-cd', 3)).toBe('ABCD-03');
  });
});
