import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { templates } from '../../data/templates';
import { rgbToHex } from '../color';
import { hexToHsl, hueDistance, lightness } from './colorMath';
import { deriveFxTheme } from './fxTheme';
import { recolorLottie } from './lottieRecolor';

const giftBox = JSON.parse(readFileSync(resolve(__dirname, '../../Gift Box Orange.json'), 'utf8')) as object;

const theme = deriveFxTheme(templates.find((t) => t.id === 'laundry-fresh')!); // sky-blue accent, gold gift

const fill = (k: unknown, a = 0) => ({ ty: 'fl', c: { a, k }, o: { a: 0, k: 100 } });
const hexOf = (c: number[]) => rgbToHex(c[0]! * 255, c[1]! * 255, c[2]! * 255);
const shape = (...items: object[]) => ({ layers: [{ ty: 4, shapes: [{ ty: 'gr', it: items }] }] });

/** All static fill/stroke colors in a Lottie, as hex. */
const colors = (data: unknown): string[] => {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, any>;
    if ((o.ty === 'fl' || o.ty === 'st') && typeof o.c?.k?.[0] === 'number') out.push(hexOf(o.c.k));
    Object.values(o).forEach(walk);
  };
  walk(data);
  return out;
};

describe('recolorLottie', () => {
  it('never mutates the input', () => {
    const before = JSON.stringify(giftBox);
    const out = recolorLottie(giftBox, theme);
    expect(JSON.stringify(giftBox)).toBe(before);
    expect(out).not.toBe(giftBox);
  });

  it('turns an orange fill accent-hued and leaves white alone', () => {
    const data = shape(fill([1, 0.5059, 0.2824, 1]), fill([1, 1, 1, 1]), fill([0.82, 0.82, 0.82, 1]));
    const [orange, white, grey] = colors(recolorLottie(data, theme));
    expect(hueDistance(hexToHsl(orange!).h, hexToHsl(theme.accent).h)).toBeLessThan(6);
    expect(white).toBe('#ffffff');
    expect(grey).toBe('#d1d1d1');
  });

  it('turns gold faces into the gift accent, keeping light/shaded faces apart', () => {
    const swapped = deriveFxTheme(templates.find((t) => t.id === 'boba-time')!); // rose-gold gift
    const data = shape(fill([1, 0.8431, 0, 1]), fill([1, 0.749, 0, 1]));
    const [light, shaded] = colors(recolorLottie(data, swapped));
    const giftHue = hexToHsl(swapped.giftAccent).h;
    expect(hueDistance(hexToHsl(light!).h, giftHue)).toBeLessThan(8);
    expect(hueDistance(hexToHsl(shaded!).h, giftHue)).toBeLessThan(8);
    expect(lightness(light!)).toBeGreaterThan(lightness(shaded!) + 2);
  });

  it('recolors animated keyframes and keeps alpha', () => {
    const data = shape(fill([{ t: 0, s: [1, 0.2235, 0.0078, 0.5], e: [1, 0.2235, 0.0078, 0.5] }, { t: 10 }], 1));
    const out = recolorLottie(data, theme) as any;
    const kf = out.layers[0].shapes[0].it[0].c.k[0];
    expect(kf.s[3]).toBe(0.5);
    expect(hueDistance(hexToHsl(hexOf(kf.s)).h, hexToHsl(theme.accent).h)).toBeLessThan(6);
    expect(kf.e).toEqual(kf.s);
  });

  it('recolors gradient stops', () => {
    const data = { layers: [{ shapes: [{ ty: 'gf', g: { p: 2, k: { a: 0, k: [0, 1, 0.38, 0, 1, 1, 1, 1] } } }] }] };
    const out = recolorLottie(data, theme) as any;
    const stops = out.layers[0].shapes[0].g.k.k as number[];
    expect(stops[0]).toBe(0);
    expect(hueDistance(hexToHsl(hexOf(stops.slice(1, 4))).h, hexToHsl(theme.accent).h)).toBeLessThan(6);
    expect(stops.slice(5, 8)).toEqual([1, 1, 1]); // white stop untouched
  });

  it('leaves no off-theme saturated color in the gift box asset', () => {
    const out = recolorLottie(giftBox, theme);
    const allowed = [theme.accent, theme.giftAccent, ...theme.particles];
    for (const c of colors(out)) {
      const { s, l } = hexToHsl(c);
      if (s < 0.2 || l > 0.92) continue;
      const near = allowed.some((a) => hueDistance(hexToHsl(a).h, hexToHsl(c).h) < 8);
      expect(near, c).toBe(true);
    }
  });
});
