// OWNER: agent B (theme engine). Samples the campaign background photo once so
// the fx theme knows how light and how busy it is (docs/CARD_ENGAGEMENT_PLAN.md §5.0).
// Uploaded backgrounds are signed GCS URLs: reading pixels needs the bucket's
// CORS config (infra/README.md). Any failure resolves to null.
import type { ImageSample } from './fxTheme';

const SIZE = 16;
const CACHE_PREFIX = 'stampee:fx-luma:';

// Pixels → sample. `luma` is mean WCAG relative luminance (it is mixed with the
// overlay color later); `variance` is the std-dev of perceptual lightness
// (CIE L* scaled to 0..1), which tracks how busy the photo looks. Alpha-weighted.
export const sampleFromPixels = (data: ArrayLike<number>): ImageSample | null => {
  let weight = 0;
  let sumY = 0;
  let sumL = 0;
  let sumL2 = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    if (a === 0) continue;
    const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!].map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const l = (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y) / 100;
    weight += a;
    sumY += y * a;
    sumL += l * a;
    sumL2 += l * l * a;
  }
  if (weight === 0) return null;
  const meanL = sumL / weight;
  const variance = Math.sqrt(Math.max(0, sumL2 / weight - meanL * meanL));
  return { luma: round(sumY / weight), variance: round(variance) };
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Signed URLs change their signature on every fetch: cache by path only. */
export const lumaCacheKey = (url: string) => {
  if (url.startsWith('data:') || url.startsWith('blob:')) return null;
  return CACHE_PREFIX + url.split(/[?#]/)[0];
};

type Cached = ImageSample | null | undefined;

/** undefined = not cached; null = cached failure. */
export const readCachedSample = (url: string): Cached => {
  const key = lumaCacheKey(url);
  if (!key) return undefined;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as ImageSample | null;
    if (parsed === null) return null;
    return typeof parsed.luma === 'number' && typeof parsed.variance === 'number' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const writeCachedSample = (url: string, sample: ImageSample | null) => {
  const key = lumaCacheKey(url);
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(sample));
  } catch {
    // Private mode / quota: sampling again next time is fine.
  }
};

const inflight = new Map<string, Promise<ImageSample | null>>();

const loadAndSample = (url: string) =>
  new Promise<ImageSample | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        // Throws SecurityError on a CORS-tainted canvas.
        resolve(sampleFromPixels(ctx.getImageData(0, 0, SIZE, SIZE).data));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });

/** Samples the image once per URL path (deduped in flight, cached in sessionStorage). */
export const sampleImageLuma = (url: string): Promise<ImageSample | null> => {
  const cached = readCachedSample(url);
  if (cached !== undefined) return Promise.resolve(cached);
  const key = lumaCacheKey(url) ?? url;
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = loadAndSample(url).then((sample) => {
    writeCachedSample(url, sample);
    inflight.delete(key);
    return sample;
  });
  inflight.set(key, promise);
  return promise;
};
