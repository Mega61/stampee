// OWNER: agent E (moments). Lazy chunk loaded by MomentsLayer when the card
// has unacknowledged events. It directs; the grid performs (lib/card/types.ts
// "Division of labor"):
//   stamp / bonus  → (live: glow ring on the slot) → 'stamp:slam' per slot →
//                    await 'stamp:landed' → clear slot state → toast → ack
//   gift / welcome → banner; tap (banner or wrapped slot) → 'gift:unwrap' per
//                    slot → await 'gift:unwrapped' → clear → toast → ack
// Sequencing rules live in lib/card/momentQueue.ts (pure, unit-tested).
// Events are acknowledged only after their moment played, so a tab closed
// mid-sequence replays the rest next visit.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { haptic } from '../../../lib/card/haptics';
import { withAlpha } from '../../../lib/card/gridFx';
import { usePageVisible } from '../../../lib/card/usePageVisible';
import {
  ANTICIPATION_MS,
  EVENT_GAP_MS,
  REDUCED_SETTLE_MS,
  SLAM_GAP_MS,
  STEP_TIMEOUT_MS,
  TOAST_MS,
  UNWRAP_GAP_MS,
  bannerCopy,
  bannerGift,
  completesCard,
  emptyQueue,
  finishStep,
  giftForSlot,
  giftToast,
  nextStep,
  requestOpen,
  settleDelayMs,
  stampToast,
  startStep,
  syncQueue,
  type MomentQueue,
  type MomentStep,
  type QueuedMoment,
  type ToastCopy,
} from '../../../lib/card/momentQueue';
import type { FxBus } from '../../../lib/card/types';
import { useCardFx } from '../CardFxContext';
import { GiftBanner } from './GiftBanner';
import { ToastStack, type ToastItem } from './StampToast';

export interface MomentDirectorProps {
  /** When the card view opened (MomentsLayer mount). */
  openedAt: number;
  /** Event ids present on open; anything else arrived live. */
  initialIds: string[];
}

/** Thrown out of a moment when the director unmounts mid-sequence. */
const DISPOSED = Symbol('disposed');

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Resolves once the tab is visible (immediately if it already is). */
const whenVisible = () =>
  isHidden()
    ? new Promise<void>((resolve) => {
        const onChange = () => {
          if (isHidden()) return;
          document.removeEventListener('visibilitychange', onChange);
          // A beat so the client is actually looking before things move.
          window.setTimeout(resolve, 300);
        };
        document.addEventListener('visibilitychange', onChange);
      })
    : Promise.resolve();

/** Waits for the grid to report a slot done, with a fallback so the queue never stalls. */
const slotDone = (bus: FxBus, type: 'stamp:landed' | 'gift:unwrapped', index: number) =>
  new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      off();
      resolve();
    };
    const timer = window.setTimeout(finish, STEP_TIMEOUT_MS);
    const off = bus.on(type, (p) => {
      if (p.index === index) finish();
    });
  });

interface Ring {
  id: number;
  x: number;
  y: number;
  size: number;
}

export const MomentDirector: React.FC<MomentDirectorProps> = ({ openedAt, initialIds }) => {
  const fx = useCardFx();
  const { newStampEvents, theme, reducedMotion, template, setSlotState } = fx;
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const pageVisible = usePageVisible();
  const rootRef = useRef<HTMLDivElement>(null);

  const [queue, setQueue] = useState<MomentQueue>(emptyQueue);
  const queueRef = useRef(queue);
  const commit = useCallback((next: MomentQueue) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  // Reduced motion: the grid has no fill-in to wait for, just a short beat.
  const readyAt = openedAt + (reducedMotion ? REDUCED_SETTLE_MS : settleDelayMs(template.totalStamps));
  const [ready, setReady] = useState(() => Date.now() >= readyAt);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const alive = useRef(false);
  const busy = useRef(false);

  // --- Toasts ---
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const pushToast = useCallback((copy: ToastCopy) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { ...copy, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  // --- Anticipation ring (live stamps) ---
  const [ring, setRing] = useState<Ring | null>(null);
  const showRing = useCallback((index: number) => {
    const slot = fxRef.current.getSlotRect(index);
    const root = rootRef.current?.getBoundingClientRect();
    if (!slot || !root) return;
    setRing({
      id: Date.now(),
      x: slot.left - root.left + slot.width / 2,
      y: slot.top - root.top + slot.height / 2,
      size: Math.max(slot.width, slot.height),
    });
  }, []);

  /** Confetti from the middle of the grid + the big haptic. */
  const celebrate = useCallback(() => {
    const { getSlotRect, bus, template: t } = fxRef.current;
    const first = getSlotRect(0);
    const last = getSlotRect(t.totalStamps - 1);
    if (first && last) {
      bus.emit('fx:burst', {
        x: (first.left + last.right) / 2,
        y: (first.top + last.bottom) / 2,
        kind: 'celebrate',
      });
    }
    haptic('success');
  }, []);

  // --- Moments ---
  const guard = useCallback(async <T,>(p: Promise<T>) => {
    const value = await p;
    if (!alive.current) throw DISPOSED;
    return value;
  }, []);

  const playSlam = useCallback(async ({ event, live }: QueuedMoment) => {
    const rm = fxRef.current.reducedMotion;
    // Staff just stamped while the client watches: a breath before it lands.
    // (A game win's bonus has its own flying stamp, so it lands right away.)
    if (live && event.kind === 'stamp' && !rm) {
      await guard(whenVisible());
      showRing(event.slots[0]!);
      await guard(sleep(ANTICIPATION_MS));
    }
    for (const [k, index] of event.slots.entries()) {
      if (k > 0 && !rm) await guard(sleep(SLAM_GAP_MS));
      await guard(whenVisible());
      const { bus } = fxRef.current;
      if (!rm) {
        const landed = slotDone(bus, 'stamp:landed', index);
        bus.emit('stamp:slam', { index, kind: event.kind });
        if (k === 0) setRing(null);
        await guard(landed);
      }
      fxRef.current.setSlotState(index, null);
    }
    setRing(null);
    const { card, template: t, trackInteraction, acknowledge } = fxRef.current;
    const completes = completesCard(queueRef.current, card.stamps, t.totalStamps);
    if (completes) celebrate();
    pushToast(stampToast({ event, live }, { totalStamps: t.totalStamps, completes }));
    trackInteraction('moment_seen');
    acknowledge([event.id]);
  }, [celebrate, guard, pushToast, showRing]);

  const playUnwrap = useCallback(async ({ event }: QueuedMoment) => {
    const rm = fxRef.current.reducedMotion;
    for (const [k, index] of event.slots.entries()) {
      if (k > 0 && !rm) await guard(sleep(UNWRAP_GAP_MS));
      await guard(whenVisible());
      const { bus } = fxRef.current;
      if (!rm) {
        const unwrapped = slotDone(bus, 'gift:unwrapped', index);
        bus.emit('gift:unwrap', { index });
        await guard(unwrapped);
      }
      fxRef.current.setSlotState(index, null);
    }
    const { card, template: t, trackInteraction, acknowledge, getSlotRect, bus } = fxRef.current;
    trackInteraction('gift_opened');
    const completes = completesCard(queueRef.current, card.stamps, t.totalStamps);
    if (completes) {
      celebrate();
    } else if (!rm) {
      // Finale over the opened slots, a beat after the last one.
      await guard(sleep(120));
      const rects = event.slots.map((i) => getSlotRect(i)).filter((r): r is DOMRect => !!r);
      if (rects.length > 0) {
        const x = rects.reduce((s, r) => s + r.left + r.width / 2, 0) / rects.length;
        const y = rects.reduce((s, r) => s + r.top + r.height / 2, 0) / rects.length;
        bus.emit('fx:burst', { x, y, kind: 'gift' });
      }
      haptic('gift');
    }
    pushToast(giftToast(event, completes));
    trackInteraction('moment_seen');
    acknowledge([event.id]);
  }, [celebrate, guard, pushToast]);

  const pump = useCallback(() => {
    if (busy.current || !alive.current || isHidden()) return;
    const step: MomentStep | null = nextStep(queueRef.current, readyRef.current);
    if (!step) return;
    busy.current = true;
    commit(startStep(queueRef.current, step));
    const play = step.type === 'slam' ? playSlam : playUnwrap;
    void play(step.moment)
      .then(() => guard(sleep(EVENT_GAP_MS)))
      .catch((err) => {
        if (err !== DISPOSED) console.error('[moments]', err);
      })
      .finally(() => {
        busy.current = false;
        if (!alive.current) return;
        commit(finishStep(queueRef.current));
        pump();
      });
  }, [commit, guard, playSlam, playUnwrap]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Take in new events (on mount and every live refresh).
  useEffect(() => {
    const initial = new Set(initialIds);
    const { queue: next, dropped } = syncQueue(
      queueRef.current,
      newStampEvents,
      (e) => !initial.has(e.id) && !isHidden(),
    );
    if (next === queueRef.current) return;
    // Release slots of events that vanished (e.g. a stamp was removed),
    // unless a current event owns the slot now.
    const owned = new Set(newStampEvents.flatMap((e) => e.slots));
    dropped.forEach((m) => m.event.slots.forEach((i) => !owned.has(i) && setSlotState(i, null)));
    commit(next);
    pump();
  }, [newStampEvents, initialIds, setSlotState, commit, pump]);

  // Wait for the grid's fill-in on open.
  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setReady(true), Math.max(0, readyAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [ready, readyAt]);

  // Ready, back from a hidden tab, or a fresh mount (StrictMode) → continue.
  useEffect(() => {
    if (ready && pageVisible) pump();
  }, [ready, pageVisible, pump]);

  // Gifts open on a tap (banner or wrapped slot).
  const open = useCallback((id: string | null) => {
    if (!id) return;
    commit(requestOpen(queueRef.current, id));
    pump();
  }, [commit, pump]);

  useEffect(() => fx.bus.on('gift:tap', ({ index }) => open(giftForSlot(queueRef.current, index))), [fx.bus, open]);

  // The banner shows once the opening stamps are done and hides while a gift unwraps.
  const offered = bannerGift(queue);
  const autoIdle = (!queue.active || queue.active.event.kind === 'gift' || queue.active.event.kind === 'welcome') && queue.auto.length === 0;
  const unwrapping = !!queue.active && (queue.active.event.kind === 'gift' || queue.active.event.kind === 'welcome');
  const [bannerSeen, setBannerSeen] = useState(false);
  const showBanner = ready && !!offered && !unwrapping && (bannerSeen || autoIdle);
  if (showBanner && !bannerSeen) setBannerSeen(true);
  const banner = offered ? bannerCopy(offered.event, template.name) : null;

  const onBannerOpen = useCallback((el: HTMLElement) => {
    const gift = bannerGift(queueRef.current);
    if (!gift) return;
    const r = el.getBoundingClientRect();
    haptic('tap');
    fxRef.current.trackInteraction('gift_banner_tap');
    fxRef.current.bus.emit('fx:burst', { x: r.left + 28, y: r.top + r.height / 2, kind: 'gift' });
    open(gift.event.id);
  }, [open]);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[60] overflow-hidden">
      <AnimatePresence>
        {ring && (
          // Something is coming: a glow gathers on the slot and a ring closes in on it.
          <m.span
            key={ring.id}
            aria-hidden
            className="absolute"
            style={{ left: ring.x - ring.size / 2, top: ring.y - ring.size / 2, width: ring.size, height: ring.size }}
            exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2, ease: 'easeIn' } }}
          >
            <m.span
              className="absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, ${withAlpha(theme.accent, 0.55)} 0%, ${withAlpha(theme.accent, 0.22)} 55%, transparent 72%)` }}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1.45 }}
              transition={{ duration: ANTICIPATION_MS / 1000, ease: 'easeOut' }}
            />
            <m.span
              className="absolute inset-0 rounded-full"
              style={{
                // On light paper a pale accent ring vanishes; the ink carries it there.
                border: `3px solid ${theme.surface === 'light' ? withAlpha(theme.ink, 0.6) : withAlpha(theme.accent, 0.95)}`,
                boxShadow: `0 0 20px 3px ${withAlpha(theme.accent, 0.55)}, inset 0 0 14px ${withAlpha(theme.accent, 0.4)}`,
              }}
              initial={{ opacity: 0, scale: 1.9 }}
              animate={{ opacity: [0, 1, 1], scale: [1.9, 1.04, 1.1] }}
              transition={{ duration: ANTICIPATION_MS / 1000, times: [0, 0.72, 1], ease: [0.2, 0.7, 0.3, 1] }}
            />
          </m.span>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBanner && banner && offered && (
          <GiftBanner
            key={offered.event.id}
            title={banner.title}
            action={banner.action}
            theme={theme}
            reducedMotion={reducedMotion}
            onOpen={onBannerOpen}
          />
        )}
      </AnimatePresence>

      <ToastStack toasts={toasts} theme={theme} reducedMotion={reducedMotion} />
    </div>
  );
};

export default MomentDirector;
