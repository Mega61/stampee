// The landing's gold confetti (golden-beauty-studio-landing,
// src/app/[lang]/_components/season/confetti.ts → goldBurst), so the card's
// last door and snowman match the website's easter egg.
//
// Makes its own fixed canvas and removes it after ~2.2 s: nothing runs while
// nobody taps. The caller checks prefers-reduced-motion.

const PALETTE = ['#ac8231', '#e7aa51', '#ffd49f', '#fff1d6', '#8b6a1f'];
const DURATION_MS = 2200;

export function goldBurst(originX: number, originY: number, zIndex = 130) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: String(zIndex),
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const pieces = Array.from({ length: 90 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 380 + Math.random() * 520;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 14,
      flip: Math.random() * Math.PI,
      w: 4 + Math.random() * 5,
      h: 6 + Math.random() * 8,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]!,
      round: Math.random() < 0.3,
    };
  });

  const t0 = performance.now();
  let last = t0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const life = (now - t0) / DURATION_MS;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = life > 0.7 ? Math.max(0, 1 - (life - 0.7) / 0.3) : 1;
    for (const p of pieces) {
      p.vy += 900 * dt; // gravity
      p.vx *= 1 - 1.6 * dt; // air
      p.vy *= 1 - 0.9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.flip += 9 * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (life < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
