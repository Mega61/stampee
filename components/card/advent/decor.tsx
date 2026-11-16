// Christmas dressing from the approved prototype: string lights, pine sprig,
// the wine bows. Pure SVG, so they stay as the base layer when a 3D asset is
// missing.
import React from 'react';

const BULBS: Array<{ x: number; y: number; fill: string; glow: string }> = [
  { x: 17.2, y: 7.4, fill: '#f6d798', glow: '#f6d798' },
  { x: 56.1, y: 14.7, fill: '#9c3a33', glow: '#d4574b' },
  { x: 95.0, y: 19.9, fill: '#fff1cf', glow: '#f6d798' },
  { x: 133.9, y: 23.0, fill: '#e7aa51', glow: '#f6d798' },
  { x: 172.8, y: 24.0, fill: '#9c3a33', glow: '#d4574b' },
  { x: 211.7, y: 23.0, fill: '#f6d798', glow: '#f6d798' },
  { x: 250.6, y: 19.9, fill: '#fff1cf', glow: '#f6d798' },
  { x: 289.5, y: 14.7, fill: '#9c3a33', glow: '#d4574b' },
  { x: 328.4, y: 7.4, fill: '#e7aa51', glow: '#f6d798' },
];

export const StringLights: React.FC = () => (
  <svg className="adv-lights" viewBox="0 0 350 34" preserveAspectRatio="none" aria-hidden>
    <path d="M-4 3 Q175 48 354 3" fill="none" stroke="#3a2a1d" strokeWidth="1.3" />
    {BULBS.map((b, i) => (
      <g key={i} className="bulb" style={{ animationDelay: `${(i * 0.37).toFixed(2)}s` }}>
        <rect x={b.x} y={b.y} width="4.4" height="3.5" rx="1" fill="#3a2a1d" />
        <ellipse cx={b.x + 2.2} cy={b.y + 8} rx="3.6" ry="5.4" fill={b.fill} style={{ filter: `drop-shadow(0 1px 4px ${b.glow})` }} />
      </g>
    ))}
  </svg>
);

// Needles along the branch: [x, y, tip1x, tip1y, tip2x, tip2y], alternating greens.
const NEEDLES: number[][] = [
  [4.0, 50.0, 5.6, 40.2, 12.7, 45.0], [10.3, 46.0, 11.9, 35.7, 19.4, 40.7], [16.6, 42.0, 18.3, 31.2, 26.1, 36.5],
  [22.9, 38.1, 24.7, 26.9, 32.8, 32.4], [29.2, 34.4, 31.1, 22.7, 39.5, 28.5], [35.5, 30.9, 37.5, 18.8, 46.2, 24.7],
  [41.8, 27.6, 43.8, 15.0, 52.9, 21.2], [48.2, 24.5, 50.1, 11.9, 59.2, 18.1], [54.5, 21.6, 56.4, 9.5, 65.1, 15.5],
  [60.8, 19.0, 62.6, 7.3, 71.0, 13.1], [67.1, 16.6, 68.9, 5.4, 76.9, 10.9], [73.4, 14.3, 75.1, 3.5, 82.8, 8.8],
  [79.7, 12.1, 81.3, 1.8, 88.8, 6.9], [86.0, 10.0, 87.6, 0.2, 94.7, 5.0],
];

export const Sprig: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`adv-sprig ${className ?? ''}`} viewBox="0 0 92 56" aria-hidden>
    <g fill="none" strokeLinecap="round">
      <path d="M4 50C26 40 48 30 86 10" stroke="#3a2a1d" strokeWidth="2.2" />
      {NEEDLES.map(([x, y, ax, ay, bx, by], i) => {
        const color = i % 2 ? '#2f4a3a' : '#4f7259';
        return (
          <React.Fragment key={i}>
            <path d={`M${x} ${y}L${ax} ${ay}`} stroke={color} strokeWidth="2.4" />
            <path d={`M${x} ${y}L${bx} ${by}`} stroke={color} strokeWidth="2.4" />
          </React.Fragment>
        );
      })}
    </g>
    <g>
      <circle cx="30" cy="40" r="4.2" fill="#9c3a33" />
      <circle cx="37" cy="44" r="3.6" fill="#7b2a26" />
      <circle cx="36" cy="36" r="3.3" fill="#b5493f" />
      <circle cx="29" cy="39" r="1.1" fill="#f6d798" opacity=".8" />
      <circle cx="35" cy="35" r=".9" fill="#f6d798" opacity=".8" />
      <circle cx="70" cy="18" r="5" fill="#e7aa51" />
      <circle cx="68.5" cy="16.5" r="1.4" fill="#fff1cf" />
      <path d="M70 13v-4" stroke="#ac8231" strokeWidth="1.6" />
    </g>
  </svg>
);

/** The bow on the wrapped last door. */
export const Bow24: React.FC = () => (
  <svg className="bow24" viewBox="0 0 64 40" aria-hidden>
    <path d="M32 22C22 4 6 2 4 12s14 13 28 10z" fill="#9c3a33" stroke="#e7c27a" strokeWidth="1.4" />
    <path d="M32 22c10-18 26-20 28-10s-14 13-28 10z" fill="#9c3a33" stroke="#e7c27a" strokeWidth="1.4" />
    <circle cx="32" cy="21" r="5" fill="#b5493f" stroke="#e7c27a" strokeWidth="1.4" />
  </svg>
);

/** The small bow on the gift card's ribbon. */
export const CardBow: React.FC = () => (
  <svg className="bow" viewBox="0 0 44 28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 14C16 4 6 2 4 8s8 9 18 6z" fill="#9c3a33" />
    <path d="M22 14c6-10 16-12 18-6s-8 9-18 6z" fill="#9c3a33" />
    <path d="M22 14l-7 12M22 14l7 12" />
    <circle cx="22" cy="14" r="3" fill="currentColor" />
  </svg>
);

/** Filled five-point star (the seal on the last door). */
export const StarIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
  </svg>
);
