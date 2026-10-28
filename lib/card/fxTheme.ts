// OWNER: agent B (theme engine). Wave 0 stub: neutral theme from the palette.
import type { Template } from '../../types';
import { getHexLuminance } from '../color';
import { resolveHexAndOpacity } from '../utils';
import type { FxTheme } from './types';

/** Luma sample of the uploaded background image, if one could be read. */
export interface ImageSample {
  /** Mean luminance 0..1. */
  luma: number;
  /** Luminance standard deviation 0..1 (busy photo ≈ > 0.22). */
  variance: number;
}

export const deriveFxTheme = (template: Template, _image?: ImageSample | null): FxTheme => {
  const accent = resolveHexAndOpacity(template.colors.stampActive, '#111111').hex;
  const ink = resolveHexAndOpacity(template.colors.iconActive, '#ffffff').hex;
  const bg = resolveHexAndOpacity(template.colors.background, '#ffffff').hex;
  const dark = getHexLuminance(bg) < 0.38;
  return {
    style: template.fxStyle ?? 'elegant',
    surface: dark ? 'dark' : 'light',
    accent,
    ink,
    particles: [accent, ink],
    giftAccent: '#f5b301',
    sheen: { color: '#ffffff', alpha: dark ? 0.18 : 0.35, blend: dark ? 'soft-light' : 'overlay' },
    bubble: dark ? { bg: 'rgba(0,0,0,0.7)', fg: '#ffffff' } : { bg: 'rgba(255,255,255,0.85)', fg: '#111111' },
    intensity: 0.6,
    busyBackground: false,
  };
};
