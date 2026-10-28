// OWNER: agent B (theme engine). Derives every card-fx color from the campaign
// design (palette, background photo + overlay, fxStyle) so no effect assumes a
// palette. docs/CARD_ENGAGEMENT_PLAN.md §5.0. Pure and deterministic.
import type { FxStyle, Template } from '../../types';
import { contrastRatio, getHexLuminance, mixHexColors } from '../color';
import { resolveHexAndOpacity } from '../utils';
import {
  chroma,
  ensureContrast,
  greyFromLuminance,
  hexToHsl,
  hslToHex,
  hueDistance,
  lightness,
  rotateHue,
  shiftLightness,
  withLightness,
} from './colorMath';
import type { FxTheme } from './types';

/** Luma sample of the uploaded background image, if one could be read. */
export interface ImageSample {
  /** Mean luminance 0..1. */
  luma: number;
  /** Luminance standard deviation 0..1 (busy photo ≈ > 0.22). */
  variance: number;
}

/** Same threshold the public card shell uses for its dark chrome. */
export const DARK_SURFACE_LUMINANCE = 0.38;
/** At or above this overlay opacity the photo is treated as not visible. */
export const OPAQUE_OVERLAY = 85;
export const BUSY_VARIANCE = 0.22;

export const GIFT_GOLD = '#f5b301';
/** Gift color when gold clashes with the accent, on light / dark surfaces. */
export const GIFT_ROSE_GOLD = '#b76e79';
export const GIFT_WHITE_GOLD = '#efe7d2';

const STYLE_INTENSITY: Record<FxStyle, number> = { elegant: 0.6, playful: 1, minimal: 0.25 };
const BUSY_INTENSITY = 0.7;

const FROSTED_LIGHT = { bg: 'rgba(255,255,255,0.88)', fg: '#111111' };
const FROSTED_DARK = { bg: 'rgba(0,0,0,0.72)', fg: '#ffffff' };

/**
 * Gift accent rule: gold is the gift signal. It is swapped only when the
 * accent would make it unreadable — the accent's hue is within 25° of gold
 * AND the accent is vivid (chroma ≥ 0.3; muted tans/beiges still read as
 * different from saturated gold). The swap is rose gold on light surfaces
 * (dark enough to read on pastels) and white gold on dark surfaces.
 */
export const pickGiftAccent = (accent: string, dark: boolean) => {
  const clashes = chroma(accent) >= 0.3 && hueDistance(hexToHsl(accent).h, hexToHsl(GIFT_GOLD).h) < 25;
  if (!clashes) return GIFT_GOLD;
  return dark ? GIFT_WHITE_GOLD : GIFT_ROSE_GOLD;
};

const dedupe = (colors: string[]) => {
  const out: string[] = [];
  for (const c of colors) {
    if (!out.some((o) => contrastRatio(o, c) < 1.08 && hueDistance(hexToHsl(o).h, hexToHsl(c).h) < 12)) out.push(c);
  }
  return out;
};

const MIN_PARTICLE_CONTRAST = 1.3;

/**
 * Particle palette: accent, ink, a lighter tint and a deeper shade of the
 * accent, plus a highlight (gift gold on light surfaces, near-white on dark).
 * `playful` swaps the shade for two analogous hues (±35°) so confetti feels
 * mixed but still on-brand — never a rainbow.
 */
const buildParticles = (accent: string, ink: string, giftAccent: string, surfaceHex: string, style: FxStyle) => {
  const dark = getHexLuminance(surfaceHex) < DARK_SURFACE_LUMINANCE;
  // Capped short of white/black so tints keep their hue.
  const tint = withLightness(accent, Math.min(lightness(accent) + 18, 95));
  const shade = withLightness(accent, Math.max(lightness(accent) - 18, 12));
  const highlight = dark ? mixHexColors(accent, '#ffffff', 0.82) : giftAccent;
  // Grey accents have no hue to rotate: playful extras come from the gift gold.
  const extras =
    chroma(accent) < 0.15
      ? [rotateHue(giftAccent, -18), mixHexColors(giftAccent, '#ffffff', 0.45)]
      : [35, -35].map((deg) => {
          const hsl = hexToHsl(accent);
          return hslToHex({ h: hsl.h + deg, s: Math.min(hsl.s, 0.75), l: hsl.l }); // no neon
        });
  const derived = style === 'playful' ? [tint, highlight, ...extras] : [tint, shade, highlight];
  // The accent is the brand color and is always kept as-is. Ink is dropped
  // when it disappears into the surface (e.g. white ink on a white card);
  // derived colors are nudged away from the surface until visible.
  const inkVisible = contrastRatio(ink, surfaceHex) >= MIN_PARTICLE_CONTRAST ? [ink] : [];
  const visible = [accent, ...inkVisible, ...derived.map((c) => ensureContrast(c, surfaceHex, MIN_PARTICLE_CONTRAST))];
  let unique = dedupe(visible);
  // Keep at least 4 (e.g. ink == accent): refill with lighter/deeper accents.
  if (unique.length < 4) {
    const extra = [30, -30, 42, -42].map((d) => ensureContrast(shiftLightness(accent, d), surfaceHex, MIN_PARTICLE_CONTRAST));
    unique = dedupe([...unique, ...extra]);
  }
  return unique.slice(0, 6);
};

export const deriveFxTheme = (template: Template, image?: ImageSample | null): FxTheme => {
  const style: FxStyle = template.fxStyle ?? 'elegant';
  const accent = resolveHexAndOpacity(template.colors.stampActive, '#111111').hex;
  const ink = resolveHexAndOpacity(template.colors.iconActive, '#ffffff').hex;
  const bg = resolveHexAndOpacity(template.colors.background, '#ffffff').hex;
  const overlay = template.backgroundOpacity ?? 100;
  const imageVisible = Boolean(template.backgroundImage) && overlay < OPAQUE_OVERLAY;

  // Effective color under the stamps: the overlay blends over the photo in
  // sRGB, so blend a grey of the photo's mean luminance the same way.
  // image === undefined → not sampled yet; null → sampling failed (CORS).
  const surfaceHex =
    imageVisible && image ? mixHexColors(greyFromLuminance(image.luma), bg, overlay / 100) : bg;
  const dark = getHexLuminance(surfaceHex) < DARK_SURFACE_LUMINANCE;
  // A photo we could not read is assumed busy-ish so effects stay quiet.
  const busyBackground = imageVisible && (image === null || (image !== undefined && image.variance > BUSY_VARIANCE));

  const giftAccent = pickGiftAccent(accent, dark);
  const particles = buildParticles(accent, ink, giftAccent, surfaceHex, style);

  const sheenAlpha = (dark ? 0.18 : 0.35) * (busyBackground ? 0.5 : 1);

  const cardBg = resolveHexAndOpacity(template.colors.cardBackground, '#ffffff').hex;
  const text = resolveHexAndOpacity(template.colors.text, '#111111').hex;
  const bubble = contrastRatio(cardBg, text) >= 4.5 ? { bg: cardBg, fg: text } : dark ? FROSTED_DARK : FROSTED_LIGHT;

  const intensity = STYLE_INTENSITY[style] * (busyBackground ? BUSY_INTENSITY : 1);

  return {
    style,
    surface: dark ? 'dark' : 'light',
    accent,
    ink,
    particles,
    giftAccent,
    sheen: { color: '#ffffff', alpha: Number(sheenAlpha.toFixed(3)), blend: dark ? 'soft-light' : 'overlay' },
    bubble,
    intensity: Number(intensity.toFixed(3)),
    busyBackground,
  };
};
