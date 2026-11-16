// Back face of the public card: the advent calendar (approved prototype,
// docs/ADVENT_PLAN.md §5). Header with string lights, "Calendario | Mis
// regalos", the 3×5 board with the last door as a wrapped present, and the
// countdown. The studio's seasonal skin: it ignores the campaign FxTheme.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock, Lock, RefreshCw, Zap } from 'lucide-react';
import { AdventOpenError, type AdventController, type AdventDoor, type AdventOpenResult } from '../../../lib/advent/types';
import {
  boardPlacement,
  countdownLine,
  doorContext,
  doorMonth,
  doorView,
  effectiveDoorState,
  giftCount,
  giftItems,
  lockedDoorToast,
  nextLockedDoor,
  rewardValidity,
  termsFor,
  type GiftItem,
  type TermsView,
} from '../../../lib/advent/viewModel';
import { AdventImg } from './assets';
import { goldBurst } from './confetti';
import { createGoldLeaf, type GoldLeafHandle } from './GoldLeaf';
import { Bow24, Sprig, StringLights } from './decor';
import { DoorOpening, type OpeningAction } from './DoorOpening';
import { GiftCardItem, GiftTicket } from './GiftPieces';
import { CodeSheet, TermsSheet, useAdventToast, type CodeSheetData } from './Sheets';
import './advent.css';

export interface AdventBoardProps {
  controller: AdventController;
  customerName: string;
  businessName: string;
  /** "Reservar mi cita" on the locked calendar. */
  bookingUrl: string | null;
  reducedMotion: boolean;
  /** The back face is showing: clocks tick and leaves fall only then. */
  visible: boolean;
  onFlipBack: () => void;
  /** A gift added stamps to the card (bonus_stamps). */
  onCardUpdate?: (card: { uniqueId: string; stamps: number }) => void;
}

interface Opening {
  door: AdventDoor;
  source: HTMLElement | null;
  result: Promise<AdventOpenResult>;
}

const FAIL_TOAST: Record<string, string> = {
  NOT_ELIGIBLE: 'Tu calendario se activa con tu primera visita',
  CLOSED: 'Esta puerta ya se cerró',
  NOT_FOUND: 'No encontramos esta puerta',
};

/** Server time, re-read every second while `active`. */
const useTicker = (now: () => number, active: boolean) => {
  const [t, setT] = useState(now);
  useEffect(() => {
    setT(now());
    if (!active) return;
    const id = setInterval(() => {
      if (!document.hidden) setT(now());
    }, 1000);
    return () => clearInterval(id);
  }, [now, active]);
  return t;
};

const LockedVeil: React.FC<{ bookingUrl: string | null }> = ({ bookingUrl }) => (
  <div className="adv-locked-veil">
    <div className="adv-locked-card">
      <AdventImg name="tree" className="still tree" />
      <AdventImg name="snowman" className="still snowman" />
      <div className="lk">
        <Lock aria-hidden />
      </div>
      <h3>Tu calendario te espera</h3>
      <p>Se activa con tu primera visita. Las puertas que ya se abrieron te esperan hasta el 31 de diciembre.</p>
      {bookingUrl && (
        <a className="adv-btn-gold" href={bookingUrl} target="_blank" rel="noopener noreferrer">
          Reservar mi cita
        </a>
      )}
    </div>
  </div>
);

export const AdventBoard: React.FC<AdventBoardProps> = (props) => {
  const { controller, reducedMotion, visible } = props;
  const state = controller.state!;
  const now = useTicker(controller.now, visible);
  const ctx = useMemo(() => doorContext(state), [state]);
  const [tab, setTab] = useState<'cal' | 'gifts'>('cal');
  const [opening, setOpening] = useState<Opening | null>(null);
  const [codeSheet, setCodeSheet] = useState<CodeSheetData | null>(null);
  const [terms, setTerms] = useState<TermsView | null>(null);
  const [bump, setBump] = useState(0);
  const toast = useAdventToast();
  const doorEls = useRef(new Map<number, HTMLButtonElement>());
  const countRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leafRef = useRef<GoldLeafHandle | null>(null);
  const snowmanRef = useRef<HTMLButtonElement>(null);

  const doors = state.doors;
  const lastNo = doors.length ? Math.max(...doors.map((d) => d.no)) : 0;
  const placement = useMemo(() => boardPlacement(doors), [doors]);
  const next = nextLockedDoor(doors, now, ctx);
  const items = useMemo(() => giftItems(state), [state]);
  const count = giftCount(items, now, ctx.opensUntil);
  const line = countdownLine(doors, now, ctx);
  const month = doors[0] ? doorMonth(doors[0]) : 'diciembre';

  // Ambient gold leaf while the back is showing.
  useEffect(() => {
    if (reducedMotion || !canvasRef.current) return;
    const leaf = createGoldLeaf(canvasRef.current);
    leafRef.current = leaf;
    return () => {
      leaf?.destroy();
      leafRef.current = null;
    };
  }, [reducedMotion]);
  useEffect(() => {
    leafRef.current?.setAmbient(visible && !opening);
  }, [visible, opening, reducedMotion]);

  // A door that unlocks while she's looking gets a little flash and a toast.
  const prevStates = useRef(new Map<number, string>());
  useEffect(() => {
    const prev = prevStates.current;
    for (const d of doors) {
      const st = effectiveDoorState(d, now, ctx);
      if (prev.get(d.no) === 'locked' && st === 'ready' && visible) {
        const el = doorEls.current.get(d.no);
        if (el && !reducedMotion) {
          el.animate([{ transform: 'scale(.9)', filter: 'brightness(2)' }, { transform: 'scale(1.04)' }, { transform: 'none', filter: 'none' }], {
            duration: 700,
            easing: 'cubic-bezier(.16,1,.3,1)',
          });
        }
        toast.show(`¡Se abrió la puerta del ${d.dayLabel}!`);
      }
      prev.set(d.no, st);
    }
  }, [doors, now, ctx, visible, reducedMotion, toast.show]);

  const jiggle = (el: HTMLElement | undefined) => {
    if (!el || reducedMotion) return;
    el.classList.remove('jiggle');
    void el.offsetWidth;
    el.classList.add('jiggle');
  };

  const onDoor = (door: AdventDoor) => {
    if (opening) return;
    if (!state.eligible) {
      toast.show('Tu calendario se activa con tu primera visita');
      return;
    }
    const st = effectiveDoorState(door, controller.now(), ctx);
    if (st === 'locked') {
      jiggle(doorEls.current.get(door.no));
      toast.show(lockedDoorToast(door));
      return;
    }
    if (st === 'missed') {
      toast.show(door.flashUntil ? 'Esta puerta flash ya se cerró' : 'Esta puerta ya se cerró');
      return;
    }
    if (st === 'opened') {
      setTab('gifts');
      return;
    }
    // The POST goes out now; the animation waits for it.
    const result = controller.openDoor(door.no);
    result.catch(() => undefined);
    setOpening({ door, source: doorEls.current.get(door.no) ?? null, result });
  };

  const finishOpening = useCallback(
    (result: AdventOpenResult, _action: OpeningAction) => {
      const opened = opening?.door.no;
      setOpening(null);
      controller.apply(result.state);
      if (result.card) props.onCardUpdate?.(result.card);
      setBump((b) => b + 1);
      requestAnimationFrame(() => {
        const el = opened ? doorEls.current.get(opened) : undefined;
        if (el && !reducedMotion) {
          el.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
        }
      });
    },
    [opening, controller, props.onCardUpdate, reducedMotion],
  );

  const failOpening = useCallback(
    (err: unknown) => {
      const door = opening?.door;
      setOpening(null);
      const reason = err instanceof AdventOpenError ? err.reason : 'NETWORK';
      if (reason === 'NOT_YET' && door) toast.show(lockedDoorToast(door));
      else toast.show(FAIL_TOAST[reason] ?? 'No pudimos abrir la puerta. Intenta de nuevo.');
      void controller.refresh();
    },
    [opening, controller, toast.show],
  );

  // Stable, so an open sheet doesn't re-run its focus effect every tick.
  const closeCode = useCallback(() => setCodeSheet(null), []);
  const closeTerms = useCallback(() => setTerms(null), []);

  const showTerms = (item: GiftItem) => setTerms(termsFor(item, state.commonTerms));

  const showCode = (item: Extract<GiftItem, { type: 'reward' }>) =>
    setCodeSheet({
      title: item.reward.title,
      code: item.reward.code!,
      validity: rewardValidity(item.reward, controller.now()),
      terms: termsFor(item, state.commonTerms),
    });

  const onSnowman = () => {
    if (reducedMotion || !snowmanRef.current) return;
    const r = snowmanRef.current.getBoundingClientRect();
    goldBurst(r.left + r.width / 2, r.top + r.height / 3);
  };

  const who = [props.customerName.trim().split(/\s+/)[0], props.businessName].filter(Boolean).join(' · ');

  const renderDoor = (door: AdventDoor) => {
    const v = doorView(door, now, ctx, { lastNo, nextNo: next?.no ?? null, giftCards: state.giftCards });
    const place = placement.get(door.no);
    const style: React.CSSProperties = place && place !== 'big' ? { gridColumn: place[0], gridRow: place[1] } : {};
    if (opening?.door.no === door.no) style.visibility = 'hidden';
    const cls = ['adv-door', v.state, v.big && 'big', v.next && 'next', v.flash && 'flash'].filter(Boolean).join(' ');
    let body: React.ReactNode;
    if (v.big) {
      body =
        v.state === 'opened' ? (
          <>
            <span className="n">{v.dayLabel}</span>
            <span className="gift-t">{v.giftLine}</span>
            <span className="ok">
              <Check aria-hidden /> En tu bolsa
            </span>
          </>
        ) : (
          <>
            <span className="wrap-v" />
            <span className="wrap-h" />
            <Bow24 />
            {v.state === 'ready' && <AdventImg name="star" poster="starPoster" reducedMotion={reducedMotion} className="star3d" />}
            <span className="face24">
              <span className="n">{v.dayLabel}</span>
              <span className="d">{v.caption}</span>
              {v.countdown && <span className="cd">{v.countdown}</span>}
            </span>
          </>
        );
    } else if (v.state === 'opened') {
      body = (
        <>
          <span className="n">{v.dayLabel}</span>
          <span className="gift-t">{v.giftLine}</span>
          <span className="ok">
            <Check aria-hidden /> En tu bolsa
          </span>
        </>
      );
    } else if (v.state === 'ready') {
      body = (
        <>
          <span className="pulse" />
          <span className="n">{v.dayLabel}</span>
          <span className="row">
            <span className="d">{v.caption}</span>
          </span>
          {v.flash && (
            <span className="tagflash">
              <Zap fill="currentColor" strokeWidth={0} aria-hidden /> flash
            </span>
          )}
        </>
      );
    } else if (v.state === 'missed') {
      body = (
        <>
          <span className="n">{v.dayLabel}</span>
          <span className="d">{v.caption}</span>
        </>
      );
    } else {
      body = (
        <>
          <span className="n">{v.dayLabel}</span>
          <span className="row">
            <span className="d">{v.countdown ?? v.caption}</span>
          </span>
        </>
      );
    }
    return (
      <button
        key={door.no}
        type="button"
        className={cls}
        style={style}
        aria-label={v.ariaLabel}
        ref={(el) => {
          if (el) doorEls.current.set(door.no, el);
          else doorEls.current.delete(door.no);
        }}
        onClick={() => onDoor(door)}
      >
        {body}
      </button>
    );
  };

  const LineIcon = line.icon === 'clock' ? Clock : line.icon === 'bolt' ? Zap : line.icon === 'lock' ? Lock : null;

  return (
    <section className={`adv${reducedMotion ? ' adv-rm' : ''}`} aria-label="Reverso: Calendario de Adviento">
      <canvas ref={canvasRef} className="adv-leaf" aria-hidden />
      <Sprig className="back-bl" />
      {state.eligible && (
        <button ref={snowmanRef} type="button" className="adv-snowman" aria-label="Muñeco de nieve: lanza confeti" onClick={onSnowman} data-no-flip>
          <AdventImg name="snowman" />
        </button>
      )}

      <div className="adv-block">
        <StringLights />
        <AdventImg name="baubles" poster="baublesPoster" reducedMotion={reducedMotion} className="adv-baubles" />
        <div className="adv-head">
          <div className="t">
            <small>Navidad Golden · {state.year}</small>
            <span>Calendario de Adviento</span>
          </div>
          <button type="button" className="adv-icon-btn" aria-label="Volver al frente de la tarjeta" onClick={props.onFlipBack}>
            <RefreshCw aria-hidden />
          </button>
        </div>

        <div className={`adv-seg${tab === 'gifts' ? ' on-gifts' : ''}`} role="tablist">
          <span className="pill" />
          <button type="button" role="tab" aria-selected={tab === 'cal'} onClick={() => setTab('cal')}>
            Calendario
          </button>
          <button type="button" role="tab" aria-selected={tab === 'gifts'} onClick={() => setTab('gifts')}>
            Mis regalos{' '}
            <span ref={countRef} key={bump} className={`count${bump ? ' bump' : ''}`}>
              {count}
            </span>
          </button>
        </div>

        <div className={`adv-views${state.eligible ? '' : ' is-locked'}`}>
          <div className="adv-view" hidden={tab !== 'cal'} role="tabpanel" aria-label="Calendario">
            <div className="adv-board">{doors.map(renderDoor)}</div>
            <div className="adv-countdown" aria-live="off">
              {LineIcon && <LineIcon aria-hidden fill={line.icon === 'bolt' ? 'currentColor' : 'none'} strokeWidth={line.icon === 'bolt' ? 0 : 1.8} />}
              <span>
                {line.text}
                {line.strong && <b>{line.strong}</b>}
                {line.after}
              </span>
            </div>
            {!state.eligible && <LockedVeil bookingUrl={props.bookingUrl} />}
          </div>
          <div className="adv-view" hidden={tab !== 'gifts'} role="tabpanel" aria-label="Mis regalos">
            <div className="adv-gifts" data-no-flip>
              {items.length === 0 ? (
                <div className="adv-empty">
                  <AdventImg name="presents" />
                  <b>Aún no hay regalos</b>
                  Cada puerta que abras deja aquí su regalo, listo para usar en el estudio.
                </div>
              ) : (
                items.map((item) =>
                  item.type === 'giftCard' ? (
                    <GiftCardItem key={item.key} giftCard={item.giftCard} now={now} onOpenTerms={() => showTerms(item)} />
                  ) : (
                    <GiftTicket
                      key={item.key}
                      reward={item.reward}
                      now={now}
                      opensUntil={ctx.opensUntil}
                      month={month}
                      onShowCode={() => showCode(item)}
                      onOpenTerms={() => showTerms(item)}
                    />
                  ),
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {opening && (
        <DoorOpening
          door={opening.door}
          source={opening.source}
          isLast={opening.door.no === lastNo}
          month={doorMonth(opening.door)}
          customerName={props.customerName}
          result={opening.result}
          reducedMotion={reducedMotion}
          now={controller.now}
          opensUntil={ctx.opensUntil}
          counterRect={() => countRef.current?.getBoundingClientRect() ?? null}
          onOpenTerms={(res) => {
            const gc = res.reward.giftCardId ? res.state.giftCards.find((g) => g.id === res.reward.giftCardId) : undefined;
            setTerms(
              termsFor(gc ? { type: 'giftCard', key: '', giftCard: gc, reward: res.reward } : { type: 'reward', key: '', reward: res.reward }, res.state.commonTerms),
            );
          }}
          onDone={finishOpening}
          onFail={failOpening}
        />
      )}
      <CodeSheet data={codeSheet} who={who} reducedMotion={reducedMotion} onClose={closeCode} />
      <TermsSheet terms={terms} reducedMotion={reducedMotion} onClose={closeTerms} />
      {toast.node}
    </section>
  );
};

export default AdventBoard;
