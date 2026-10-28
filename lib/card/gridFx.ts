// Pure helpers for the tactile public grid (plan §5.2–5.5): copy, labels,
// color checks and particle budgets. No DOM, unit-tested.
import { contrastRatio, hexToRgb } from '../color';
import type { Transaction } from '../../types';
import type { FxTheme, FxBusEvents } from './types';

const MONTHS = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];

/** "12 de oct." (adds the year when it isn't the current one). */
export const formatEarnedDate = (timestamp: number, now = Date.now()) => {
  const d = new Date(timestamp);
  const base = `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
};

/** How a slot was earned, as the customer would say it. */
export const originLabel = (type: Transaction['type'] | null) => {
  switch (type) {
    case 'stamp_add':
      return 'Visita';
    case 'gift':
    case 'issued':
      return 'Regalo';
    case 'bonus':
      return 'Sello de la suerte';
    default:
      return null;
  }
};

/** Tooltip for a tapped gifted stamp. */
export const giftedCopy = (type: Transaction['type'] | null, businessName: string) =>
  type === 'bonus' ? 'Sello de la suerte' : `Regalo de ${businessName}`;

/** Tooltip for a tapped empty slot. */
export const remainingCopy = (remaining: number, rewardName: string) =>
  remaining === 1 ? `Te falta 1 para tu ${rewardName}` : `Te faltan ${remaining} para tu ${rewardName}`;

export const slotAriaLabel = (opts: {
  index: number;
  total: number;
  filled: boolean;
  wrapped?: boolean;
  timestamp?: number | null;
  type?: Transaction['type'] | null;
}) => {
  const head = `Sello ${opts.index + 1} de ${opts.total}`;
  if (opts.wrapped) return `${head}, regalo sin abrir`;
  if (!opts.filled) return `${head}, pendiente`;
  const origin = originLabel(opts.type ?? null);
  const parts = [head, opts.timestamp ? `obtenido el ${formatEarnedDate(opts.timestamp)}` : 'obtenido'];
  if (origin && origin !== 'Visita') parts.push(origin.toLowerCase());
  return parts.join(', ');
};

const hue = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l = (max + min) / 2;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(2 * l - 1)) };
};

/** Same color with its hue turned by `deg` (playful confetti stays on-palette). */
export const rotateHue = (hex: string, deg: number) => {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number];
  const { h, s: rawS } = hue(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = Math.min(0.7, Math.max(0.45, (max + min) / 2));
  const s = Math.max(0.55, Math.min(1, rawS));
  const nh = (((h + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((nh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    nh < 60 ? [c, x, 0] : nh < 120 ? [x, c, 0] : nh < 180 ? [0, c, x] : nh < 240 ? [0, x, c] : nh < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
};

/** Hue distance in degrees (0..180); grays count as far from everything. */
export const hueDistance = (a: string, b: string) => {
  const ha = hue(a);
  const hb = hue(b);
  if (ha.s < 0.15 || hb.s < 0.15) return 180;
  const d = Math.abs(ha.h - hb.h);
  return Math.min(d, 360 - d);
};

/** Gift badge needs a contrasting ring when gold sits on a gold-ish stamp. */
export const giftBadgeRing = (theme: Pick<FxTheme, 'accent' | 'ink' | 'giftAccent'>) => {
  const close = hueDistance(theme.giftAccent, theme.accent) < 35 || contrastRatio(theme.giftAccent, theme.accent) < 1.6;
  return { close, color: close ? theme.ink : theme.accent };
};

/** `color` at `alpha` (hex or rgb[a]() input; other CSS colors pass through). */
export const withAlpha = (color: string, alpha: number) => {
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    const [r, g, b] = hexToRgb(color);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : color;
};

/** Black or white, whichever reads better on `bg`. */
export const readableOn = (bg: string) => (contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#1a1a1a') ? '#ffffff' : '#1a1a1a');

/** Particle count for a burst, scaled by the style's intensity. */
export const burstCount = (kind: FxBusEvents['fx:burst']['kind'], intensity: number) => {
  const max = { tap: 12, gift: 34, slam: 22, celebrate: 140 }[kind];
  const min = { tap: 8, gift: 16, slam: 12, celebrate: 50 }[kind];
  // minimal (0.25) → min, playful (1) → max, elegant (0.6) in between.
  const k = Math.min(1, Math.max(0, (intensity - 0.25) / 0.75));
  return Math.round(min + (max - min) * k);
};

/**
 * Horizontal placement for a bubble centered on `anchorX`, kept `margin` px
 * inside the viewport. Returns its left edge and the arrow's x inside it.
 */
export const placeBubble = (anchorX: number, width: number, viewportWidth: number, margin = 12) => {
  const left = Math.min(Math.max(anchorX - width / 2, margin), Math.max(margin, viewportWidth - margin - width));
  const arrowX = Math.min(Math.max(anchorX - left, 14), width - 14);
  return { left, arrowX };
};
