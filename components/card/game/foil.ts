// Metallic foil for the scratch experiences: palette from the FxTheme, a
// one-time painted base (gradient banding + brushed lines + grain + pattern),
// and a live view that adds the tilt-following specular, the light sweep and
// (for playful) a holographic shift. The scratch mask is subtracted on top.
// Canvas only; nothing here touches React.
import { mixHexColors } from '../../../lib/color';
import { rotateHue } from '../../../lib/card/colorMath';
import { seededRandom } from '../../../lib/card/scratch';
import type { FxTheme } from '../../../lib/card/types';

const isHex = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const mix = (a: string, b: string, w: number) => (isHex(a) && isHex(b) ? mixHexColors(a, b, w) : a);

export interface FoilPalette {
  /** Flat fill for the minimal style. */
  flat: string;
  /** Gradient stops, dark → light, used for the banding. */
  shadow: string;
  base: string;
  light: string;
  glint: string;
  /** Flake/shard colors. */
  flakes: string[];
  /** Holographic hues (playful). */
  holo: string[];
}

export type FoilKind = 'ticket' | 'reward';

/**
 * Ticket foil: accent → giftAccent → accent. Reward foil: celebratory,
 * giftAccent-led. Both are toned so they read as metal on any palette.
 */
export const foilPalette = (theme: FxTheme, kind: FoilKind = 'ticket'): FoilPalette => {
  const lead = kind === 'reward' ? theme.giftAccent : theme.accent;
  const second = kind === 'reward' ? theme.accent : theme.giftAccent;
  // Metals are mid-tone: pull very dark accents up and very light ones down.
  const base = mix(lead, mix(lead, second, 0.35), 0.5);
  const shadow = mix(base, '#000000', 0.38);
  const light = mix(second, '#ffffff', 0.5);
  const glint = mix(second, '#ffffff', 0.82);
  const holo = isHex(theme.accent)
    ? [0, 60, 130, 200, 280].map((d) => mix(rotateHue(theme.accent, d), '#ffffff', 0.35))
    : [light, glint];
  return {
    flat: lead,
    shadow,
    base,
    light,
    glint,
    flakes: [shadow, base, light, glint, mix(base, '#ffffff', 0.25)],
    holo,
  };
};

export interface FoilPaintOptions {
  palette: FoilPalette;
  /** Flat accent, no banding/brush (minimal). */
  flat?: boolean;
  holo?: boolean;
  /** Embossed caption, e.g. "RASPA AQUÍ". */
  label?: string;
  /** Tiny sparkle pattern. */
  pattern?: boolean;
  seed?: number;
}

const star4 = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
};

let noiseTile: HTMLCanvasElement | null = null;
const getNoiseTile = () => {
  if (noiseTile) return noiseTile;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(96, 96);
  const rand = seededRandom(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
};

/** Paints the static foil into a new canvas of w×h CSS px at `dpr`. */
export const paintFoilBase = (w: number, h: number, dpr: number, opts: FoilPaintOptions): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const { palette: p } = opts;
  const rand = seededRandom(opts.seed ?? 7);

  if (opts.flat) {
    ctx.fillStyle = p.flat;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Anisotropic banding: alternating light/dark stops along a diagonal.
    const g = ctx.createLinearGradient(0, 0, w, h * 0.9);
    g.addColorStop(0, p.shadow);
    g.addColorStop(0.16, p.base);
    g.addColorStop(0.3, p.light);
    g.addColorStop(0.38, p.glint);
    g.addColorStop(0.46, p.base);
    g.addColorStop(0.6, p.shadow);
    g.addColorStop(0.74, p.light);
    g.addColorStop(0.86, p.base);
    g.addColorStop(1, p.shadow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Brushed lines (slightly slanted), light and dark.
    ctx.lineCap = 'round';
    const lines = Math.round(h * 1.4);
    for (let i = 0; i < lines; i++) {
      const y = rand() * h;
      const x0 = rand() * w * 0.6 - w * 0.2;
      const len = w * (0.3 + rand() * 0.9);
      ctx.strokeStyle = rand() > 0.5 ? `rgba(255,255,255,${0.03 + rand() * 0.07})` : `rgba(0,0,0,${0.02 + rand() * 0.05})`;
      ctx.lineWidth = 0.4 + rand() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y - len * 0.06);
      ctx.stroke();
    }

    // Grain.
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(getNoiseTile(), 'repeat')!;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (opts.holo) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.globalCompositeOperation = 'overlay';
    const hg = ctx.createLinearGradient(0, h, w, 0);
    p.holo.forEach((c2, i) => hg.addColorStop(i / Math.max(1, p.holo.length - 1), c2));
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (opts.pattern) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    const step = 22;
    for (let y = step / 2; y < h; y += step) {
      for (let x = ((y / step) % 2 ? step / 2 : 0) + step / 4; x < w; x += step) {
        star4(ctx, x, y, 2.2);
      }
    }
    ctx.restore();
  }

  if (opts.label) {
    const size = Math.max(11, Math.min(18, w * 0.055));
    ctx.save();
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = opts.label.split('').join(' ');
    // Engraved: dark below, light above.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    // Upper part of the window, so it also reads while peeking from the pocket.
    const y = h * 0.36;
    ctx.fillText(text, w / 2, y + 1);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(text, w / 2, y - 0.5);
    ctx.restore();
  }

  return c;
};

/** Soft round brush sprite (alpha 1 in the core, feathered edge). */
export const makeBrush = (radius: number, dpr: number) => {
  const size = Math.ceil(radius * 2 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
};

export const capDpr = () => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

export interface FoilViewOptions extends FoilPaintOptions {
  width: number;
  height: number;
  /** Corner radius of the foil window (CSS px). */
  radius?: number;
}

/**
 * The live foil on a canvas: base + specular (follows `setTilt`) + sweep +
 * holo shift, minus an optional scratch mask. Redraws only when dirty; the
 * sweep runs its own short rAF loop.
 */
export class FoilView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly dpr: number;
  readonly w: number;
  readonly h: number;
  protected base: HTMLCanvasElement;
  protected opts: FoilViewOptions;
  mask: HTMLCanvasElement | null = null;
  private tilt = { x: 0, y: 0 };
  private tiltTarget = { x: 0, y: 0 };
  private sweepStart = -1;
  private sweepMs = 1200;
  private raf = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, opts: FoilViewOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.dpr = capDpr();
    this.w = opts.width;
    this.h = opts.height;
    canvas.width = Math.round(this.w * this.dpr);
    canvas.height = Math.round(this.h * this.dpr);
    this.ctx = canvas.getContext('2d')!;
    this.base = paintFoilBase(this.w, this.h, this.dpr, opts);
    this.draw();
  }

  /** -1..1 on both axes (finger position over the foil or device tilt). */
  setTilt(x: number, y: number) {
    this.tiltTarget = { x, y };
    this.kick();
  }

  sweep(ms: number) {
    if (this.destroyed) return;
    this.sweepMs = ms;
    this.sweepStart = performance.now();
    this.kick();
  }

  get sweeping() {
    return this.sweepStart >= 0;
  }

  protected kick() {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.destroyed) return;
    const t = this.tilt;
    t.x += (this.tiltTarget.x - t.x) * 0.18;
    t.y += (this.tiltTarget.y - t.y) * 0.18;
    const settling = Math.abs(this.tiltTarget.x - t.x) > 0.002 || Math.abs(this.tiltTarget.y - t.y) > 0.002;
    if (this.sweepStart >= 0 && now - this.sweepStart > this.sweepMs) this.sweepStart = -1;
    this.draw(now);
    if (settling || this.sweepStart >= 0) this.kick();
  };

  draw(now = performance.now()) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!this.opts.flat) {
      // Specular: a soft hotspot that moves opposite the tilt.
      const sx = w * (0.5 - this.tilt.x * 0.55);
      const sy = h * (0.35 - this.tilt.y * 0.5);
      const r = Math.max(w, h) * 0.75;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.42)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      if (this.opts.holo) {
        // Hue shift on tilt: slide a rainbow band across.
        const off = (this.tilt.x + this.tilt.y) * w * 0.6;
        const hg = ctx.createLinearGradient(-w + off, h, w * 2 + off, 0);
        const hues = this.opts.palette.holo;
        [...hues, ...hues].forEach((c, i, all) => hg.addColorStop(i / (all.length - 1), c));
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = hg;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }

    if (this.sweepStart >= 0) {
      const p = Math.min(1, (now - this.sweepStart) / this.sweepMs);
      const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const band = w * 0.45;
      const x = -band + (w + band * 2) * eased;
      const g = ctx.createLinearGradient(x - band, 0, x + band * 0.4, h * 0.35);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.56, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.mask) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.mask, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
