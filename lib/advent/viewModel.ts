// Pure view logic for the advent back face: door states between refetches,
// countdowns, "Mis regalos" chips, validity lines and terms. Copy matches the
// approved prototype. Times are server ms (Date.now() + offset); calendar days
// are Bogotá days, like the API.
import type { AdventDoor, AdventDoorState, AdventReward, AdventState, CustomerGiftCard } from './types';

export const TZ = 'America/Bogota';
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- formatting

const ms = (iso: string) => new Date(iso).getTime();

/** Bogotá calendar day of an instant, YYYY-MM-DD. */
export const bogotaYmd = (at: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

/** An instant in Bogotá ("mar", "8 de dic", "martes 8"); ICU's abbreviation dot dropped. */
export const fmtInstant = (at: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(at).toLocaleDateString('es-CO', { timeZone: TZ, ...opts }).replace('.', '');

/** A date-only value (YYYY-MM-DD), with no time-zone shift. */
export const fmtYmd = (ymd: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('es-CO', { timeZone: 'UTC', ...opts }).replace('.', '');
};

const SHORT = { day: 'numeric', month: 'short' } as const;
const LONG_YEAR = { day: 'numeric', month: 'long', year: 'numeric' } as const;

/** "15 ene" (the gift card face). */
const dayMonth = (ymd: string) => `${Number(ymd.slice(8, 10))} ${fmtYmd(ymd, { month: 'short' })}`;

/** "$30.000". */
export const fmtCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO').replace(/,/g, '.');

const pad = (n: number) => String(n).padStart(2, '0');

/** "1 d 04:05:06" or "04:05:06". */
export const formatDuration = (left: number) => {
  const s = Math.max(0, Math.floor(left / 1000));
  const d = Math.floor(s / 86400);
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d > 0 ? `${d} d ${hms}` : hms;
};

/** "7 a. m." for an instant, in Bogotá. */
export const hourLabel = (at: number) => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(at)));
  const m = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, minute: 'numeric' }).format(new Date(at)));
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

// ---------------------------------------------------------------- doors

export interface DoorContext {
  eligible: boolean;
  opensUntil: number;
}

export const doorContext = (state: Pick<AdventState, 'eligible' | 'opensUntil'>): DoorContext => ({
  eligible: state.eligible,
  opensUntil: ms(state.opensUntil),
});

/**
 * The state to show now. The server's word stands, but a door whose time has
 * come flips to ready (or a flash door to missed) the moment the countdown
 * hits zero, before the refetch confirms it.
 */
export const effectiveDoorState = (door: AdventDoor, now: number, ctx: DoorContext): AdventDoorState => {
  if (!ctx.eligible) return door.state === 'opened' ? 'opened' : 'locked';
  if (door.state === 'opened' || door.state === 'missed') return door.state;
  const closed = (door.flashUntil && now >= ms(door.flashUntil)) || now >= ctx.opensUntil;
  if (door.state === 'locked') {
    if (now < ms(door.unlockAt)) return 'locked';
    return closed ? 'missed' : 'ready';
  }
  return closed ? 'missed' : 'ready';
};

/** The next door still to unlock (eligible customers only). */
export const nextLockedDoor = (doors: AdventDoor[], now: number, ctx: DoorContext) =>
  ctx.eligible ? doors.find((d) => effectiveDoorState(d, now, ctx) === 'locked') ?? null : null;

/** A ready flash door, whose window is closing. */
export const readyFlashDoor = (doors: AdventDoor[], now: number, ctx: DoorContext) =>
  doors.find((d) => d.flashUntil && effectiveDoorState(d, now, ctx) === 'ready') ?? null;

export const readyCount = (doors: AdventDoor[], now: number, ctx: DoorContext) =>
  doors.filter((d) => effectiveDoorState(d, now, ctx) === 'ready').length;

const STATE_LABEL: Record<AdventDoorState, string> = {
  locked: 'cerrada',
  ready: 'lista para abrir',
  opened: 'abierta',
  missed: 'se cerró',
};

export interface DoorView {
  no: number;
  dayLabel: number;
  state: AdventDoorState;
  /** The last door: the 2×2 wrapped present. */
  big: boolean;
  /** The next door to unlock (gold rim + countdown). */
  next: boolean;
  /** A ready flash door. */
  flash: boolean;
  ariaLabel: string;
  /** Small text under the number. */
  caption: string;
  /** Live countdown for the next door, else null. */
  countdown: string | null;
  /** Opened: what's inside, one line. */
  giftLine: string | null;
}

/** "diciembre" for a door's unlock day. */
export const doorMonth = (door: AdventDoor) => fmtInstant(ms(door.unlockAt), { month: 'long' });

export const doorView = (
  door: AdventDoor,
  now: number,
  ctx: DoorContext,
  opts: { lastNo: number; nextNo: number | null; giftCards: CustomerGiftCard[] },
): DoorView => {
  const state = effectiveDoorState(door, now, ctx);
  const unlock = ms(door.unlockAt);
  const big = door.no === opts.lastNo;
  const next = opts.nextNo === door.no;
  const flash = !!door.flashUntil && state === 'ready';
  const wd = fmtInstant(unlock, { weekday: 'short' });

  let caption: string;
  if (state === 'ready') {
    caption = flash && !big ? `Solo ${Math.round((ms(door.flashUntil!) - unlock) / 3_600_000)} h` : '¡Ábrela!';
  } else if (state === 'missed') {
    caption = 'Se cerró';
  } else if (big) {
    caption = door.dayLabel === 24 ? `Nochebuena · ${wd} ${door.dayLabel}` : `${wd} ${door.dayLabel}`;
  } else {
    caption = wd;
  }

  let countdown: string | null = null;
  if (next && state === 'locked') {
    const left = unlock - now;
    countdown = left < DAY_MS ? formatDuration(left) : `${wd} · ${hourLabel(unlock)}`;
  }

  let giftLine: string | null = null;
  if (state === 'opened' && door.reward) {
    const gc = door.reward.giftCardId ? opts.giftCards.find((g) => g.id === door.reward!.giftCardId) : undefined;
    giftLine = big && gc ? `Gift card ${fmtCOP(gc.amountCop)}` : door.reward.title;
  }

  return {
    no: door.no,
    dayLabel: door.dayLabel,
    state,
    big,
    next,
    flash,
    ariaLabel: `Puerta del ${door.dayLabel} de ${doorMonth(door)}, ${STATE_LABEL[state]}`,
    caption,
    countdown,
    giftLine,
  };
};

/**
 * Where each door sits on the 3×5 board (col, row; 1-based). Doors are
 * shuffled like a paper calendar; the last door is the 2×2 present in the
 * bottom-right corner. Keyed by door order (1…12), not by date.
 */
const SHUFFLED_12: Record<number, [number, number]> = {
  1: [2, 1], 2: [3, 2], 3: [1, 3], 4: [1, 1], 5: [2, 2], 6: [3, 3],
  7: [3, 1], 8: [1, 4], 9: [1, 2], 10: [1, 5], 11: [2, 3],
};
const FREE_CELLS: Array<[number, number]> = [
  [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3], [1, 4], [1, 5],
];

export const boardPlacement = (doors: AdventDoor[]) => {
  const place = new Map<number, [number, number] | 'big'>();
  const sorted = [...doors].sort((a, b) => a.no - b.no);
  const last = sorted[sorted.length - 1];
  const shuffled = sorted.length === 12;
  sorted.forEach((d, i) => {
    if (d === last) place.set(d.no, 'big');
    else place.set(d.no, (shuffled ? SHUFFLED_12[i + 1] : FREE_CELLS[i]) ?? [((i % 3) + 1), Math.floor(i / 3) + 1]);
  });
  return place;
};

export interface CountdownLine {
  icon: 'clock' | 'bolt' | 'lock' | null;
  text: string;
  strong?: string;
  after?: string;
}

/** The line under the board. */
export const countdownLine = (doors: AdventDoor[], now: number, ctx: DoorContext): CountdownLine => {
  if (!ctx.eligible) return { icon: 'lock', text: 'Se activa con tu primera visita' };
  const next = nextLockedDoor(doors, now, ctx);
  const flash = readyFlashDoor(doors, now, ctx);
  if (flash && next) return { icon: 'bolt', text: 'Flash: se cierra en ', strong: formatDuration(ms(flash.flashUntil!) - now) };
  if (next) return { icon: 'clock', text: `Puerta del ${next.dayLabel} · abre en `, strong: formatDuration(ms(next.unlockAt) - now) };
  if (now > ctx.opensUntil) return { icon: null, text: 'El calendario cerró. Tus regalos siguen en ', strong: 'Mis regalos', after: '.' };
  if (flash) return { icon: 'bolt', text: 'Puerta flash · se cierra en ', strong: formatDuration(ms(flash.flashUntil!) - now) };
  return { icon: null, text: 'Abre tus puertas antes del ', strong: fmtInstant(ctx.opensUntil, SHORT).replace(' de ', ' ') };
};

/** Toast for a tap on a door that can't open. */
export const lockedDoorToast = (door: AdventDoor) =>
  `Se abre el ${fmtInstant(ms(door.unlockAt), { weekday: 'long', day: 'numeric' })} a las ${hourLabel(ms(door.unlockAt)).replace(/^(\d+) /, '$1:00 ')}`;

// ---------------------------------------------------------------- Mis regalos

export type ChipTone = 'ok' | 'used' | 'soon' | 'late' | 'plain';

export interface Chip {
  tone: ChipTone;
  text: string;
}

const isSpent = (chip: Chip) => chip.tone === 'used' || chip.tone === 'late';

const LATER: Chip = { tone: 'plain', text: 'Guardada para después' };

const expiryChip = (validTo: string | null, now: number): Chip | null => {
  if (!validTo) return null;
  const end = new Date(`${validTo.slice(0, 10)}T23:59:59-05:00`).getTime();
  const left = Math.ceil((end - now) / DAY_MS);
  if (left > 3) return null;
  return { tone: 'soon', text: left <= 1 ? 'Vence hoy' : `Vence en ${left} días` };
};

/** Status chip for a calendar gift. */
export const rewardChip = (reward: AdventReward, now: number, opensUntil: number): Chip => {
  const today = bogotaYmd(now);
  if (reward.kind === 'bonus_stamps') return reward.stamps === 0 ? { tone: 'used', text: 'No aplicó' } : { tone: 'ok', text: 'Ya en tu tarjeta' };
  if (reward.kind === 'link') {
    const until = reward.validTo ? dayMonth(reward.validTo) : fmtInstant(opensUntil, SHORT).replace(' de ', ' ');
    return { tone: 'plain', text: `Hasta el ${until}` };
  }
  if (reward.status === 'redeemed') return { tone: 'used', text: 'Usado' };
  if (reward.status === 'transferred') return { tone: 'used', text: 'Regalado' };
  if (reward.status === 'expired' || (reward.validTo && today > reward.validTo.slice(0, 10))) return { tone: 'late', text: 'Vencido' };
  if (reward.validFrom && today < reward.validFrom.slice(0, 10)) return LATER;
  return expiryChip(reward.validTo, now) ?? { tone: 'ok', text: 'Disponible' };
};

/** "Úsalo del 2 de ene al 31 de ene"; long dates with year while it's saved for later. */
export const rewardValidity = (reward: AdventReward, now: number) => {
  if (!reward.validFrom || !reward.validTo) {
    return reward.kind === 'bonus_stamps' && reward.stamps !== 0
      ? `Sumado el ${fmtInstant(ms(reward.openedAt), { day: 'numeric', month: 'long' })}`
      : '';
  }
  if (bogotaYmd(now) < reward.validFrom.slice(0, 10)) {
    return `Úsalo del ${fmtYmd(reward.validFrom, LONG_YEAR)} al ${fmtYmd(reward.validTo, LONG_YEAR)}`;
  }
  return `Úsalo del ${fmtYmd(reward.validFrom, SHORT)} al ${fmtYmd(reward.validTo, SHORT)}`;
};

/** A coupon the front desk can scan now ("Mostrar en caja"). */
export const canShowAtCheckout = (reward: AdventReward, now: number) => {
  if (reward.kind !== 'coupon' || !reward.code) return false;
  const chip = rewardChip(reward, now, 0);
  return !isSpent(chip) && chip.text !== LATER.text;
};

/** Status chip for a gift card. */
export const giftCardChip = (gc: CustomerGiftCard, now: number): Chip => {
  const today = bogotaYmd(now);
  switch (gc.effectiveStatus) {
    case 'redeemed':
      return { tone: 'used', text: 'Usada' };
    case 'expired':
      return { tone: 'late', text: 'Vencida' };
    case 'void':
      return { tone: 'late', text: 'Anulada' };
    case 'pending_payment':
      return { tone: 'soon', text: 'Esperando pago' };
    default:
      if (gc.validFrom && today < gc.validFrom.slice(0, 10)) return LATER;
      return expiryChip(gc.validTo, now) ?? { tone: 'ok', text: 'Disponible' };
  }
};

/** Only while saved for later: "Úsala del 15 de enero de 2027 al 15 de febrero de 2027". */
export const giftCardLaterLine = (gc: CustomerGiftCard, now: number) =>
  gc.effectiveStatus === 'active' && gc.validFrom && gc.validTo && bogotaYmd(now) < gc.validFrom.slice(0, 10)
    ? `Úsala del ${fmtYmd(gc.validFrom, LONG_YEAR)} al ${fmtYmd(gc.validTo, LONG_YEAR)}`
    : null;

/** The line on the gift card face: "Válida del 15 ene al 15 feb · compra mínima $100.000". */
export const giftCardFaceLine = (gc: CustomerGiftCard) => {
  const parts: string[] = [];
  // The year only when the window crosses into another one ("20 dic al 20 dic 2027").
  const end = (from: string | null, to: string) => (from && from.slice(0, 4) === to.slice(0, 4) ? dayMonth(to) : `${dayMonth(to)} ${to.slice(0, 4)}`);
  if (gc.validFrom && gc.validTo) parts.push(`Válida del ${dayMonth(gc.validFrom)} al ${end(gc.validFrom, gc.validTo)}`);
  else if (gc.validTo) parts.push(`Válida hasta el ${end(null, gc.validTo)}`);
  if (gc.minTicketCop) parts.push(`compra mínima ${fmtCOP(gc.minTicketCop)}`);
  return parts.join(' · ');
};

/** "Regálala" opens the gift card's own page, for cards she can still give. */
export const canGiveGiftCard = (gc: CustomerGiftCard) =>
  !gc.locked && !!gc.publicUrl && gc.role === 'buyer' && gc.transferable && !gc.recipientName &&
  (gc.effectiveStatus === 'active' || gc.effectiveStatus === 'pending_payment');

export type GiftItem =
  | { type: 'reward'; key: string; reward: AdventReward }
  | { type: 'giftCard'; key: string; giftCard: CustomerGiftCard; reward: AdventReward | null };

/**
 * "Mis regalos": the calendar's gifts newest first (the gift_card door shows
 * its gift card), then any other gift card she gave or received.
 */
export const giftItems = (state: Pick<AdventState, 'rewards' | 'giftCards'>): GiftItem[] => {
  const used = new Set<string>();
  const items: GiftItem[] = state.rewards.map((reward) => {
    const gc = reward.giftCardId ? state.giftCards.find((g) => g.id === reward.giftCardId) : undefined;
    if (gc) {
      used.add(gc.id);
      return { type: 'giftCard', key: `gc-${gc.id}`, giftCard: gc, reward };
    }
    return { type: 'reward', key: reward.id, reward };
  });
  for (const gc of state.giftCards) {
    if (!used.has(gc.id)) items.push({ type: 'giftCard', key: `gc-${gc.id}`, giftCard: gc, reward: null });
  }
  return items;
};

export const itemChip = (item: GiftItem, now: number, opensUntil: number) =>
  item.type === 'giftCard' ? giftCardChip(item.giftCard, now) : rewardChip(item.reward, now, opensUntil);

/** The count on the "Mis regalos" tab: gifts still to enjoy. */
export const giftCount = (items: GiftItem[], now: number, opensUntil: number) =>
  items.filter((item) => !isSpent(itemChip(item, now, opensUntil))).length;

export const isSpentItem = (item: GiftItem, now: number, opensUntil: number) => isSpent(itemChip(item, now, opensUntil));

export interface TermsView {
  /** "Gift card Golden · puerta del 24" / "<title> · puerta del 8". */
  forLine: string;
  own: string[];
  /** The calendar's common terms; null for gift cards that aren't from the calendar. */
  common: string[] | null;
}

/** Terms for a gift: the gift card's own terms win over the door's, plus the calendar's. */
export const termsFor = (item: GiftItem, commonTerms: string[]): TermsView => {
  if (item.type === 'giftCard') {
    const { giftCard, reward } = item;
    return {
      forLine: reward ? `Gift card Golden · puerta del ${reward.dayLabel}` : `Gift card ${giftCard.tierName || 'Golden'}`,
      own: giftCard.terms.length ? giftCard.terms : reward?.terms ?? [],
      common: reward ? commonTerms : null,
    };
  }
  return { forLine: `${item.reward.title} · puerta del ${item.reward.dayLabel}`, own: item.reward.terms, common: commonTerms };
};

/** When the hook should refetch next: the next unlock, flash close or calendar close. */
export const nextBoundary = (state: AdventState, now: number) => {
  const times = [state.nextUnlockAt, state.opensUntil, ...state.doors.flatMap((d) => [d.unlockAt, d.flashUntil])]
    .filter((t): t is string => !!t)
    .map(ms)
    .filter((t) => t > now);
  return times.length ? Math.min(...times) : null;
};
