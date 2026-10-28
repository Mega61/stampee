// Split-flap digits for the "Próximo raspa y gana" countdown (§8.1a): the
// top leaf falls with the old digit, the bottom leaf lands with the new one.
// Transform-only (WAAPI); reduced motion swaps instantly.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { withAlpha } from '../../../lib/card/gridFx';

interface Colors {
  face: string;
  ink: string;
}

const FLIP_MS = 420;

const Half: React.FC<{ digit: string; part: 'top' | 'bottom'; colors: Colors; h: number; className?: string; style?: React.CSSProperties; innerRef?: React.Ref<HTMLSpanElement> }> = ({
  digit, part, colors, h, className, style, innerRef,
}) => (
  <span
    ref={innerRef}
    className={className}
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      height: h / 2,
      top: part === 'top' ? 0 : h / 2,
      overflow: 'hidden',
      backgroundColor: colors.face,
      borderRadius: part === 'top' ? '4px 4px 1px 1px' : '1px 1px 4px 4px',
      transformOrigin: part === 'top' ? '50% 100%' : '50% 0%',
      backfaceVisibility: 'hidden',
      ...style,
    }}
  >
    <span
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: part === 'top' ? 0 : -h / 2,
        height: h,
        lineHeight: `${h}px`,
        textAlign: 'center',
        color: colors.ink,
      }}
    >
      {digit}
    </span>
    {part === 'top' && (
      <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${withAlpha('#ffffff', 0.12)}, transparent)` }} />
    )}
  </span>
);

export const FlapDigit: React.FC<{ digit: string; colors: Colors; reduced: boolean; h?: number }> = ({ digit, colors, reduced, h = 24 }) => {
  const [shown, setShown] = useState(digit);
  const [prev, setPrev] = useState(digit);
  const topLeaf = useRef<HTMLSpanElement>(null);
  const bottomLeaf = useRef<HTMLSpanElement>(null);

  if (digit !== shown) {
    setPrev(shown);
    setShown(digit);
  }
  const flipping = prev !== shown && !reduced;

  useLayoutEffect(() => {
    if (!flipping) return;
    const a = topLeaf.current?.animate(
      [{ transform: 'perspective(120px) rotateX(0deg)' }, { transform: 'perspective(120px) rotateX(-90deg)' }],
      { duration: FLIP_MS / 2, easing: 'cubic-bezier(.55,0,.9,.4)', fill: 'forwards' },
    );
    const b = bottomLeaf.current?.animate(
      [{ transform: 'perspective(120px) rotateX(90deg)' }, { transform: 'perspective(120px) rotateX(-12deg)', offset: 0.75 }, { transform: 'perspective(120px) rotateX(0deg)' }],
      { duration: FLIP_MS / 2 + 80, delay: FLIP_MS / 2, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' },
    );
    const done = () => setPrev((p) => (p === shown ? p : shown));
    if (b) b.onfinish = done;
    else done();
    return () => {
      a?.cancel();
      b?.cancel();
    };
  }, [flipping, shown]);

  return (
    <span
      className="relative inline-block font-bold tabular-nums"
      style={{ width: Math.round(h * 0.72), height: h, fontSize: Math.round(h * 0.68), boxShadow: `0 1px 2px ${withAlpha('#000000', 0.25)}`, borderRadius: 4 }}
      aria-hidden
    >
      {/* Static: new top, old bottom (until the leaf lands). */}
      <Half digit={shown} part="top" colors={colors} h={h} />
      <Half digit={flipping ? prev : shown} part="bottom" colors={colors} h={h} />
      {flipping && (
        <>
          <Half digit={prev} part="top" colors={colors} h={h} innerRef={topLeaf} style={{ zIndex: 2 }} />
          <Half digit={shown} part="bottom" colors={colors} h={h} innerRef={bottomLeaf} style={{ zIndex: 2 }} />
        </>
      )}
      {/* Hinge line. */}
      <span style={{ position: 'absolute', left: 0, right: 0, top: h / 2 - 0.5, height: 1, backgroundColor: withAlpha('#000000', 0.35), zIndex: 3 }} />
    </span>
  );
};

export const FlapNumber: React.FC<{ value: number; width?: number; colors: Colors; reduced: boolean; h?: number }> = ({ value, width = 2, colors, reduced, h }) => {
  const digits = String(Math.max(0, Math.floor(value))).padStart(width, '0').split('');
  return (
    <span className="inline-flex gap-[2px]">
      {digits.map((d, i) => (
        <FlapDigit key={digits.length - i} digit={d} colors={colors} reduced={reduced} h={h} />
      ))}
    </span>
  );
};
