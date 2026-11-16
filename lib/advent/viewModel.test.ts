import { describe, expect, it } from 'vitest';
import type { AdventDoor, AdventReward, AdventState, CustomerGiftCard } from './types';
import {
  boardPlacement,
  canGiveGiftCard,
  canShowAtCheckout,
  countdownLine,
  doorContext,
  doorView,
  effectiveDoorState,
  fmtCOP,
  formatDuration,
  giftCardChip,
  giftCardFaceLine,
  giftCardLaterLine,
  giftCount,
  giftItems,
  hourLabel,
  lockedDoorToast,
  nextBoundary,
  rewardChip,
  rewardValidity,
  termsFor,
} from './viewModel';

const at = (d: string, h = 7, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`).getTime();
const iso = (t: number) => new Date(t).toISOString();
const OPENS_UNTIL = iso(new Date('2026-12-31T23:59:59-05:00').getTime());

const door = (no: number, extra: Partial<AdventDoor> = {}): AdventDoor => {
  const day = no * 2;
  return { no, dayLabel: day, unlockAt: iso(at(`2026-12-${String(day).padStart(2, '0')}`)), flashUntil: null, state: 'locked', reward: null, ...extra };
};

const reward = (extra: Partial<AdventReward> = {}): AdventReward => ({
  id: 'r1',
  doorNo: 4,
  dayLabel: 8,
  kind: 'coupon',
  title: 'Regalo de ejemplo',
  subtitle: 'Subtítulo',
  terms: ['Condición 1'],
  code: 'GB-TEST',
  status: 'available',
  validFrom: '2026-12-08',
  validTo: '2027-01-31',
  openedAt: iso(at('2026-12-08', 9)),
  url: null,
  stamps: null,
  giftCardId: null,
  ...extra,
});

const giftCard = (extra: Partial<Extract<CustomerGiftCard, { locked: false }>> = {}): CustomerGiftCard => ({
  id: 'gc1',
  uniqueId: 'u1',
  code: 'TR-AAAA-BBBB',
  publicUrl: 'https://example.test/regalo/u1',
  role: 'buyer',
  locked: false,
  amountCop: 25000,
  tierName: 'Adviento',
  effectiveStatus: 'active',
  funded: false,
  source: 'advent',
  buyerFirstName: 'Ana',
  recipientName: null,
  message: '',
  validFrom: '2027-01-15',
  validTo: '2027-02-15',
  minTicketCop: 90000,
  transferable: true,
  terms: ['Término de la gift card'],
  ...extra,
});

const ctx = { eligible: true, opensUntil: new Date(OPENS_UNTIL).getTime() };

describe('formatting', () => {
  it('formats durations, hours and money like the prototype', () => {
    expect(formatDuration(59_000)).toBe('00:00:59');
    expect(formatDuration(21 * 3_600_000 - 5000)).toBe('20:59:55');
    expect(formatDuration(35 * 3_600_000)).toBe('1 d 11:00:00');
    expect(formatDuration(-10)).toBe('00:00:00');
    expect(hourLabel(at('2026-12-10'))).toBe('7 a. m.');
    expect(hourLabel(at('2026-12-10', 19, 30))).toBe('7:30 p. m.');
    expect(fmtCOP(30000)).toBe('$30.000');
    expect(lockedDoorToast(door(5))).toBe('Se abre el jueves 10 a las 7:00 a. m.');
  });
});

describe('door states', () => {
  it('flips locked → ready at unlock time and ready → missed when the flash closes', () => {
    const flash = door(7, { flashUntil: iso(at('2026-12-16')) });
    expect(effectiveDoorState(flash, at('2026-12-14', 6, 59), ctx)).toBe('locked');
    expect(effectiveDoorState(flash, at('2026-12-14', 7), ctx)).toBe('ready');
    expect(effectiveDoorState({ ...flash, state: 'ready' }, at('2026-12-16', 7), ctx)).toBe('missed');
    expect(effectiveDoorState({ ...door(1), state: 'ready' }, at('2027-01-01', 0, 1), ctx)).toBe('missed');
    expect(effectiveDoorState({ ...door(1), state: 'opened' }, at('2027-01-03'), ctx)).toBe('opened');
  });

  it('shows everything locked (but keeps opened doors) when not eligible', () => {
    const c = { ...ctx, eligible: false };
    expect(effectiveDoorState({ ...door(1), state: 'ready' }, at('2026-12-09'), c)).toBe('locked');
    expect(effectiveDoorState({ ...door(1), state: 'opened' }, at('2026-12-09'), c)).toBe('opened');
  });

  it('builds the view: next door countdown, flash caption, big door label', () => {
    const doors = Array.from({ length: 12 }, (_, i) => door(i + 1));
    const now = at('2026-12-09', 10);
    const v = doorView(doors[4]!, now, ctx, { lastNo: 12, nextNo: 5, giftCards: [] });
    expect(v).toMatchObject({ state: 'locked', next: true, caption: 'jue', countdown: '21:00:00' });
    expect(v.ariaLabel).toBe('Puerta del 10 de diciembre, cerrada');
    const far = doorView(doors[4]!, at('2026-12-08', 10), ctx, { lastNo: 12, nextNo: 5, giftCards: [] });
    expect(far.countdown).toBe('jue · 7 a. m.');
    const ready = doorView({ ...doors[6]!, flashUntil: iso(at('2026-12-16')) }, at('2026-12-14', 20), ctx, { lastNo: 12, nextNo: 8, giftCards: [] });
    expect(ready).toMatchObject({ state: 'ready', flash: true, caption: 'Solo 48 h' });
    const big = doorView(doors[11]!, now, ctx, { lastNo: 12, nextNo: 5, giftCards: [] });
    expect(big).toMatchObject({ big: true, caption: 'Nochebuena · jue 24' });
    const openedBig = doorView(
      { ...doors[11]!, state: 'opened', reward: reward({ kind: 'gift_card', giftCardId: 'gc1' }) },
      at('2026-12-24', 8),
      ctx,
      { lastNo: 12, nextNo: null, giftCards: [giftCard()] },
    );
    expect(openedBig.giftLine).toBe('Gift card $25.000');
  });

  it('places 12 doors on the shuffled 3×5 board with the last one big', () => {
    const place = boardPlacement(Array.from({ length: 12 }, (_, i) => door(i + 1)));
    expect(place.get(12)).toBe('big');
    expect(place.get(4)).toEqual([1, 1]);
    expect(new Set([...place.values()].filter((p) => p !== 'big').map((p) => String(p))).size).toBe(11);
  });

  it('writes the countdown line for each moment', () => {
    const doors = Array.from({ length: 12 }, (_, i) => door(i + 1, { flashUntil: i === 6 ? iso(at('2026-12-16')) : null }));
    expect(countdownLine(doors, at('2026-12-02', 6, 59), ctx)).toMatchObject({ icon: 'clock', text: 'Puerta del 2 · abre en ', strong: '00:01:00' });
    expect(countdownLine(doors, at('2026-12-14', 20), ctx)).toMatchObject({ icon: 'bolt', text: 'Flash: se cierra en ', strong: '1 d 11:00:00' });
    const opened = doors.map((d) => ({ ...d, state: 'opened' as const }));
    expect(countdownLine(opened, at('2026-12-24', 8), ctx)).toMatchObject({ text: 'Abre tus puertas antes del ', strong: '31 dic' });
    expect(countdownLine(opened, at('2027-01-03', 11), ctx)).toMatchObject({ strong: 'Mis regalos' });
    expect(countdownLine(doors, at('2026-12-09'), { ...ctx, eligible: false })).toMatchObject({ icon: 'lock', text: 'Se activa con tu primera visita' });
  });

  it('refetches at the next boundary', () => {
    const state = { nextUnlockAt: iso(at('2026-12-10')), opensUntil: OPENS_UNTIL, doors: [door(5), door(7, { flashUntil: iso(at('2026-12-16')) })] } as AdventState;
    expect(nextBoundary(state, at('2026-12-09', 10))).toBe(at('2026-12-10'));
    expect(nextBoundary(state, at('2026-12-15'))).toBe(at('2026-12-16'));
    expect(nextBoundary(state, at('2027-01-02'))).toBeNull();
  });
});

describe('Mis regalos chips', () => {
  const now = at('2026-12-20', 10);
  it('labels each status', () => {
    expect(rewardChip(reward(), now, ctx.opensUntil)).toEqual({ tone: 'ok', text: 'Disponible' });
    expect(rewardChip(reward({ status: 'redeemed' }), now, ctx.opensUntil)).toEqual({ tone: 'used', text: 'Usado' });
    expect(rewardChip(reward({ status: 'expired' }), now, ctx.opensUntil)).toEqual({ tone: 'late', text: 'Vencido' });
    expect(rewardChip(reward({ validTo: '2026-12-22' }), now, ctx.opensUntil)).toEqual({ tone: 'soon', text: 'Vence en 3 días' });
    expect(rewardChip(reward({ validTo: '2026-12-20' }), now, ctx.opensUntil)).toEqual({ tone: 'soon', text: 'Vence hoy' });
    expect(rewardChip(reward({ validFrom: '2027-01-02' }), now, ctx.opensUntil)).toEqual({ tone: 'plain', text: 'Guardada para después' });
    expect(rewardChip(reward({ kind: 'bonus_stamps', stamps: 1, code: null }), now, ctx.opensUntil).text).toBe('Ya en tu tarjeta');
    expect(rewardChip(reward({ kind: 'link', validTo: null }), now, ctx.opensUntil).text).toBe('Hasta el 31 dic');
  });

  it('shows "Mostrar en caja" only for usable coupons', () => {
    expect(canShowAtCheckout(reward(), now)).toBe(true);
    expect(canShowAtCheckout(reward({ validFrom: '2027-01-02' }), now)).toBe(false);
    expect(canShowAtCheckout(reward({ status: 'redeemed' }), now)).toBe(false);
    expect(canShowAtCheckout(reward({ kind: 'double_stamps', code: null }), now)).toBe(false);
  });

  it('writes validity lines, long with the year while saved for later', () => {
    expect(rewardValidity(reward(), now)).toBe('Úsalo del 8 de dic al 31 de ene');
    expect(rewardValidity(reward({ validFrom: '2027-01-02' }), now)).toBe('Úsalo del 2 de enero de 2027 al 31 de enero de 2027');
    expect(rewardValidity(reward({ kind: 'bonus_stamps', validFrom: null, validTo: null, stamps: 1 }), now)).toBe('Sumado el 8 de diciembre');
  });

  it('handles gift cards: saved for later, locked, spent', () => {
    const gc = giftCard();
    expect(giftCardChip(gc, now)).toEqual({ tone: 'plain', text: 'Guardada para después' });
    expect(giftCardLaterLine(gc, now)).toBe('Úsala del 15 de enero de 2027 al 15 de febrero de 2027');
    expect(giftCardLaterLine(gc, at('2027-01-20'))).toBeNull();
    expect(giftCardChip(gc, at('2027-01-20'))).toEqual({ tone: 'ok', text: 'Disponible' });
    expect(giftCardChip(giftCard({ effectiveStatus: 'redeemed' }), now).text).toBe('Usada');
    expect(giftCardFaceLine(gc)).toBe('Válida del 15 ene al 15 feb · compra mínima $90.000');
    expect(giftCardFaceLine(giftCard({ validFrom: '2026-12-20', validTo: '2027-12-20', minTicketCop: null }))).toBe('Válida del 20 dic al 20 dic 2027');
    expect(canGiveGiftCard(gc)).toBe(true);
    expect(canGiveGiftCard(giftCard({ recipientName: 'Laura' }))).toBe(false);
    const locked: CustomerGiftCard = { ...gc, code: null, uniqueId: null, publicUrl: null, role: 'recipient', locked: true, lockedHint: 'Ábrela con el link.' };
    expect(canGiveGiftCard(locked)).toBe(false);
  });

  it('merges rewards and gift cards, counts gifts to enjoy and assembles terms', () => {
    const gcReward = reward({ id: 'r12', doorNo: 12, dayLabel: 24, kind: 'gift_card', code: null, giftCardId: 'gc1', terms: ['Término de la puerta'] });
    const state = { rewards: [gcReward, reward({ status: 'redeemed', id: 'r2' }), reward({ id: 'r3' })], giftCards: [giftCard(), giftCard({ id: 'gc2', source: 'sale', tierName: 'Detalle' })] };
    const items = giftItems(state);
    expect(items.map((i) => i.key)).toEqual(['gc-gc1', 'r2', 'r3', 'gc-gc2']);
    expect(giftCount(items, now, ctx.opensUntil)).toBe(3);
    const common = ['Común 1'];
    expect(termsFor(items[0]!, common)).toEqual({ forLine: 'Gift card Golden · puerta del 24', own: ['Término de la gift card'], common });
    expect(termsFor(items[2]!, common)).toEqual({ forLine: 'Regalo de ejemplo · puerta del 8', own: ['Condición 1'], common });
    expect(termsFor(items[3]!, common)).toMatchObject({ forLine: 'Gift card Detalle', common: null });
  });
});

describe('doorContext', () => {
  it('reads eligibility and the close instant', () => {
    expect(doorContext({ eligible: true, opensUntil: OPENS_UNTIL })).toEqual(ctx);
  });
});
