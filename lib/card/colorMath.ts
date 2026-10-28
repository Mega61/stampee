// Extra color helpers for the card fx theme (docs/CARD_ENGAGEMENT_PLAN.md §5.0).
// Builds on lib/color.ts; everything here is pure and works on #rrggbb hex.
import { contrastRatio, getHexLuminance, hexToRgb, normalizeHexColor, rgbToHex } from '../color';

export interface Hsl {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  l: number;
}

export const hexToHsl = (value: string): Hsl => {
  const [r, g, b] = hexToRgb(value).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
};

export const hslToHex = ({ h, s, l }: Hsl) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
};

/** Chroma (max − min channel), 0..1. Unlike HSL saturation it stays low for pale pastels. */
export const chroma = (value: string) => {
  const rgb = hexToRgb(value);
  return (Math.max(...rgb) - Math.min(...rgb)) / 255;
};

/** Shortest angular distance between two hues, 0..180. */
export const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Perceptual lightness CIE L*, 0..100, from WCAG relative luminance. */
export const lightness = (value: string) => {
  const y = getHexLuminance(value);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};

/** sRGB grey whose relative luminance is `y` (0..1). */
export const greyFromLuminance = (y: number) => {
  const clamped = Math.min(1, Math.max(0, y));
  const c = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return rgbToHex(c * 255, c * 255, c * 255);
};

/**
 * Same hue and saturation, HSL lightness solved so the color lands on L*
 * `target` (so tints stay colorful instead of greying out). Binary search:
 * deterministic and within ±0.5 L*.
 */
export const withLightness = (value: string, target: number) => {
  const base = normalizeHexColor(value);
  const goal = Math.min(100, Math.max(0, target));
  if (Math.abs(goal - lightness(base)) < 0.5) return base;
  const hsl = hexToHsl(base);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (lightness(hslToHex({ ...hsl, l: mid })) < goal) lo = mid;
    else hi = mid;
  }
  return hslToHex({ ...hsl, l: (lo + hi) / 2 });
};

/** Moves L* by `delta` (positive = lighter). */
export const shiftLightness = (value: string, delta: number) => withLightness(value, lightness(value) + delta);

/** Rotates the hue, keeping saturation and lightness. */
export const rotateHue = (value: string, degrees: number) => {
  const hsl = hexToHsl(value);
  return hslToHex({ ...hsl, h: hsl.h + degrees });
};

/**
 * Nudges `value` away from `surface` (darker on light surfaces, lighter on dark
 * ones) until the contrast ratio reaches `min`. Returns it unchanged if it
 * already does.
 */
export const ensureContrast = (value: string, surface: string, min: number) => {
  let color = normalizeHexColor(value);
  if (contrastRatio(color, surface) >= min) return color;
  const step = getHexLuminance(surface) < 0.38 ? 4 : -4;
  for (let i = 0; i < 25 && contrastRatio(color, surface) < min; i++) color = shiftLightness(color, step);
  return color;
};
