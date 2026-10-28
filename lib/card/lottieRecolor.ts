// OWNER: agent B (theme engine). Recolors the completion gift Lottie
// (`Gift Box Orange.json`: red-orange box, gold ribbon with shaded faces, multicolor
// confetti) to the campaign theme. docs/CARD_ENGAGEMENT_PLAN.md §5.0.
//
// Rules, by the hue of each original color (near-neutrals are left alone):
//   red/orange (box)        → accent, a step deeper so it stands off the stamps
//   yellow/gold (ribbon)    → giftAccent
//   anything else (confetti)→ the particle palette, picked by original hue
// Each color keeps its lightness offset from its family's reference color, so
// light and shaded faces (and the box's inside) stay distinct after recoloring.
import { rgbToHex } from '../color';
import { chroma, hexToHsl, lightness, withLightness } from './colorMath';
import type { FxTheme } from './types';

type Rgba = number[]; // Lottie colors: [r, g, b, a?] in 0..1

/** Reference colors of the source asset's families (their L* is the anchor). */
const RED_REF = '#ff3902';
const GOLD_REF = '#ffc801';

const toHex = (c: Rgba) => rgbToHex(c[0]! * 255, c[1]! * 255, c[2]! * 255);
const toLottie = (hex: string, alpha: number | undefined): Rgba => {
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round((v / 255) * 1e4) / 1e4);
  return alpha === undefined ? rgb : [...rgb, alpha];
};

type Family = 'accent' | 'gift' | 'particle' | null;

const familyOf = (hex: string): Family => {
  const { h, l } = hexToHsl(hex);
  if (chroma(hex) < 0.18 || l > 0.94 || l < 0.08) return null; // white/grey/near-black
  if (h >= 330 || h < 30) return 'accent';
  if (h < 65) return 'gift';
  return 'particle';
};

/** Builds a memoized color mapper for one theme. */
const makeMapper = (theme: FxTheme) => {
  const cache = new Map<string, string | null>();
  const redRefL = lightness(RED_REF);
  const goldRefL = lightness(GOLD_REF);
  // The box plays over the (accent-colored) stamps: anchor it 20 L* deeper
  // (or lighter, for dark accents) so it never melts into the slots behind.
  const accentL = lightness(theme.accent);
  const boxL = accentL > 50 ? accentL - 20 : accentL + 20;
  const giftL = lightness(theme.giftAccent);
  const palette = theme.particles.length ? theme.particles : [theme.accent];
  return (hex: string): string | null => {
    const hit = cache.get(hex);
    if (hit !== undefined) return hit;
    let out: string | null = null;
    switch (familyOf(hex)) {
      case 'accent':
        out = withLightness(theme.accent, boxL + (lightness(hex) - redRefL));
        break;
      case 'gift':
        out = withLightness(theme.giftAccent, giftL + (lightness(hex) - goldRefL));
        break;
      case 'particle': {
        const { h } = hexToHsl(hex);
        out = palette[Math.floor((h / 360) * palette.length) % palette.length]!;
        break;
      }
      default:
        out = null;
    }
    cache.set(hex, out);
    return out;
  };
};

const recolorValue = (c: Rgba, map: (hex: string) => string | null): Rgba => {
  if (!Array.isArray(c) || c.length < 3 || c.slice(0, 3).some((v) => typeof v !== 'number')) return c;
  const next = map(toHex(c));
  return next ? toLottie(next, c[3]) : c;
};

/** `c` of a fill/stroke: static ({a:0,k:[r,g,b,a]}) or keyframed ({a:1,k:[{s,e}]}). */
const recolorProperty = (prop: { a?: number; k?: unknown } | undefined, map: (hex: string) => string | null) => {
  if (!prop || prop.k === undefined) return;
  if (Array.isArray(prop.k) && typeof prop.k[0] === 'number') {
    prop.k = recolorValue(prop.k as Rgba, map);
    return;
  }
  if (Array.isArray(prop.k)) {
    for (const kf of prop.k as Array<{ s?: Rgba; e?: Rgba }>) {
      if (kf && Array.isArray(kf.s)) kf.s = recolorValue(kf.s, map);
      if (kf && Array.isArray(kf.e)) kf.e = recolorValue(kf.e, map);
    }
  }
};

/** Gradient stops are flat [offset, r, g, b, offset, r, g, b, …, opacity stops…]. */
const recolorGradientStops = (stops: number[], count: number, map: (hex: string) => string | null) => {
  for (let i = 0; i < count; i++) {
    const at = i * 4 + 1;
    const next = recolorValue(stops.slice(at, at + 3), map);
    stops.splice(at, 3, ...next.slice(0, 3));
  }
};

const recolorGradient = (g: { p?: number; k?: { a?: number; k?: unknown } } | undefined, map: (hex: string) => string | null) => {
  if (!g?.k || typeof g.p !== 'number') return;
  const k = g.k.k;
  if (Array.isArray(k) && typeof k[0] === 'number') recolorGradientStops(k as number[], g.p, map);
  else if (Array.isArray(k)) {
    for (const kf of k as Array<{ s?: number[]; e?: number[] }>) {
      if (kf && Array.isArray(kf.s)) recolorGradientStops(kf.s, g.p, map);
      if (kf && Array.isArray(kf.e)) recolorGradientStops(kf.e, g.p, map);
    }
  }
};

const walk = (node: unknown, map: (hex: string) => string | null) => {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, map);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.ty === 'fl' || obj.ty === 'st') recolorProperty(obj.c as { k?: unknown }, map);
  if (obj.ty === 'gf' || obj.ty === 'gs') recolorGradient(obj.g as { p?: number; k?: { k?: unknown } }, map);
  for (const value of Object.values(obj)) if (value && typeof value === 'object') walk(value, map);
};

/** Returns a recolored copy of a Lottie JSON for the campaign theme. Never mutates `data`. */
export const recolorLottie = (data: object, theme: FxTheme): object => {
  const copy = structuredClone(data) as object;
  walk(copy, makeMapper(theme));
  return copy;
};
