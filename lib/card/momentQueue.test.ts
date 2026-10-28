import { describe, expect, it } from 'vitest';
import type { NewStampEvent } from './types';
import {
  bannerCopy,
  bannerGift,
  completesCard,
  emptyQueue,
  finishStep,
  giftForSlot,
  giftToast,
  isDrained,
  nextStep,
  requestOpen,
  settleDelayMs,
  shortDate,
  stampToast,
  startStep,
  syncQueue,
  type MomentQueue,
} from './momentQueue';

const ev = (id: string, kind: NewStampEvent['kind'], slots: number[], timestamp = 0): NewStampEvent => ({
  id, kind, amount: slots.length, slots, timestamp,
});

const notLive = () => false;

/** Plays the next step to completion and returns the queue + what played. */
const playNext = (queue: MomentQueue, ready = true) => {
  const step = nextStep(queue, ready);
  if (!step) return { queue, played: null };
  return { queue: finishStep(startStep(queue, step)), played: `${step.type}:${step.moment.event.id}` };
};

describe('settleDelayMs', () => {
  it('waits for the grid stagger plus a beat', () => {
    expect(settleDelayMs(10)).toBe(750);
    expect(settleDelayMs(0)).toBe(350);
  });
});

describe('syncQueue', () => {
  it('splits stamps and gifts, oldest first', () => {
    const { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [3]), ev('g', 'gift', [4, 5]), ev('b', 'bonus', [6])], notLive);
    expect(queue.auto.map((m) => m.event.id)).toEqual(['a', 'b']);
    expect(queue.gifts.map((m) => m.event.id)).toEqual(['g']);
  });

  it('never re-queues an event it already took in', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [3])], notLive);
    queue = playNext(queue).queue;
    // Not acknowledged yet → still in the props; must not replay.
    const again = syncQueue(queue, [ev('a', 'stamp', [3])], notLive);
    expect(again.queue).toBe(queue);
    expect(nextStep(again.queue, true)).toBeNull();
  });

  it('marks late arrivals live and keeps the existing order', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [3])], notLive);
    ({ queue } = syncQueue(queue, [ev('a', 'stamp', [3]), ev('b', 'stamp', [4])], () => true));
    expect(queue.auto.map((m) => [m.event.id, m.live])).toEqual([['a', false], ['b', true]]);
  });

  it('drops waiting moments whose event vanished, but not the active one', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [3]), ev('b', 'stamp', [4]), ev('g', 'gift', [5])], notLive);
    queue = requestOpen(queue, 'g');
    queue = startStep(queue, nextStep(queue, true)!); // g (requested) plays first
    const result = syncQueue(queue, [ev('a', 'stamp', [3])], notLive);
    expect(result.dropped.map((m) => m.event.id)).toEqual(['b']);
    expect(result.queue.active?.event.id).toBe('g');
    expect(result.queue.auto.map((m) => m.event.id)).toEqual(['a']);
  });

  it('forgets an open request when the gift disappears', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('g', 'gift', [5])], notLive);
    queue = requestOpen(queue, 'g');
    ({ queue } = syncQueue(queue, [], notLive));
    expect(queue.opening).toEqual([]);
  });
});

describe('nextStep', () => {
  it('waits for the grid to settle before auto-playing stamps', () => {
    const { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [3])], notLive);
    expect(nextStep(queue, false)).toBeNull();
    expect(nextStep(queue, true)?.type).toBe('slam');
  });

  it('never auto-plays a gift', () => {
    const { queue } = syncQueue(emptyQueue(), [ev('g', 'gift', [3]), ev('w', 'welcome', [0, 1])], notLive);
    expect(nextStep(queue, true)).toBeNull();
  });

  it('plays one moment at a time', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [3]), ev('b', 'stamp', [4])], notLive);
    queue = startStep(queue, nextStep(queue, true)!);
    expect(nextStep(queue, true)).toBeNull();
  });

  it('a tapped gift jumps ahead of waiting stamps, even before settle', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [3]), ev('g', 'gift', [4])], notLive);
    queue = requestOpen(queue, 'g');
    expect(nextStep(queue, false)).toMatchObject({ type: 'unwrap', moment: { event: { id: 'g' } } });
  });

  it('plays the whole sequence: stamps, then gifts in tap order', () => {
    let { queue } = syncQueue(
      emptyQueue(),
      [ev('a', 'stamp', [1]), ev('g1', 'gift', [2]), ev('b', 'bonus', [3]), ev('g2', 'welcome', [4])],
      notLive,
    );
    const order: string[] = [];
    let r = playNext(queue);
    while (r.played) {
      order.push(r.played);
      queue = r.queue;
      r = playNext(queue);
    }
    expect(order).toEqual(['slam:a', 'slam:b']);
    queue = requestOpen(requestOpen(queue, 'g2'), 'g1');
    r = playNext(queue);
    while (r.played) {
      order.push(r.played);
      queue = r.queue;
      r = playNext(queue);
    }
    expect(order).toEqual(['slam:a', 'slam:b', 'unwrap:g2', 'unwrap:g1']);
    expect(isDrained(queue)).toBe(true);
  });
});

describe('gifts', () => {
  it('banner offers the oldest gift not already opening', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('g1', 'gift', [2, 3]), ev('g2', 'gift', [4])], notLive);
    expect(bannerGift(queue)?.event.id).toBe('g1');
    queue = requestOpen(queue, 'g1');
    expect(bannerGift(queue)?.event.id).toBe('g2');
  });

  it('finds the gift that owns a wrapped slot', () => {
    const { queue } = syncQueue(emptyQueue(), [ev('g1', 'gift', [2, 3]), ev('g2', 'gift', [4])], notLive);
    expect(giftForSlot(queue, 3)).toBe('g1');
    expect(giftForSlot(queue, 4)).toBe('g2');
    expect(giftForSlot(queue, 9)).toBeNull();
  });

  it('ignores duplicate and unknown open requests', () => {
    const { queue } = syncQueue(emptyQueue(), [ev('g1', 'gift', [2])], notLive);
    const once = requestOpen(queue, 'g1');
    expect(requestOpen(once, 'g1')).toBe(once);
    expect(requestOpen(queue, 'nope')).toBe(queue);
  });
});

describe('completesCard', () => {
  it('only the last moment on a full card completes it', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [8]), ev('b', 'stamp', [9])], notLive);
    queue = startStep(queue, nextStep(queue, true)!);
    expect(completesCard(queue, 10, 10)).toBe(false);
    queue = finishStep(queue);
    queue = startStep(queue, nextStep(queue, true)!);
    expect(completesCard(queue, 10, 10)).toBe(true);
    expect(completesCard(queue, 9, 10)).toBe(false);
  });

  it('an unopened gift holds the celebration back', () => {
    let { queue } = syncQueue(emptyQueue(), [ev('a', 'stamp', [8]), ev('g', 'gift', [9])], notLive);
    queue = startStep(queue, nextStep(queue, true)!);
    expect(completesCard(queue, 10, 10)).toBe(false);
  });
});

describe('copy', () => {
  const now = new Date(2026, 9, 28, 15).getTime();

  it('short dates', () => {
    expect(shortDate(new Date(2026, 9, 28, 8).getTime(), now)).toBe('hoy');
    expect(shortDate(new Date(2026, 9, 27, 23).getTime(), now)).toBe('ayer');
    expect(shortDate(new Date(2026, 9, 12).getTime(), now)).toBe('12 oct');
  });

  it('stamp toasts', () => {
    const at = new Date(2026, 9, 12).getTime();
    const opts = { totalStamps: 10, completes: false, now };
    expect(stampToast({ event: ev('a', 'stamp', [3], at), live: false }, opts).text).toBe('+1 sello · 12 oct');
    expect(stampToast({ event: ev('a', 'stamp', [3, 4], at), live: false }, opts).text).toBe('+2 sellos · 12 oct');
    expect(stampToast({ event: ev('a', 'stamp', [6], at), live: true }, opts).text).toBe('¡Nuevo sello! 7/10');
    expect(stampToast({ event: ev('a', 'bonus', [6], at), live: false }, opts)).toEqual({ tone: 'bonus', text: 'Sello de la suerte' });
    expect(stampToast({ event: ev('a', 'stamp', [9], at), live: true }, { ...opts, completes: true }).tone).toBe('complete');
  });

  it('gift toasts and banners', () => {
    expect(giftToast(ev('g', 'gift', [1, 2]), false).text).toBe('¡Regalo abierto! +2 sellos');
    expect(bannerCopy(ev('g', 'gift', [1]), 'Golden Beauty').title).toBe('Golden Beauty te regaló 1 sello');
    expect(bannerCopy(ev('w', 'welcome', [0, 1]), 'Golden Beauty').title).toBe('¡Bienvenida! Te regalamos 2 sellos');
  });
});
