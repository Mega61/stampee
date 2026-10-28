// The printed scratch ticket (paper, perforation, header, prize window,
// stub with the business mark). Presentational; the foil canvas and the
// prize are passed in. Same markup inline (peeking from the pocket) and in
// the overlay, so the shared-element move is seamless.
import React from 'react';
import { Lock } from 'lucide-react';
import { mixHexColors } from '../../../lib/color';
import { ensureContrast } from '../../../lib/card/colorMath';
import { withAlpha } from '../../../lib/card/gridFx';
import type { FxTheme } from '../../../lib/card/types';
import type { Template } from '../../../types';

const isHex = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const mix = (a: string, b: string, w: number) => (isHex(a) && isHex(b) ? mixHexColors(a, b, w) : a);

export interface TicketColors {
  paper: string;
  paperEdge: string;
  window: string;
  ink: string;
  muted: string;
  accentInk: string;
  back: string;
}

export const ticketColors = (theme: FxTheme, matte = false): TicketColors => {
  // Always a bright stock, tinted by the accent, so it pops on any card.
  const tint = matte ? mix(theme.accent, '#9ca3af', 0.75) : theme.accent;
  const paper = mix(tint, '#ffffff', matte ? 0.8 : 0.9);
  const ink = ensureContrast(mix(tint, '#111111', 0.62), paper, 7);
  return {
    paper,
    paperEdge: mix(paper, '#000000', 0.08),
    window: mix(paper, tint, 0.14),
    ink,
    muted: withAlpha(ink, 0.62),
    accentInk: ensureContrast(theme.accent, paper, 3.2),
    back: mix(tint, '#ffffff', 0.78),
  };
};

/** Ticket proportions from its width. */
export const ticketMetrics = (width: number) => {
  const pad = Math.round(width * 0.056);
  const windowW = width - pad * 2;
  const windowH = Math.round(windowW * 0.7);
  const header = Math.round(width * 0.2);
  const message = Math.round(width * 0.19);
  const stub = Math.round(width * 0.17);
  const height = header + windowH + message + stub;
  return { width, height, pad, windowW, windowH, header, message, stub, perforationY: height - stub, notch: Math.round(width * 0.03) };
};

export type TicketMetrics = ReturnType<typeof ticketMetrics>;

const ticketMask = (m: TicketMetrics) => {
  const y = m.perforationY;
  const r = m.notch;
  // Side notches at the perforation + a scalloped top edge.
  const left = `radial-gradient(circle at 0 ${y}px, transparent ${r}px, #000 ${r + 0.5}px)`;
  const right = `radial-gradient(circle at 100% ${y}px, transparent ${r}px, #000 ${r + 0.5}px)`;
  const top = `radial-gradient(circle at 5px -1px, transparent 3.2px, #000 3.7px) 0 0 / 10px 100% repeat-x`;
  return `${left}, ${right}, ${top}`;
};

export interface TicketFaceProps {
  theme: FxTheme;
  template: Template;
  metrics: TicketMetrics;
  week: number;
  serial: string;
  matte?: boolean;
  /** Prize window content (prize + foil canvas). */
  window?: React.ReactNode;
  /** Message area under the window. */
  message?: React.ReactNode;
  /** Clip to the top / bottom half (fold). */
  half?: 'top' | 'bottom';
  /** Drop shadow strength 0..1 (outside the mask). */
  shadow?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const TicketFace: React.FC<TicketFaceProps> = ({
  theme, template, metrics: m, week, serial, matte, window: windowContent, message, half, shadow = 0, className, style,
}) => {
  const c = ticketColors(theme, matte);
  const mask = ticketMask(m);
  const Icon = template.icon;
  const clip = half === 'top' ? `inset(0 0 ${m.height / 2}px 0)` : half === 'bottom' ? `inset(${m.height / 2}px 0 0 0)` : undefined;
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: m.width,
        height: m.height,
        clipPath: clip,
        ...style,
      }}
    >
      {shadow > 0 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: '5% 5% -3%',
            borderRadius: Math.round(m.width * 0.08),
            backgroundColor: withAlpha('#000000', 0.42 * shadow),
            filter: `blur(${Math.round(m.width * 0.05)}px)`,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: Math.round(m.width * 0.06),
          backgroundColor: c.paper,
          backgroundImage: `radial-gradient(120% 70% at 50% 0%, ${withAlpha('#ffffff', 0.55)} 0%, transparent 60%), linear-gradient(180deg, transparent 70%, ${withAlpha(c.paperEdge, 0.6)} 100%)`,
          WebkitMask: mask,
          mask,
          WebkitMaskComposite: 'source-in',
          maskComposite: 'intersect',
          color: c.ink,
          overflow: 'hidden',
          boxShadow: `inset 0 0 0 1px ${withAlpha(c.ink, 0.07)}`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ height: m.header, padding: `${m.pad * 0.9}px ${m.pad}px 0` }}>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-bold uppercase" style={{ color: c.accentInk, fontSize: Math.round(m.width * 0.034), letterSpacing: '0.22em' }}>
              {matte ? <Lock size={Math.round(m.width * 0.036)} strokeWidth={2.6} /> : <TicketGlyph size={Math.round(m.width * 0.042)} />}
              Raspa y gana
            </div>
            <div className="truncate font-semibold leading-tight" style={{ fontSize: Math.round(m.width * 0.054), marginTop: 2 }}>
              {matte ? 'Actívalo con tu visita' : 'Tu premio de la semana'}
            </div>
          </div>
          <div
            className="shrink-0 rounded-full font-semibold tabular-nums"
            style={{
              fontSize: Math.round(m.width * 0.032),
              padding: '3px 9px',
              color: c.accentInk,
              backgroundColor: withAlpha(c.accentInk, 0.1),
              boxShadow: `inset 0 0 0 1px ${withAlpha(c.accentInk, 0.18)}`,
            }}
          >
            Semana {week}
          </div>
        </div>

        {/* Prize window */}
        <div
          className="relative overflow-hidden"
          style={{
            margin: `0 ${m.pad}px`,
            width: m.windowW,
            height: m.windowH,
            borderRadius: Math.round(m.width * 0.045),
            backgroundColor: c.window,
            backgroundImage: `repeating-conic-gradient(from 0deg at 50% 50%, ${withAlpha(c.accentInk, 0.05)} 0deg 6deg, transparent 6deg 18deg)`,
            boxShadow: `inset 0 2px 6px ${withAlpha('#000000', 0.16)}, inset 0 0 0 1px ${withAlpha(c.ink, 0.08)}`,
          }}
        >
          {matte ? (
            <div
              className="absolute inset-0 flex flex-col items-center gap-1.5"
              style={{
                paddingTop: m.windowH * 0.12,
                color: c.muted,
                backgroundColor: mix(c.window, '#9ca3af', 0.3),
                backgroundImage: `repeating-linear-gradient(135deg, ${withAlpha(c.ink, 0.04)} 0 2px, transparent 2px 8px)`,
              }}
            >
              <span className="flex items-center justify-center rounded-full" style={{ width: m.width * 0.13, height: m.width * 0.13, backgroundColor: withAlpha(c.ink, 0.08) }}>
                <Lock size={Math.round(m.width * 0.065)} strokeWidth={2} />
              </span>
              <span className="font-semibold uppercase" style={{ fontSize: Math.round(m.width * 0.03), letterSpacing: '0.18em' }}>Bloqueado</span>
            </div>
          ) : (
            windowContent
          )}
        </div>

        {/* Message */}
        <div
          className="flex items-center justify-center text-center"
          style={{ height: m.message, padding: `0 ${m.pad * 1.2}px`, fontSize: Math.round(m.width * 0.044), lineHeight: 1.3 }}
        >
          {message}
        </div>

        {/* Perforation */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: m.notch + 4,
            right: m.notch + 4,
            top: m.perforationY - 1,
            borderTop: `2px dashed ${withAlpha(c.ink, 0.18)}`,
          }}
        />

        {/* Stub */}
        <div
          className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3"
          style={{ height: m.stub, padding: `0 ${m.pad}px` }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex shrink-0 items-center justify-center overflow-hidden rounded-full"
              style={{ width: m.stub * 0.52, height: m.stub * 0.52, backgroundColor: withAlpha(c.ink, 0.07), color: c.accentInk }}
            >
              {template.logoImage ? (
                <img src={template.logoImage} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <Icon size={Math.round(m.stub * 0.28)} />
              )}
            </div>
            <span className="truncate font-semibold" style={{ fontSize: Math.round(m.width * 0.038) }}>{template.name}</span>
          </div>
          <span className="shrink-0 font-mono tabular-nums" style={{ fontSize: Math.round(m.width * 0.032), color: c.muted }}>
            N.º {serial}
          </span>
        </div>

        {/* Embossed watermark */}
        <div
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center"
          style={{ left: '50%', top: m.perforationY + m.stub / 2, width: m.stub * 1.5, height: m.stub * 1.5, marginLeft: -m.stub * 0.75, marginTop: -m.stub * 0.75, opacity: 0.05, color: c.ink }}
        >
          {template.logoImage ? (
            <img src={template.logoImage} alt="" className="h-full w-full rounded-full object-cover" style={{ filter: 'grayscale(1) contrast(1.4)', mixBlendMode: 'multiply' }} draggable={false} />
          ) : (
            <Icon size={Math.round(m.stub * 1.1)} />
          )}
        </div>
      </div>
    </div>
  );
};

/** Back of the ticket (seen while folding). */
export const TicketBack: React.FC<{ theme: FxTheme; template: Template; metrics: TicketMetrics; style?: React.CSSProperties }> = ({ theme, template, metrics: m, style }) => {
  const c = ticketColors(theme);
  const Icon = template.icon;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: Math.round(m.width * 0.06),
        backgroundColor: c.back,
        backgroundImage: `repeating-linear-gradient(135deg, ${withAlpha(c.ink, 0.045)} 0 2px, transparent 2px 9px)`,
        color: withAlpha(c.ink, 0.35),
        ...style,
      }}
      className="flex items-center justify-center"
    >
      <Icon size={Math.round(m.width * 0.16)} />
    </div>
  );
};

export const TicketGlyph: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />
    <path d="M13 6v2M13 11v2M13 16v2" />
  </svg>
);
