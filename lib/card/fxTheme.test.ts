import { describe, expect, it } from 'vitest';
import { templates } from '../../data/templates';
import type { Template } from '../../types';
import { contrastRatio } from '../color';
import { chroma, hexToHsl, hueDistance, lightness, withLightness } from './colorMath';
import { deriveFxTheme, GIFT_GOLD, GIFT_ROSE_GOLD, GIFT_WHITE_GOLD, pickGiftAccent } from './fxTheme';
import { lumaCacheKey, sampleFromPixels } from './imageLuma';

const preset = (id: string, patch: Partial<Template> = {}): Template => {
  const t = templates.find((x) => x.id === id);
  if (!t) throw new Error(`no preset ${id}`);
  return { ...t, ...patch };
};

const HEX = /^#[0-9a-f]{6}$/i;

describe('deriveFxTheme: presets', () => {
  it('midnight-brew is a dark surface with soft-light sheen and gold gifts', () => {
    const theme = deriveFxTheme(preset('midnight-brew'));
    expect(theme.surface).toBe('dark');
    expect(theme.accent.toLowerCase()).toBe('#cfb096');
    expect(theme.sheen).toEqual({ color: '#ffffff', alpha: 0.18, blend: 'soft-light' });
    // Muted tan accent: gold still reads as different.
    expect(theme.giftAccent).toBe(GIFT_GOLD);
    expect(theme.style).toBe('elegant');
    expect(theme.intensity).toBe(0.6);
    expect(theme.busyBackground).toBe(false);
  });

  it('massage-bliss (pastel) is light with overlay sheen and the palette bubble', () => {
    const theme = deriveFxTheme(preset('massage-bliss'));
    expect(theme.surface).toBe('light');
    expect(theme.sheen).toEqual({ color: '#ffffff', alpha: 0.35, blend: 'overlay' });
    expect(theme.bubble).toEqual({ bg: '#ffffff', fg: '#581C87' });
    expect(theme.giftAccent).toBe(GIFT_GOLD);
  });

  it('boba-time (gold accent) swaps the gift color away from gold', () => {
    const theme = deriveFxTheme(preset('boba-time'));
    expect(theme.giftAccent).toBe(GIFT_ROSE_GOLD);
    expect(hueDistance(hexToHsl(theme.giftAccent).h, hexToHsl(theme.accent).h)).toBeGreaterThanOrEqual(25);
  });

  it('a gold accent on a dark surface swaps to white gold', () => {
    expect(pickGiftAccent('#e6b422', true)).toBe(GIFT_WHITE_GOLD);
    expect(pickGiftAccent('#e6b422', false)).toBe(GIFT_ROSE_GOLD);
    expect(pickGiftAccent('#3b82f6', false)).toBe(GIFT_GOLD);
  });

  it('style sets intensity; defaults to elegant', () => {
    expect(deriveFxTheme(preset('pizza-party', { fxStyle: 'playful' })).intensity).toBe(1);
    expect(deriveFxTheme(preset('pizza-party', { fxStyle: 'minimal' })).intensity).toBe(0.25);
    expect(deriveFxTheme(preset('pizza-party', { fxStyle: undefined })).style).toBe('elegant');
  });

  it('every preset × style yields 4–6 valid particles, starting with the accent', () => {
    for (const t of templates) {
      for (const fxStyle of ['elegant', 'playful', 'minimal'] as const) {
        const theme = deriveFxTheme({ ...t, fxStyle });
        expect(theme.particles.length, `${t.id}/${fxStyle}`).toBeGreaterThanOrEqual(4);
        expect(theme.particles.length, `${t.id}/${fxStyle}`).toBeLessThanOrEqual(6);
        expect(theme.particles[0]).toBe(theme.accent);
        for (const p of theme.particles) expect(p).toMatch(HEX);
        expect(new Set(theme.particles).size).toBe(theme.particles.length);
      }
    }
  });

  it('non-playful particles stay in the accent / ink / gift family (no rainbow)', () => {
    for (const t of templates) {
      const theme = deriveFxTheme({ ...t, fxStyle: 'elegant' });
      const allowed = [theme.accent, theme.ink, theme.giftAccent].map((c) => hexToHsl(c).h);
      for (const p of theme.particles) {
        if (chroma(p) < 0.15) continue; // greys/near-whites carry no hue
        const near = allowed.some((h) => hueDistance(h, hexToHsl(p).h) <= 20);
        expect(near, `${t.id}: ${p}`).toBe(true);
      }
    }
  });

  it('bubbles always meet 4.5:1 (falls back to frosted glass)', () => {
    for (const t of templates) {
      const { bubble } = deriveFxTheme(t);
      if (bubble.bg.startsWith('#')) expect(contrastRatio(bubble.bg, bubble.fg)).toBeGreaterThanOrEqual(4.5);
    }
    const lowContrast = preset('sweet-scoops', { colors: { ...preset('sweet-scoops').colors, cardBackground: '#ffffff', text: '#cccccc' } });
    expect(deriveFxTheme(lowContrast).bubble).toEqual({ bg: 'rgba(255,255,255,0.88)', fg: '#111111' });
    const darkLow = preset('midnight-brew', { colors: { ...preset('midnight-brew').colors, cardBackground: '#2c2420', text: '#3a302a' } });
    expect(deriveFxTheme(darkLow).bubble).toEqual({ bg: 'rgba(0,0,0,0.72)', fg: '#ffffff' });
  });

  it('resolves Tailwind-style class colors', () => {
    const t = preset('sharp-cuts', { colors: { ...preset('sharp-cuts').colors, stampActive: 'bg-[#123456]/80', background: 'bg-[#0a0a0a]' } });
    const theme = deriveFxTheme(t);
    expect(theme.accent).toBe('#123456');
    expect(theme.surface).toBe('dark');
  });

  it('is deterministic', () => {
    const t = preset('laundry-fresh', { fxStyle: 'playful' });
    expect(deriveFxTheme(t)).toEqual(deriveFxTheme(t));
  });
});

describe('deriveFxTheme: background photos', () => {
  const light = preset('massage-bliss', { backgroundImage: '/image_3.jpg', backgroundOpacity: 40 });

  it('a dark photo under a light overlay turns the surface dark', () => {
    expect(deriveFxTheme(light, { luma: 0.02, variance: 0.1 }).surface).toBe('dark');
    expect(deriveFxTheme(light, { luma: 0.8, variance: 0.1 }).surface).toBe('light');
  });

  it('ignores the photo when the overlay is ≥ 85 %', () => {
    const opaque = { ...light, backgroundOpacity: 90 };
    const theme = deriveFxTheme(opaque, { luma: 0.01, variance: 0.4 });
    expect(theme.surface).toBe('light');
    expect(theme.busyBackground).toBe(false);
  });

  it('a busy photo halves the sheen and tones intensity down', () => {
    const theme = deriveFxTheme(light, { luma: 0.6, variance: 0.3 });
    expect(theme.busyBackground).toBe(true);
    expect(theme.sheen.alpha).toBeCloseTo(0.175);
    expect(theme.intensity).toBeCloseTo(0.42);
  });

  it('a calm photo is not busy', () => {
    expect(deriveFxTheme(light, { luma: 0.6, variance: 0.1 }).busyBackground).toBe(false);
  });

  it('failed sampling falls back to the overlay color and stays quiet', () => {
    const theme = deriveFxTheme(light, null);
    expect(theme.surface).toBe('light');
    expect(theme.busyBackground).toBe(true);
    expect(theme.sheen.alpha).toBeCloseTo(0.175);
  });

  it('not sampled yet → palette-only theme', () => {
    const theme = deriveFxTheme(light, undefined);
    expect(theme).toEqual(deriveFxTheme({ ...light, backgroundImage: undefined }));
  });
});

describe('image sampling helpers', () => {
  const px = (...rgba: number[][]) => rgba.flat();

  it('computes mean luminance and lightness spread', () => {
    const flatGrey = sampleFromPixels(px([128, 128, 128, 255], [128, 128, 128, 255]))!;
    expect(flatGrey.variance).toBe(0);
    expect(flatGrey.luma).toBeCloseTo(0.216, 2);
    const checker = sampleFromPixels(px([0, 0, 0, 255], [255, 255, 255, 255]))!;
    expect(checker.luma).toBeCloseTo(0.5, 2);
    expect(checker.variance).toBeCloseTo(0.5, 2);
  });

  it('ignores transparent pixels; all transparent → null', () => {
    expect(sampleFromPixels(px([0, 0, 0, 0], [255, 255, 255, 255]))!.luma).toBe(1);
    expect(sampleFromPixels(px([0, 0, 0, 0]))).toBeNull();
  });

  it('caches by URL path, ignoring the signature', () => {
    expect(lumaCacheKey('https://storage.googleapis.com/b/o/bg.jpg?X-Goog-Signature=abc')).toBe(
      lumaCacheKey('https://storage.googleapis.com/b/o/bg.jpg?X-Goog-Signature=def'),
    );
    expect(lumaCacheKey('data:image/png;base64,AAAA')).toBeNull();
  });
});

describe('colorMath', () => {
  it('withLightness hits the target L* and keeps the hue', () => {
    const out = withLightness('#f472b6', 40);
    expect(lightness(out)).toBeCloseTo(40, 0);
    expect(hueDistance(hexToHsl(out).h, hexToHsl('#f472b6').h)).toBeLessThan(3);
  });
});
