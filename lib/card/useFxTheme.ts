// OWNER: agent B (theme engine). The fx theme for a campaign. Returns the
// palette-only theme immediately and upgrades once the background photo has
// been sampled (instantly when the sample is already cached this session).
import { useEffect, useMemo, useState } from 'react';
import type { Template } from '../../types';
import { deriveFxTheme, OPAQUE_OVERLAY, type ImageSample } from './fxTheme';
import { lumaCacheKey, readCachedSample, sampleImageLuma } from './imageLuma';
import type { FxTheme } from './types';

// Keyed by URL path: a re-signed URL for the same photo keeps its sample.
type Sampled = { key: string; value: ImageSample | null };

const sameSample = (a: ImageSample | null, b: ImageSample | null) =>
  a === b || (a !== null && b !== null && a.luma === b.luma && a.variance === b.variance);

export const useFxTheme = (template: Template): FxTheme => {
  const visible = (template.backgroundOpacity ?? 100) < OPAQUE_OVERLAY;
  const url = visible ? template.backgroundImage : undefined;
  const key = url ? lumaCacheKey(url) ?? url : undefined;
  const [sample, setSample] = useState<Sampled | null>(() => {
    const cached = url ? readCachedSample(url) : undefined;
    return key && cached !== undefined ? { key, value: cached } : null;
  });

  useEffect(() => {
    if (!url || !key) return;
    let cancelled = false;
    void sampleImageLuma(url).then((value) => {
      if (!cancelled) setSample((prev) => (prev?.key === key && sameSample(prev.value, value) ? prev : { key, value }));
    });
    return () => {
      cancelled = true;
    };
  }, [url, key]);

  // undefined = not sampled yet (palette-only theme), null = sampling failed.
  const image = key && sample?.key === key ? sample.value : undefined;
  return useMemo(() => deriveFxTheme(template, image), [template, image]);
};
