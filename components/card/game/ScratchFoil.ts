// The scratch engine shared by the weekly ticket and the reward reveal.
// A FoilView whose canvas takes pointer input: a soft brush paints a mask
// (subtracted from the foil), flakes fall from the finger, grain haptics
// tick, the cleared share is sampled on a downscaled copy every 250 ms, and
// at the threshold the rest of the foil shatters into shards.
import { haptic } from '../../../lib/card/haptics';
import {
  clearedFraction,
  pointsAlong,
  sampleSize,
  shardTriangles,
  triangleCentroid,
  type Point,
} from '../../../lib/card/scratch';
import { FoilView, makeBrush, type FoilViewOptions } from './foil';
import type { FlakeField } from './flakes';

export interface ScratchOptions extends FoilViewOptions {
  brushPx: number;
  grainPx: number;
  autoCompletePct: number;
  flakesPer100px: number;
  shardCols: number;
  shardSpeed: number;
  shatterMs: number;
  flakeSpin: number;
  /** No flakes / shards: the foil fades instead. */
  reduced: boolean;
  field: FlakeField | null;
  onFirstScratch?: () => void;
  onProgress?: (cleared: number) => void;
  /** Fired once, when the threshold is crossed or `complete()` is called. */
  onComplete?: () => void;
}

const SAMPLE_EVERY_MS = 250;

export class ScratchFoil extends FoilView {
  private sopts: ScratchOptions;
  private maskCtx: CanvasRenderingContext2D;
  private brush: HTMLCanvasElement;
  private sample: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;
  private queue: Array<[Point, Point]> = [];
  private last: Point | null = null;
  private pointerId: number | null = null;
  private grainAcc = 0;
  private flakeAcc = 0;
  private lastSample = 0;
  private inputRaf = 0;
  private started = false;
  armed = false;
  done = false;
  /** Last finger position in client px (shatter origin). */
  lastClient: Point | null = null;

  constructor(canvas: HTMLCanvasElement, opts: ScratchOptions) {
    super(canvas, opts);
    this.sopts = opts;
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    this.mask = mask;
    this.maskCtx = mask.getContext('2d')!;
    this.brush = makeBrush(opts.brushPx / 2, this.dpr);
    const s = sampleSize(this.w, this.h, 48);
    this.sample = document.createElement('canvas');
    this.sample.width = s.width;
    this.sample.height = s.height;
    this.sampleCtx = this.sample.getContext('2d', { willReadFrequently: true })!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('lostpointercapture', this.onUp);
  }

  private local(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    // The canvas may be CSS-scaled (open animation); map back to its own px.
    return { x: ((e.clientX - r.left) / r.width) * this.w, y: ((e.clientY - r.top) / r.height) * this.h };
  }

  private onDown = (e: PointerEvent) => {
    if (!this.armed || this.done) return;
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events in tests can't be captured.
    }
    const p = this.local(e);
    this.last = p;
    this.lastClient = { x: e.clientX, y: e.clientY };
    this.queue.push([p, p]);
    this.tiltTo(p);
    this.scheduleInput();
    if (!this.started) {
      this.started = true;
      this.sopts.onFirstScratch?.();
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId || !this.last || this.done) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const p = this.local(ev);
      this.queue.push([this.last, p]);
      this.last = p;
    }
    this.lastClient = { x: e.clientX, y: e.clientY };
    this.tiltTo(this.last);
    this.scheduleInput();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.last = null;
    this.setTilt(0, 0);
    this.measure(true);
  };

  private tiltTo(p: Point) {
    this.setTilt((p.x / this.w) * 2 - 1, (p.y / this.h) * 2 - 1);
  }

  private scheduleInput() {
    if (!this.inputRaf) this.inputRaf = requestAnimationFrame(this.processInput);
  }

  private processInput = (now: number) => {
    this.inputRaf = 0;
    if (this.done) return;
    const { maskCtx, brush, dpr } = this;
    const r = this.sopts.brushPx / 2;
    const rect = this.canvas.getBoundingClientRect();
    const kx = rect.width / this.w;
    const ky = rect.height / this.h;
    for (const [a, b] of this.queue) {
      const pts = a === b ? [b] : pointsAlong(a, b, r * 0.3);
      for (const p of pts) maskCtx.drawImage(brush, (p.x - r) * dpr, (p.y - r) * dpr);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      // Grain haptics: a tiny tick every ~40 px of scratching.
      this.grainAcc += dist;
      if (this.grainAcc >= this.sopts.grainPx) {
        this.grainAcc %= this.sopts.grainPx;
        haptic(3);
      }
      // Flakes shaved off along the path, flicked in the stroke direction.
      const field = this.sopts.field;
      if (field && !this.sopts.reduced && this.sopts.flakesPer100px > 0 && dist > 0) {
        this.flakeAcc += (dist * this.sopts.flakesPer100px) / 100;
        const dx = (b.x - a.x) / dist;
        const dy = (b.y - a.y) / dist;
        const colors = this.opts.palette.flakes;
        while (this.flakeAcc >= 1) {
          this.flakeAcc -= 1;
          const t = Math.random();
          const px = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * r;
          const py = a.y + (b.y - a.y) * t + (Math.random() - 0.5) * r;
          field.emit(
            rect.left + px * kx,
            rect.top + py * ky,
            dx * (60 + Math.random() * 120) + (Math.random() - 0.5) * 90,
            dy * (40 + Math.random() * 80) - 60 - Math.random() * 120,
            colors[Math.floor(Math.random() * colors.length)]!,
          );
        }
      }
    }
    this.queue = [];
    this.draw();
    if (now - this.lastSample >= SAMPLE_EVERY_MS) this.measure(false);
  };

  /** Cleared share on a downscaled copy of the mask. */
  measure(force: boolean) {
    if (this.done) return 0;
    const now = performance.now();
    if (!force && now - this.lastSample < SAMPLE_EVERY_MS) return 0;
    this.lastSample = now;
    const { sampleCtx, sample } = this;
    sampleCtx.clearRect(0, 0, sample.width, sample.height);
    sampleCtx.drawImage(this.mask!, 0, 0, sample.width, sample.height);
    const cleared = clearedFraction(sampleCtx.getImageData(0, 0, sample.width, sample.height).data, 128);
    this.sopts.onProgress?.(cleared);
    if (cleared >= this.sopts.autoCompletePct) this.complete(this.lastClient);
    return cleared;
  }

  /**
   * Clears the rest of the foil: shards burst from `origin` (client px;
   * defaults to the center) and fall away, or a fade for reduced motion.
   */
  complete(origin: Point | null = null) {
    if (this.done) return;
    this.done = true;
    this.armed = false;
    cancelAnimationFrame(this.inputRaf);
    const rect = this.canvas.getBoundingClientRect();
    const o = origin ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.6 };
    const field = this.sopts.field;
    const cols = this.sopts.shardCols;
    if (field && !this.sopts.reduced && cols > 0) this.shatter(rect, o, field, cols);
    else this.canvas.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: this.sopts.shatterMs, easing: 'ease-out', fill: 'forwards' });
    if (field && !this.sopts.reduced && cols > 0) this.canvas.style.opacity = '0';
    this.sopts.onComplete?.();
  }

  private shatter(rect: DOMRect, origin: Point, field: FlakeField, cols: number) {
    const { dpr } = this;
    const kx = rect.width / this.w;
    const ky = rect.height / this.h;
    const rows = Math.max(2, Math.round((cols * this.h) / this.w));
    const tris = shardTriangles(this.w, this.h, cols, rows, 11);
    // Which parts still have foil: read the mask at a coarse resolution.
    const s = this.sample;
    this.sampleCtx.clearRect(0, 0, s.width, s.height);
    this.sampleCtx.drawImage(this.mask!, 0, 0, s.width, s.height);
    const data = this.sampleCtx.getImageData(0, 0, s.width, s.height).data;
    const clearedAt = (p: Point) => {
      const x = Math.min(s.width - 1, Math.max(0, Math.floor((p.x / this.w) * s.width)));
      const y = Math.min(s.height - 1, Math.max(0, Math.floor((p.y / this.h) * s.height)));
      return data[(y * s.width + x) * 4 + 3]! > 200;
    };
    const speed = this.sopts.shardSpeed;
    for (const tri of tris) {
      const c = triangleCentroid(tri);
      if (clearedAt(c)) continue;
      const xs = tri.map((p) => p.x);
      const ys = tri.map((p) => p.y);
      const minX = Math.floor(Math.min(...xs));
      const minY = Math.floor(Math.min(...ys));
      const bw = Math.ceil(Math.max(...xs)) - minX + 1;
      const bh = Math.ceil(Math.max(...ys)) - minY + 1;
      const img = document.createElement('canvas');
      img.width = Math.max(1, Math.round(bw * dpr * kx));
      img.height = Math.max(1, Math.round(bh * dpr * ky));
      const ictx = img.getContext('2d')!;
      ictx.scale(dpr * kx, dpr * ky);
      ictx.beginPath();
      ictx.moveTo(tri[0].x - minX, tri[0].y - minY);
      ictx.lineTo(tri[1].x - minX, tri[1].y - minY);
      ictx.lineTo(tri[2].x - minX, tri[2].y - minY);
      ictx.closePath();
      ictx.clip();
      ictx.drawImage(this.canvas, minX * dpr, minY * dpr, bw * dpr, bh * dpr, 0, 0, bw, bh);
      // A bright edge so each shard catches the light.
      ictx.strokeStyle = 'rgba(255,255,255,0.55)';
      ictx.lineWidth = 0.8;
      ictx.stroke();

      const cx = rect.left + c.x * kx;
      const cy = rect.top + c.y * ky;
      const dx = cx - origin.x;
      const dy = cy - origin.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = speed * (0.55 + Math.random() * 0.7) * (0.6 + Math.min(1, 120 / d) * 0.6);
      field.shard(
        img,
        (minX - c.x) * kx,
        (minY - c.y) * ky,
        cx,
        cy,
        (dx / d) * v,
        (dy / d) * v - speed * 0.55,
        this.sopts.shatterMs + 450 + Math.random() * 250,
        this.sopts.flakeSpin,
      );
    }
  }

  destroy() {
    super.destroy();
    cancelAnimationFrame(this.inputRaf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('lostpointercapture', this.onUp);
  }
}
