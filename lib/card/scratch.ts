// Pure helpers for the scratch experiences (weekly ticket §8.1a, reward
// reveal §6.4): cleared-area sampling, countdown copy, flight paths and
// shard layout. No DOM, unit-tested.

/**
 * Share (0..1) of sampled pixels whose alpha is at least `threshold`.
 * `data` is RGBA (ImageData.data) of the *scratch mask*, where painted =
 * cleared. `step` samples every n-th pixel (1 = all).
 */
export const clearedFraction = (data: ArrayLike<number>, threshold = 128, step = 1): number => {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return 0;
  const stride = Math.max(1, Math.floor(step));
  let seen = 0;
  let cleared = 0;
  for (let p = 0; p < pixels; p += stride) {
    seen++;
    if (data[p * 4 + 3]! >= threshold) cleared++;
  }
  return cleared / seen;
};

/**
 * Downscaled sampling size for a canvas: keeps the aspect ratio with the
 * long side at `maxSide` px (never upscales, never below 1).
 */
export const sampleSize = (width: number, height: number, maxSide = 48) => {
  const long = Math.max(width, height, 1);
  const k = Math.min(1, maxSide / long);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
};

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  /** Total ms left, never negative. */
  ms: number;
}

/** Splits the time until `targetMs` into days / hours / minutes (minutes rounded up). */
export const countdownParts = (targetMs: number, nowMs: number): CountdownParts => {
  const ms = Math.max(0, targetMs - nowMs);
  // Round up to the minute so "0 min" only shows once the time has come.
  const totalMinutes = Math.ceil(ms / 60_000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
    ms,
  };
};

/** "3 d 4 h", "5 h 12 min", "12 min", "ahora" — the chip's short copy. */
export const formatCountdown = (targetMs: number, nowMs: number): string => {
  const { days, hours, minutes, ms } = countdownParts(targetMs, nowMs);
  if (ms <= 0) return 'ahora';
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
};

/** Screen-reader copy: "3 días y 4 horas". */
export const countdownAria = (targetMs: number, nowMs: number): string => {
  const { days, hours, minutes, ms } = countdownParts(targetMs, nowMs);
  if (ms <= 0) return 'ya disponible';
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (days > 0) parts.push(plural(days, 'día', 'días'));
  if (hours > 0) parts.push(plural(hours, 'hora', 'horas'));
  if (days === 0 && minutes > 0) parts.push(plural(minutes, 'minuto', 'minutos'));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0]!;
};

/** Two-digit split-flap cells: [d, d] for days only when > 9, always hh and mm. */
export const flapDigits = (n: number, width = 2) => String(Math.max(0, Math.floor(n))).padStart(width, '0').split('');

/**
 * ISO week number of the play period that ends at `nextPlayAt` (Monday 00:00
 * Bogota). Uses the Sunday before it, as a Bogota calendar day.
 */
export const periodWeekNumber = (nextPlayAt: string | number): number => {
  const end = typeof nextPlayAt === 'number' ? nextPlayAt : Date.parse(nextPlayAt);
  // Bogota is UTC-5 with no DST; noon on the last day of the period.
  const local = new Date(end - 5 * 3_600_000 - 12 * 3_600_000);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // 0 = Monday
  const thursday = new Date(day + (3 - weekday) * 86_400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / 86_400_000 / 7) + 1;
};

export interface Point {
  x: number;
  y: number;
}

/** Quadratic Bézier point. */
export const quadPoint = (p0: Point, c: Point, p1: Point, t: number): Point => {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
};

/**
 * Control point for a curved flight from `from` to `to`: the chord's midpoint
 * pushed sideways by `arc` × chord length, always bowing towards the screen's
 * horizontal center so the path never leaves it.
 */
export const arcControl = (from: Point, to: Point, arc: number, centerX?: number): Point => {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal to the chord.
  let nx = -dy / len;
  let ny = dx / len;
  if (centerX !== undefined) {
    const towardCenter = centerX - mx;
    if (Math.abs(towardCenter) > 1 && Math.sign(nx) !== Math.sign(towardCenter)) {
      nx = -nx;
      ny = -ny;
    }
  } else if (ny > 0) {
    // Default: bow upwards.
    nx = -nx;
    ny = -ny;
  }
  return { x: mx + nx * len * arc, y: my + ny * len * arc };
};

/** Points every `spacing` px along a segment, excluding `from` (brush stamps). */
export const pointsAlong = (from: Point, to: Point, spacing: number): Point[] => {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const n = Math.max(1, Math.ceil(dist / Math.max(0.5, spacing)));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return out;
};

/** Deterministic PRNG (mulberry32), 0..1. */
export const seededRandom = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Triangle = [Point, Point, Point];

/**
 * Splits a w×h rectangle into jittered triangles (2 per cell) for the foil
 * shatter. Inner grid vertices are jittered by up to `jitter` × cell size;
 * border vertices stay on the border so the shards tile the whole foil.
 */
export const shardTriangles = (w: number, h: number, cols: number, rows: number, seed = 1, jitter = 0.32): Triangle[] => {
  const rand = seededRandom(seed);
  const cw = w / cols;
  const ch = h / rows;
  const grid: Point[][] = [];
  for (let r = 0; r <= rows; r++) {
    const row: Point[] = [];
    for (let c = 0; c <= cols; c++) {
      const inner = r > 0 && r < rows && c > 0 && c < cols;
      row.push({
        x: c * cw + (inner ? (rand() - 0.5) * 2 * jitter * cw : 0),
        y: r * ch + (inner ? (rand() - 0.5) * 2 * jitter * ch : 0),
      });
    }
    grid.push(row);
  }
  const tris: Triangle[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = grid[r]![c]!;
      const b = grid[r]![c + 1]!;
      const d = grid[r + 1]![c]!;
      const e = grid[r + 1]![c + 1]!;
      // Alternate the diagonal so the pattern doesn't look like a grid.
      if ((r + c) % 2 === 0) tris.push([a, b, e], [a, e, d]);
      else tris.push([a, b, d], [b, e, d]);
    }
  }
  return tris;
};

export const triangleCentroid = ([a, b, c]: Triangle): Point => ({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 });

/** Signed-area based area of a triangle (always ≥ 0). */
export const triangleArea = ([a, b, c]: Triangle) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Ease-in-out cubic. */
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Ease-out back (overshoots ~10 % with s = 1.70158). */
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

/** Short, human ticket serial from the card id and period: "A3F9-44". */
export const ticketSerial = (uniqueId: string, week: number) =>
  `${uniqueId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}-${String(week).padStart(2, '0')}`;
