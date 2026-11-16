// Pan de oro: the landing's falling gold leaf (golden-beauty-studio-landing,
// src/app/[lang]/_components/season/GoldLeaf.tsx), ported to a plain canvas
// engine so the card can drive it: an ambient fall on the back face and a
// burst when a door opens.
//
// Irregular leaves fall slowly, sway and turn over; facing the light they
// flash pale gold. The loop only runs while something is falling, the canvas
// is on screen and the tab is visible. Callers don't start it under
// prefers-reduced-motion. Fewer leaves on phones.

const COLORS = {
  dark: [139, 106, 31],
  gold: [172, 130, 49],
  bright: [231, 170, 81],
  pale: [255, 241, 214],
} as const;

interface Leaf {
  x: number;
  y: number;
  size: number;
  vy: number;
  swayAmp: number;
  swayFreq: number;
  phase: number;
  rot: number;
  vrot: number;
  flip: number;
  vflip: number;
  alpha: number;
  shape: [number, number, number, number];
  /** Burst leaves: outward velocity (px/s) that bleeds off into the fall, and a fade. */
  bx: number;
  by: number;
  life: number;
  fade: number;
}

const lerp = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));

const makeLeaf = (w: number, h: number, anywhere: boolean): Leaf => {
  const size = 4 + Math.random() * 7;
  return {
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : -20 - Math.random() * 60,
    size,
    // Bigger leaves fall a little faster: depth without blur.
    vy: 10 + size * 1.6 + Math.random() * 6,
    swayAmp: 10 + Math.random() * 26,
    swayFreq: 0.25 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.9,
    flip: Math.random() * Math.PI * 2,
    vflip: 1.2 + Math.random() * 1.8,
    alpha: 0.45 + Math.random() * 0.45,
    shape: [0.75 + Math.random() * 0.5, 0.55 + Math.random() * 0.45, 0.75 + Math.random() * 0.5, 0.55 + Math.random() * 0.45],
    bx: 0,
    by: 0,
    life: 1,
    fade: 0,
  };
};

export interface GoldLeafHandle {
  /** Leaves burst from a viewport point, then flutter down and fade. */
  burst: (clientX: number, clientY: number, count?: number) => void;
  /** The slow ambient fall (back face visible). */
  setAmbient: (on: boolean) => void;
  destroy: () => void;
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const createGoldLeaf = (canvas: HTMLCanvasElement): GoldLeafHandle | null => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const ambient: Leaf[] = [];
  let bursts: Leaf[] = [];
  let ambientOn = false;
  let w = 0;
  let h = 0;
  let raf = 0;
  let last = 0;
  let onScreen = true;
  let disposed = false;

  const target = () => (w < 768 ? 16 : 34);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = (f: Leaf, t: number) => {
    const sway = Math.sin(t * f.swayFreq + f.phase) * f.swayAmp;
    // cos of the turn = how much of the face looks at the camera.
    const face = Math.cos(f.flip);
    const glint = Math.pow(Math.abs(face), 6);
    const base = face > 0 ? lerp(COLORS.gold, COLORS.bright, 0.5) : COLORS.dark;
    const [r, g, b] = lerp(base, COLORS.pale, glint * 0.85);
    ctx.save();
    ctx.translate(f.x + sway, f.y);
    ctx.rotate(f.rot);
    ctx.scale(1, Math.max(0.12, Math.abs(face)));
    ctx.globalAlpha = f.alpha * f.life * (0.55 + 0.45 * Math.abs(face));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    const s = f.size;
    const [a, bb, c, d] = f.shape;
    ctx.beginPath();
    ctx.moveTo(s * a, 0);
    ctx.lineTo(0, s * bb * 0.8);
    ctx.lineTo(-s * c, 0);
    ctx.lineTo(0, -s * d * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const tick = (now: number) => {
    raf = 0;
    if (disposed || !onScreen || document.hidden) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    const t = now / 1000;
    ctx.clearRect(0, 0, w, h);

    if (ambientOn) {
      while (ambient.length < target()) ambient.push(makeLeaf(w, h, ambient.length === 0 ? false : true));
      for (let i = 0; i < ambient.length; i++) {
        const f = ambient[i]!;
        f.y += f.vy * dt;
        f.rot += f.vrot * dt;
        f.flip += f.vflip * dt;
        if (f.y > h + 24) ambient[i] = makeLeaf(w, h, false);
        draw(ambient[i]!, t);
      }
    }

    bursts = bursts.filter((f) => f.life > 0 && f.y < h + 30);
    for (const f of bursts) {
      // The kick bleeds off quickly (air), then the leaf falls like the others.
      const drag = Math.exp(-3.2 * dt);
      f.bx *= drag;
      f.by = f.by * drag + 60 * dt;
      f.x += f.bx * dt;
      f.y += (f.by + f.vy) * dt;
      f.rot += f.vrot * 3 * dt;
      f.flip += f.vflip * 2 * dt;
      f.life -= f.fade * dt;
      draw(f, t);
    }

    if (ambientOn || bursts.length) raf = requestAnimationFrame(tick);
    else last = 0;
  };

  const kick = () => {
    if (!raf && !disposed && onScreen && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => {
          onScreen = !!entry?.isIntersecting;
          if (onScreen) kick();
        })
      : null;
  io?.observe(canvas);
  const onVisibility = () => {
    if (!document.hidden) kick();
  };
  document.addEventListener('visibilitychange', onVisibility);
  resize();

  return {
    burst(clientX, clientY, count = 46) {
      const box = canvas.getBoundingClientRect();
      if (w !== box.width || h !== box.height) resize();
      const n = w < 768 ? Math.round(count * 0.7) : count;
      for (let i = 0; i < n; i++) {
        const leaf = makeLeaf(w, h, false);
        const angle = Math.random() * Math.PI * 2;
        const speed = 120 + Math.random() * 380;
        leaf.x = clientX - box.left;
        leaf.y = clientY - box.top;
        leaf.bx = Math.cos(angle) * speed;
        leaf.by = Math.sin(angle) * speed - 140;
        leaf.size *= 1.15;
        leaf.alpha = 0.7 + Math.random() * 0.3;
        leaf.fade = 0.22 + Math.random() * 0.2;
        bursts.push(leaf);
      }
      kick();
    },
    setAmbient(on) {
      ambientOn = on;
      if (!on) ambient.length = 0;
      kick();
    },
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      ctx.clearRect(0, 0, w, h);
    },
  };
};
