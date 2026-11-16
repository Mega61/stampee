// Opening a door (prototype timings): the door lifts off the board to the
// middle (FLIP), the last door's star seal breaks, the two leaves swing open
// on their hinges with a light leak, gold leaf bursts out, and the gift rises
// with its title written in letter by letter. "Guardar" flies it into the
// "Mis regalos" counter.
//
// The POST is already in flight when this mounts; the reveal waits for it. If
// it fails, the door goes back to the board and the parent shows a toast.
// Rendered on document.body: the card face is 3D-transformed.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gift, Send } from 'lucide-react';
import type { AdventDoor, AdventOpenResult } from '../../../lib/advent/types';
import { canGiveGiftCard, firstName } from '../../../lib/advent/viewModel';
import { AdventImg } from './assets';
import { goldBurst } from './confetti';
import { createGoldLeaf, type GoldLeafHandle } from './GoldLeaf';
import { GiftCardFace, GiftTicket } from './GiftPieces';
import { StarIcon } from './decor';

const EASE = 'cubic-bezier(.16,1,.3,1)';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const anim = (el: Element | null | undefined, kf: Keyframe[], o: KeyframeAnimationOptions) =>
  el ? el.animate(kf, { fill: 'forwards', easing: EASE, ...o }).finished.catch(() => undefined) : Promise.resolve();

const all = (root: HTMLElement | null, sel: string): Element[] => (root ? Array.from(root.querySelectorAll(sel)) : []);

export type OpeningAction = 'keep' | 'gift' | 'link';

export const DoorOpening: React.FC<{
  door: AdventDoor;
  /** The door on the board, where the animation starts. */
  source: HTMLElement | null;
  isLast: boolean;
  month: string;
  customerName: string;
  result: Promise<AdventOpenResult>;
  reducedMotion: boolean;
  now: () => number;
  opensUntil: number;
  /** The "Mis regalos" counter, where the gift flies. */
  counterRect: () => DOMRect | null;
  onOpenTerms: (result: AdventOpenResult) => void;
  onDone: (result: AdventOpenResult, action: OpeningAction) => void;
  onFail: (error: unknown) => void;
}> = (props) => {
  const { door, isLast, reducedMotion } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doorRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const actsRef = useRef<HTMLDivElement>(null);
  const leafRef = useRef<GoldLeafHandle | null>(null);
  const [result, setResult] = useState<AdventOpenResult | null>(null);
  const [lettersGo, setLettersGo] = useState(false);
  const [closing, setClosing] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Door size and resting place: a bit above the middle, like the prototype.
  const [geo] = useState(() => {
    const W = isLast ? Math.min(250, window.innerWidth * 0.66) : Math.min(210, window.innerWidth * 0.56);
    const H = isLast ? W : W * 0.68;
    return { W, H, cx: window.innerWidth / 2, cy: window.innerHeight * 0.4, num: isLast ? W * 0.42 : H * 0.5 };
  });

  useEffect(() => {
    let cancelled = false;
    const leaf = !reducedMotion && canvasRef.current ? createGoldLeaf(canvasRef.current) : null;
    leafRef.current = leaf;
    const { W, H, cx, cy } = geo;

    const fail = async (err: unknown) => {
      if (!reducedMotion && props.source && doorRef.current) {
        const r = props.source.getBoundingClientRect();
        void anim(scrimRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 380 });
        await anim(doorRef.current, [
          { transform: 'translate(0,0) scale(1)' },
          { transform: `translate(${r.left - (cx - W / 2)}px, ${r.top - (cy - H / 2)}px) scale(${r.width / W}, ${r.height / H})` },
        ], { duration: 480 });
      }
      if (!cancelled) propsRef.current.onFail(err);
    };

    (async () => {
      if (reducedMotion) {
        let res: AdventOpenResult;
        try {
          res = await props.result;
        } catch (err) {
          return fail(err);
        }
        if (cancelled) return;
        setResult(res);
        await anim(scrimRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
        await anim(revealRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
        setLettersGo(true);
        (actsRef.current?.querySelector('button, a') as HTMLElement | null)?.focus({ preventScroll: true });
        return;
      }

      // 1. The door lifts off the board and comes to the middle (FLIP).
      const r = props.source?.getBoundingClientRect();
      void anim(scrimRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 450 });
      if (r) {
        await anim(doorRef.current, [
          { transform: `translate(${r.left - (cx - W / 2)}px, ${r.top - (cy - H / 2)}px) scale(${r.width / W}, ${r.height / H})` },
          { transform: 'translate(0,0) scale(1)' },
        ], { duration: 620 });
      }
      let res: AdventOpenResult;
      try {
        res = await props.result;
      } catch (err) {
        return fail(err);
      }
      if (cancelled) return;
      setResult(res);

      // 2. The star seal on the last door breaks.
      if (isLast) {
        const seal = doorRef.current?.querySelector('.seal');
        const [a, b] = all(doorRef.current, '.seal .h');
        await anim(seal, [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1.1)' }], { duration: 380 });
        leaf?.burst(cx, cy, 26);
        void anim(a, [{ transform: 'none', opacity: 1 }, { transform: 'translate(-60px, 90px) rotate(-70deg)', opacity: 0 }], { duration: 700, easing: 'cubic-bezier(.5,0,.75,0)' });
        void anim(b, [{ transform: 'none', opacity: 1 }, { transform: 'translate(60px, 90px) rotate(70deg)', opacity: 0 }], { duration: 700, easing: 'cubic-bezier(.5,0,.75,0)' });
        await sleep(260);
      }
      if (cancelled) return;

      // 3. The leaves swing open on their hinges; light spills out.
      const [l, rr] = all(doorRef.current, '.leaf');
      void anim(doorRef.current?.querySelector('.recess'), [{ opacity: 0 }, { opacity: 1 }], { duration: 500 });
      void anim(l, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(-118deg)' }], { duration: 900, easing: 'cubic-bezier(.2,.75,.25,1)' });
      void anim(rr, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(118deg)' }], { duration: 900, easing: 'cubic-bezier(.2,.75,.25,1)' });
      await sleep(240);
      leaf?.burst(cx, cy, isLast ? 70 : 46);
      if (isLast) goldBurst(cx, cy);
      leaf?.setAmbient(true);
      await sleep(380);
      if (cancelled) return;

      // 4. The gift rises out of the door.
      void anim(doorRef.current, [{ transform: 'none', opacity: 1 }, { transform: `translateY(${-H * 0.55}px) scale(.82)`, opacity: 0 }], { duration: 700 });
      await anim(revealRef.current, [
        { opacity: 0, transform: `translateY(${cy - window.innerHeight / 2 + 40}px) scale(.55)` },
        { opacity: 1, transform: 'none' },
      ], { duration: 720 });
      if (cancelled) return;
      setLettersGo(true);
      (actsRef.current?.querySelector('button, a') as HTMLElement | null)?.focus({ preventScroll: true });
    })();

    return () => {
      cancelled = true;
      leaf?.destroy();
      leafRef.current = null;
    };
    // The sequence runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = async (action: OpeningAction) => {
    if (!result || closing) return;
    setClosing(true);
    const target = revealRef.current?.querySelector('.adv-ticket, .gcwrap');
    const tab = props.counterRect();
    if (!reducedMotion && target && tab) {
      const tr = target.getBoundingClientRect();
      void anim(actsRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
      void anim(revealRef.current?.querySelector('.kick'), [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
      void anim(revealRef.current?.querySelector('.terms-link'), [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
      await anim(target, [
        { transform: 'none', opacity: 1 },
        {
          transform: `translate(${tab.left + tab.width / 2 - (tr.left + tr.width / 2)}px, ${tab.top + tab.height / 2 - (tr.top + tr.height / 2)}px) scale(.08)`,
          opacity: 0.4,
        },
      ], { duration: 640, easing: 'cubic-bezier(.55,0,.2,1)' });
    }
    leafRef.current?.setAmbient(false);
    await anim(rootRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion ? 150 : 240 });
    props.onDone(result, action);
  };

  // Escape keeps the gift, like "Guardar".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.adv-sheet.open')) void close('keep');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reward = result?.reward ?? null;
  const giftCard = reward?.giftCardId ? result?.state.giftCards.find((g) => g.id === reward.giftCardId) ?? null : null;
  const now = props.now();

  let actions: React.ReactNode = null;
  if (reward) {
    if (giftCard) {
      actions = (
        <>
          {canGiveGiftCard(giftCard) && (
            <a className="adv-btn-gold" href={giftCard.publicUrl!} target="_blank" rel="noopener noreferrer" onClick={() => void close('gift')}>
              <Send aria-hidden /> Regálala
            </a>
          )}
          <button type="button" className={canGiveGiftCard(giftCard) ? 'adv-btn-ghost' : 'adv-btn-gold'} onClick={() => void close('keep')}>
            Guardarla para mí
          </button>
        </>
      );
    } else if (reward.kind === 'link' && reward.url) {
      actions = (
        <>
          <a className="adv-btn-gold" href={reward.url} target="_blank" rel="noopener noreferrer" onClick={() => void close('link')}>
            <Gift aria-hidden /> Regalar una gift card
          </a>
          <button type="button" className="adv-btn-ghost" onClick={() => void close('keep')}>
            Guardar
          </button>
        </>
      );
    } else {
      actions = (
        <button type="button" className="adv-btn-gold" onClick={() => void close('keep')}>
          Guardar en Mis regalos
        </button>
      );
    }
  }

  const { W, H, cx, cy, num } = geo;
  return createPortal(
    <div
      ref={rootRef}
      className={`adv-portal adv-ov${reducedMotion ? ' adv-rm' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Puerta del ${door.dayLabel} de ${props.month}`}
    >
      <div ref={scrimRef} className="scrim" />
      <canvas ref={canvasRef} aria-hidden />
      {!reducedMotion && (
        <div ref={doorRef} className="adv-ov-door" style={{ left: cx - W / 2, top: cy - H / 2, width: W, height: H }} aria-hidden>
          <div className="recess">
            <AdventImg name="boxOpen" />
          </div>
          <div className="leaf l">
            <span className="n" style={{ fontSize: num }}>{door.dayLabel}</span>
            <span className="knob" />
          </div>
          <div className="leaf r">
            <span className="n" style={{ fontSize: num }}>{door.dayLabel}</span>
            <span className="knob" />
          </div>
          {isLast && (
            <div className="seal">
              <div className="h a"><StarIcon /></div>
              <div className="h b"><StarIcon /></div>
            </div>
          )}
        </div>
      )}
      <div ref={revealRef} className="adv-reveal">
        {reward && (
          <>
            <div className="kick">
              {giftCard ? `Feliz Navidad, ${firstName(props.customerName)}` : `Puerta del ${reward.dayLabel} de ${props.month}`}
            </div>
            {giftCard ? (
              <div className="gcwrap">
                <GiftCardFace giftCard={giftCard} shine />
              </div>
            ) : (
              <GiftTicket reward={reward} now={now} opensUntil={props.opensUntil} month={props.month} big lettersGo={lettersGo} />
            )}
            <div ref={actsRef} className="acts">
              {actions}
            </div>
            <button type="button" className="terms-link" onClick={() => props.onOpenTerms(result!)}>
              Términos y condiciones
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
