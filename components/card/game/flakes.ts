// One full-viewport canvas for everything that leaves the ticket: foil
// flakes while scratching (pooled), shatter shards, and the orb's sparkle
// trail. Runs a rAF loop only while something is alive.
import { capDpr } from './foil';

interface Flake {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  flip: number;
  vflip: number;
  color: string;
  age: number;
  life: number;
}

interface Shard {
  img: HTMLCanvasElement;
  /** Offset of the image's top-left from the shard's center (CSS px). */
  ox: number;
  oy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  flip: number;
  vflip: number;
  age: number;
  life: number;
}

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  age: number;
  life: number;
}

export class FlakeField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = capDpr();
  private pool: Flake[] = [];
  private shards: Shard[] = [];
  private sparkles: Sparkle[] = [];
  private raf = 0;
  private last = 0;
  gravity = 1500;
  maxFlakes = 60;

  constructor(parent: HTMLElement, zIndex = 2) {
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    Object.assign(c.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100dvh', pointerEvents: 'none', zIndex: String(zIndex),
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = () => {
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  };

  private kick() {
    if (!this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  flake(x: number, y: number, vx: number, vy: number, color: string) {
    if (this.maxFlakes <= 0) return;
    let f = this.pool.find((p) => !p.alive);
    if (!f) {
      if (this.pool.length >= this.maxFlakes) return;
      f = {} as Flake;
      this.pool.push(f);
    }
    Object.assign(f, {
      alive: true, x, y, vx, vy,
      w: 2 + Math.random() * 3.5, h: 1.4 + Math.random() * 2.2,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 2,
      flip: Math.random() * Math.PI * 2, vflip: 0,
      color, age: 0, life: 900 + Math.random() * 700,
    });
    return f;
  }

  /** Spin multiplier for flakes emitted after this call. */
  setSpin(spin: number) {
    this.spin = spin;
  }
  private spin = 9;

  shard(img: HTMLCanvasElement, ox: number, oy: number, x: number, y: number, vx: number, vy: number, life: number, spin: number) {
    this.shards.push({
      img, ox, oy, x, y, vx, vy,
      rot: 0, vr: (Math.random() - 0.5) * spin,
      flip: 0, vflip: (Math.random() - 0.5) * spin * 1.6,
      age: 0, life,
    });
    this.kick();
  }

  sparkle(x: number, y: number, color: string, size = 6, life = 520, vx = 0, vy = 0) {
    if (this.sparkles.length > 90) this.sparkles.shift();
    this.sparkles.push({ x, y, vx, vy, size, color, age: 0, life });
    this.kick();
  }

  /** Flakes kick() themselves through here so their spin is set. */
  emit(x: number, y: number, vx: number, vy: number, color: string) {
    const f = this.flake(x, y, vx, vy, color);
    if (f) {
      f.vr = (Math.random() - 0.5) * this.spin;
      f.vflip = (Math.random() * 0.6 + 0.4) * this.spin * (Math.random() > 0.5 ? 1 : -1);
    }
    this.kick();
  }

  get busy() {
    return this.shards.length > 0 || this.sparkles.length > 0 || this.pool.some((p) => p.alive);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const dt = Math.min(0.033, this.last ? (now - this.last) / 1000 : 1 / 60);
    this.last = now;
    const { ctx, dpr } = this;
    const H = window.innerHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let alive = false;

    for (const f of this.pool) {
      if (!f.alive) continue;
      f.age += dt * 1000;
      // Air drag keeps flakes fluttering rather than dropping like stones.
      f.vx *= 1 - 1.6 * dt;
      f.vy += this.gravity * 0.45 * dt;
      f.vy *= 1 - 1.2 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      f.flip += f.vflip * dt;
      if (f.age > f.life || f.y > H + 20) {
        f.alive = false;
        continue;
      }
      alive = true;
      const fade = Math.min(1, (f.life - f.age) / 250);
      const face = Math.cos(f.flip);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.scale(1, Math.max(0.12, Math.abs(face)));
      ctx.globalAlpha = fade;
      ctx.fillStyle = f.color;
      ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      // Glint when the flake faces the light.
      if (face > 0.75) {
        ctx.globalAlpha = fade * (face - 0.75) * 3;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      }
      ctx.restore();
    }

    this.shards = this.shards.filter((s) => {
      s.age += dt * 1000;
      s.vy += this.gravity * dt;
      s.vx *= 1 - 0.8 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
      s.flip += s.vflip * dt;
      if (s.age > s.life || s.y > H + 120) return false;
      alive = true;
      const p = s.age / s.life;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      const face = Math.cos(s.flip);
      ctx.scale(Math.max(0.08, Math.abs(face)), 1);
      ctx.globalAlpha = p > 0.65 ? Math.max(0, 1 - (p - 0.65) / 0.35) : 1;
      ctx.drawImage(s.img, s.ox, s.oy, s.img.width / dpr, s.img.height / dpr);
      if (face < 0) {
        // Back of the foil: a darker tint.
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(s.ox, s.oy, s.img.width / dpr, s.img.height / dpr);
      }
      ctx.restore();
      return true;
    });

    this.sparkles = this.sparkles.filter((s) => {
      s.age += dt * 1000;
      if (s.age > s.life) return false;
      alive = true;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const p = s.age / s.life;
      const scale = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
      const r = s.size * scale;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(p * 1.2);
      ctx.globalAlpha = Math.min(1, scale * 1.4);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.quadraticCurveTo(0, 0, 0, r);
      ctx.quadraticCurveTo(0, 0, -r, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.fill();
      ctx.globalAlpha *= 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    });

    if (alive) this.raf = requestAnimationFrame(this.frame);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }
}
