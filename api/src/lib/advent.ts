// Seasonal advent calendar (docs/ADVENT_PLAN.md, shapes in docs/ADVENT_CONTRACT.md).
//
// The calendar belongs to the customer (0018). Every rule is decided here, on
// the server, with the server clock (lib/clock.ts): which doors are open, what a
// door gives, and whether a gift can still be used. A door's contents never
// leave the API before the customer opens it.
import { randomInt, randomUUID } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type {
  AdventCalendarsTable,
  AdventDoorsTable,
  AdventRewardKind,
  AdventRewardsTable,
  Database,
} from '../db/types.js';
import { AppError } from './errors.js';
import { onCardChanged } from './cardEvents.js';
import { bogotaDate, issueGiftCard, listGiftCardsForCustomer, type CustomerGiftCard } from './giftCards.js';
import { giftStampToCustomer, type GiftActor } from './giftStamps.js';

export type Executor = Kysely<Database> | Transaction<Database>;
type CalendarRow = Selectable<AdventCalendarsTable>;
type DoorRow = Selectable<AdventDoorsTable>;
type RewardRow = Selectable<AdventRewardsTable>;

export type AdventDoorState = 'locked' | 'ready' | 'opened' | 'missed';
export type AdventRewardStatus = 'available' | 'redeemed' | 'expired' | 'transferred';

export interface AdventReward {
  id: string;
  doorNo: number;
  dayLabel: number;
  kind: AdventRewardKind;
  title: string;
  subtitle: string;
  terms: string[];
  code: string | null;
  status: AdventRewardStatus;
  validFrom: string | null;
  validTo: string | null;
  openedAt: string;
  url: string | null;
  stamps: number | null;
  giftCardId: string | null;
}

export interface AdventDoor {
  no: number;
  dayLabel: number;
  unlockAt: string;
  flashUntil: string | null;
  state: AdventDoorState;
  reward: AdventReward | null;
}

export interface AdventState {
  serverNow: string;
  year: number;
  eligible: boolean;
  opensUntil: string;
  commonTerms: string[];
  doors: AdventDoor[];
  nextUnlockAt: string | null;
  readyCount: number;
  rewards: AdventReward[];
  giftCards: CustomerGiftCard[];
}

/** Who the calendar's own stamps are credited to in the card history. */
export const ADVENT_ACTOR: GiftActor = { id: null, name: 'Calendario de Adviento', role: 'system' };

const iso = (d: Date | string) => new Date(d).toISOString();
const asDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ---------------------------------------------------------------- pure rules

/** What the customer can do with a door right now. */
export const doorState = (
  door: Pick<DoorRow, 'unlock_at' | 'flash_until'>,
  opened: boolean,
  now: Date,
  opensUntil: Date,
): AdventDoorState => {
  if (opened) return 'opened';
  if (now < asDate(door.unlock_at)) return 'locked';
  if (door.flash_until && now >= asDate(door.flash_until)) return 'missed';
  if (now > opensUntil) return 'missed';
  return 'ready';
};

/** 'expired' is derived (valid_to before today in Bogota), never stored. */
export const rewardStatus = (row: Pick<RewardRow, 'status' | 'valid_to'>, today: string): AdventRewardStatus =>
  row.status === 'available' && row.valid_to && row.valid_to < today ? 'expired' : row.status;

// Crockford-ish alphabet without look-alikes (0/O, 1/I/L, U).
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const generateAdventCode = () =>
  'GB-' + Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
export const normalizeAdventCode = (input: string) => {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return raw.startsWith('GB') && raw.length === 6 ? `GB-${raw.slice(2)}` : input.trim().toUpperCase();
};

export interface GiftCardTier {
  when: 'default' | 'visit_between';
  amountCop: number;
  minTicketCop?: number;
  from?: string;
  to?: string;
}

/** The door's gift card tiers: a 'visit_between' tier wins when it applies, else 'default'. */
export const pickGiftCardTier = (tiers: GiftCardTier[], visitedBetween: (from: string, to: string) => boolean) =>
  tiers.find((t) => t.when === 'visit_between' && t.from && t.to && visitedBetween(t.from, t.to)) ??
  tiers.find((t) => t.when === 'default') ??
  null;

// ---------------------------------------------------------------- reads

export const loadCalendar = async (db: Executor, ownerId: string) => {
  const calendar = (await db
    .selectFrom('advent_calendars')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('enabled', '=', true)
    .orderBy('year', 'desc')
    .limit(1)
    .executeTakeFirst()) as CalendarRow | undefined;
  if (!calendar) return null;
  const doors = (await db
    .selectFrom('advent_doors')
    .selectAll()
    .where('calendar_id', '=', calendar.id)
    .orderBy('door_no', 'asc')
    .execute()) as DoorRow[];
  return { calendar, doors };
};

/** A real visit on any of her cards. Public sign-ups without visits see the calendar locked. */
export const isEligible = async (db: Executor, customerId: string): Promise<boolean> => {
  const row = await db
    .selectFrom('transactions')
    .innerJoin('issued_cards', 'issued_cards.id', 'transactions.card_id')
    .select('transactions.id')
    .where('issued_cards.customer_id', '=', customerId)
    .where('transactions.type', '=', 'stamp_add')
    .limit(1)
    .executeTakeFirst();
  return !!row;
};

/** A real visit (stamp_add) between two Bogota calendar days, inclusive. */
const visitedBetween = async (db: Executor, customerId: string, from: string, to: string) => {
  const start = new Date(`${from}T00:00:00-05:00`).getTime();
  const end = new Date(`${to}T23:59:59.999-05:00`).getTime();
  const row = await db
    .selectFrom('transactions')
    .innerJoin('issued_cards', 'issued_cards.id', 'transactions.card_id')
    .select('transactions.id')
    .where('issued_cards.customer_id', '=', customerId)
    .where('transactions.type', '=', 'stamp_add')
    .where('transactions.timestamp', '>=', start)
    .where('transactions.timestamp', '<=', end)
    .limit(1)
    .executeTakeFirst();
  return !!row;
};

export const toRewardDto = (
  row: RewardRow,
  door: DoorRow,
  today: string,
  giftCards: CustomerGiftCard[] = [],
): AdventReward => {
  const giftCard = door.kind === 'gift_card' ? giftCards.find((g) => g.id === row.external_ref) : undefined;
  return {
    id: row.id,
    doorNo: door.door_no,
    dayLabel: door.day_label,
    kind: door.kind,
    title: door.title,
    subtitle: door.subtitle,
    // The gift card's own terms win: one source with its /regalo page.
    terms: giftCard ? giftCard.terms : asList(door.terms),
    code: row.code,
    status: rewardStatus(row, today),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    openedAt: iso(row.opened_at),
    url: door.kind === 'link' ? door.url : null,
    stamps: row.stamps,
    giftCardId: door.kind === 'gift_card' ? row.external_ref : null,
  };
};

/** The calendar as one customer sees it, or null when there is nothing to show (ADVENT_OFF). */
export const buildAdventState = async (
  db: Executor,
  ownerId: string,
  customerId: string,
  now: Date,
): Promise<AdventState | null> => {
  const loaded = await loadCalendar(db, ownerId);
  if (!loaded) return null;
  const { calendar, doors } = loaded;
  const today = bogotaDate(now);
  const opensUntil = asDate(calendar.opens_until);

  const rewardRows = doors.length
    ? ((await db
        .selectFrom('advent_rewards')
        .selectAll()
        .where('customer_id', '=', customerId)
        .where(
          'door_id',
          'in',
          doors.map((d) => d.id),
        )
        .execute()) as RewardRow[])
    : [];
  const giftCards = await listGiftCardsForCustomer(db, ownerId, customerId);
  const byDoor = new Map(rewardRows.map((r) => [r.door_id, r]));
  const doorById = new Map(doors.map((d) => [d.id, d]));
  const rewards = rewardRows
    .map((r) => toRewardDto(r, doorById.get(r.door_id)!, today, giftCards))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || b.doorNo - a.doorNo);

  // After the last day to open doors, the back stays only while there is something to use.
  if (now > opensUntil && !rewards.some((r) => r.status === 'available') && giftCards.length === 0) return null;

  const eligible = await isEligible(db, customerId);
  const doorDtos: AdventDoor[] = doors.map((d) => {
    const reward = byDoor.get(d.id);
    return {
      no: d.door_no,
      dayLabel: d.day_label,
      unlockAt: iso(d.unlock_at),
      flashUntil: d.flash_until ? iso(d.flash_until) : null,
      state: doorState(d, !!reward, now, opensUntil),
      reward: reward ? toRewardDto(reward, d, today, giftCards) : null,
    };
  });
  const next = doors.map((d) => asDate(d.unlock_at)).filter((t) => t > now).sort((a, b) => +a - +b)[0];

  return {
    serverNow: now.toISOString(),
    year: calendar.year,
    eligible,
    opensUntil: opensUntil.toISOString(),
    commonTerms: asList(calendar.common_terms),
    doors: doorDtos,
    nextUnlockAt: next ? next.toISOString() : null,
    readyCount: eligible ? doorDtos.filter((d) => d.state === 'ready').length : 0,
    rewards,
    giftCards,
  };
};

// ---------------------------------------------------------------- open a door

export interface OpenDoorResult {
  reward: AdventReward;
  card: { uniqueId: string; stamps: number } | null;
}

/**
 * Opens a door for a customer. One transaction, the customer row locked, so a
 * double tap can't open twice; a replay returns the gift the first call gave.
 */
export const openDoor = async (
  db: Kysely<Database>,
  params: { ownerId: string; customerId: string; doorNo: number; cardId: string | null; now: Date },
): Promise<OpenDoorResult> => {
  const { ownerId, customerId, doorNo, now } = params;
  const today = bogotaDate(now);
  let changedCard: { id: string; added: number } | null = null;

  const result = await db.transaction().execute(async (trx) => {
    const loaded = await loadCalendar(trx, ownerId);
    const door = loaded?.doors.find((d) => d.door_no === doorNo);
    if (!loaded || !door) throw new AppError(404, 'NOT_FOUND', 'Door not found.');

    await trx.selectFrom('customers').select('id').where('id', '=', customerId).forUpdate().execute();

    const existing = (await trx
      .selectFrom('advent_rewards')
      .selectAll()
      .where('door_id', '=', door.id)
      .where('customer_id', '=', customerId)
      .executeTakeFirst()) as RewardRow | undefined;
    if (existing) return { row: existing, door };

    if (!(await isEligible(trx, customerId))) {
      throw new AppError(403, 'NOT_ELIGIBLE', 'The calendar opens with a first visit.');
    }
    const state = doorState(door, false, now, asDate(loaded.calendar.opens_until));
    if (state === 'locked') throw new AppError(409, 'NOT_YET', 'This door is not open yet.');
    if (state === 'missed') throw new AppError(409, 'CLOSED', 'This door is closed.');

    const base = {
      owner_id: ownerId,
      door_id: door.id,
      customer_id: customerId,
      card_id: params.cardId,
      opened_at: now,
    };
    let values: Record<string, unknown> = { ...base, status: 'available' };

    if (door.kind === 'coupon' || door.kind === 'double_stamps') {
      values = { ...values, valid_from: door.valid_from, valid_to: door.valid_to };
    }
    if (door.kind === 'bonus_stamps') {
      const res = await giftStampToCustomer(trx, {
        ownerId,
        customerId,
        stamps: door.stamps ?? 1,
        remarks: `Calendario de Adviento, puerta del ${door.day_label}`,
        actor: ADVENT_ACTOR,
        now,
      });
      if (res.added > 0) changedCard = { id: res.cardId, added: res.added };
      values = { ...values, status: 'redeemed', stamps: res.added, card_id: res.cardId || params.cardId };
    }
    if (door.kind === 'gift_card') {
      const config = (door.config ?? {}) as { tiers?: GiftCardTier[]; transferable?: boolean; rules?: Record<string, unknown> };
      const tiers = config.tiers ?? [];
      let tier: GiftCardTier | null = null;
      for (const t of tiers) {
        if (t.when === 'visit_between' && t.from && t.to && (await visitedBetween(trx, customerId, t.from, t.to))) {
          tier = t;
          break;
        }
      }
      tier = tier ?? pickGiftCardTier(tiers, () => false);
      if (!tier) throw new AppError(500, 'INTERNAL_ERROR', 'The gift card door has no tiers.');
      const issued = await issueGiftCard(trx, {
        ownerId,
        buyerCustomerId: customerId,
        amountCop: tier.amountCop,
        source: 'advent',
        funded: false,
        validFrom: door.valid_from,
        validTo: door.valid_to,
        minTicketCop: tier.minTicketCop ?? null,
        transferable: config.transferable ?? true,
        rules: (config.rules ?? {}) as never,
        externalRef: `advent-${loaded.calendar.year}:door-${door.day_label}:${customerId}`,
        actorName: ADVENT_ACTOR.name,
      });
      values = { ...values, external_ref: issued.giftCardId, valid_from: door.valid_from, valid_to: issued.validTo };
    }

    // Coupons carry a short code for the front desk; retry on the rare collision.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = door.kind === 'coupon' ? generateAdventCode() : null;
      const row = (await trx
        .insertInto('advent_rewards')
        .values({ ...values, code } as never)
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst()) as RewardRow | undefined;
      if (row) return { row, door };
      if (door.kind !== 'coupon') break;
    }
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not open the door.');
  });

  let card: OpenDoorResult['card'] = null;
  const changed = changedCard as { id: string; added: number } | null;
  if (changed) {
    onCardChanged(changed.id, 'gift', changed.added);
    const row = await db.selectFrom('issued_cards').select(['unique_id', 'stamps']).where('id', '=', changed.id).executeTakeFirst();
    if (row) card = { uniqueId: row.unique_id, stamps: row.stamps };
  }
  const giftCards = result.door.kind === 'gift_card' ? await listGiftCardsForCustomer(db, ownerId, customerId) : [];
  return { reward: toRewardDto(result.row, result.door, today, giftCards), card };
};

// ---------------------------------------------------------------- studio

export interface StudioReward extends AdventReward {
  customerId: string;
  customerName: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
}

const studioRewardQuery = (db: Executor, ownerId: string) =>
  db
    .selectFrom('advent_rewards')
    .innerJoin('advent_doors', 'advent_doors.id', 'advent_rewards.door_id')
    .innerJoin('customers', 'customers.id', 'advent_rewards.customer_id')
    .selectAll('advent_rewards')
    .select([
      'advent_doors.id as d_id',
      'advent_doors.calendar_id as d_calendar_id',
      'advent_doors.door_no as d_door_no',
      'advent_doors.day_label as d_day_label',
      'advent_doors.unlock_at as d_unlock_at',
      'advent_doors.flash_until as d_flash_until',
      'advent_doors.kind as d_kind',
      'advent_doors.title as d_title',
      'advent_doors.subtitle as d_subtitle',
      'advent_doors.terms as d_terms',
      'advent_doors.value_cop as d_value_cop',
      'advent_doors.stamps as d_stamps',
      'advent_doors.url as d_url',
      'advent_doors.valid_from as d_valid_from',
      'advent_doors.valid_to as d_valid_to',
      'advent_doors.config as d_config',
      'customers.name as customer_name',
    ])
    .where('advent_rewards.owner_id', '=', ownerId);

type StudioRow = Awaited<ReturnType<ReturnType<typeof studioRewardQuery>['execute']>>[number];

const toStudioReward = (r: StudioRow, today: string): StudioReward => {
  const door = {
    id: r.d_id,
    calendar_id: r.d_calendar_id,
    door_no: r.d_door_no,
    day_label: r.d_day_label,
    unlock_at: r.d_unlock_at,
    flash_until: r.d_flash_until,
    kind: r.d_kind,
    title: r.d_title,
    subtitle: r.d_subtitle,
    terms: r.d_terms,
    value_cop: r.d_value_cop,
    stamps: r.d_stamps,
    url: r.d_url,
    valid_from: r.d_valid_from,
    valid_to: r.d_valid_to,
    config: r.d_config,
  } as DoorRow;
  return {
    ...toRewardDto(r as unknown as RewardRow, door, today),
    customerId: r.customer_id,
    customerName: r.customer_name,
    redeemedAt: r.redeemed_at ? iso(r.redeemed_at) : null,
    redeemedBy: r.redeemed_by,
  };
};

export const listStudioRewards = async (
  db: Executor,
  ownerId: string,
  filter: { customerId?: string; status: 'available' | 'all'; now: Date },
): Promise<StudioReward[]> => {
  let q = studioRewardQuery(db, ownerId);
  if (filter.customerId) q = q.where('advent_rewards.customer_id', '=', filter.customerId);
  const rows = await q.orderBy('advent_rewards.opened_at', 'desc').execute();
  const today = bogotaDate(filter.now);
  const all = rows.map((r) => toStudioReward(r, today));
  return filter.status === 'available' ? all.filter((r) => r.status === 'available') : all;
};

const findStudioReward = async (db: Executor, ownerId: string, code: string, lock = false) => {
  let q = studioRewardQuery(db, ownerId).where('advent_rewards.code', '=', normalizeAdventCode(code));
  if (lock) q = q.forUpdate('advent_rewards');
  const row = await q.executeTakeFirst();
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Gift not found.');
  return row;
};

/** Marks a coupon used at the front desk. A second call answers alreadyRedeemed. */
export const redeemReward = async (
  db: Kysely<Database>,
  params: { ownerId: string; code: string; actorName: string; ticketRef?: string | null; now: Date },
): Promise<{ reward: StudioReward; alreadyRedeemed: boolean }> =>
  db.transaction().execute(async (trx) => {
    const today = bogotaDate(params.now);
    const row = await findStudioReward(trx, params.ownerId, params.code, true);
    if (row.d_kind !== 'coupon') throw new AppError(409, 'NOT_REDEEMABLE', 'This gift is not used at the front desk.');
    if (row.status === 'redeemed') return { reward: toStudioReward(row, today), alreadyRedeemed: true };
    if (row.valid_from && row.valid_from > today) throw new AppError(409, 'NOT_YET_VALID', 'This gift is not valid yet.');
    if (row.valid_to && row.valid_to < today) throw new AppError(409, 'EXPIRED', 'This gift has expired.');
    await trx
      .updateTable('advent_rewards')
      .set({ status: 'redeemed', redeemed_at: params.now, redeemed_by: params.actorName, ticket_ref: params.ticketRef ?? null })
      .where('id', '=', row.id)
      .execute();
    const fresh = await findStudioReward(trx, params.ownerId, params.code);
    return { reward: toStudioReward(fresh, today), alreadyRedeemed: false };
  });

/** Undoes a mistaken redeem. OK when it was already available. */
export const unredeemReward = async (
  db: Kysely<Database>,
  params: { ownerId: string; code: string; actorName: string; now: Date },
): Promise<StudioReward> =>
  db.transaction().execute(async (trx) => {
    const row = await findStudioReward(trx, params.ownerId, params.code, true);
    if (row.d_kind !== 'coupon') throw new AppError(409, 'NOT_REDEEMABLE', 'This gift is not used at the front desk.');
    if (row.status === 'redeemed') {
      await trx
        .updateTable('advent_rewards')
        .set({ status: 'available', redeemed_at: null, redeemed_by: null, ticket_ref: null })
        .where('id', '=', row.id)
        .execute();
    }
    return toStudioReward(await findStudioReward(trx, params.ownerId, params.code), bogotaDate(params.now));
  });

// ---------------------------------------------------------------- double stamps

export type DoubleStampReason = 'NO_REWARD' | 'OUT_OF_RANGE' | 'ALREADY_APPLIED' | 'NO_ACTIVE_CARD' | 'FULL';

/**
 * The January double stamp: one extra stamp per qualifying visit while the
 * customer holds a valid double_stamps gift. The CRM decides which visits
 * qualify (it knows the service) and calls once per visit; visitRef makes it
 * idempotent. Unlike gift stamps, this one may complete the card: it rides on
 * a real visit.
 */
export const applyDoubleStamp = async (
  db: Kysely<Database>,
  params: { ownerId: string; customerId: string; visitRef: string; visitDate: string; now: Date },
): Promise<{ added: number; reason?: DoubleStampReason; cardId?: string; stamps?: number }> => {
  const out = await db.transaction().execute(async (trx) => {
    const reward = await trx
      .selectFrom('advent_rewards')
      .innerJoin('advent_doors', 'advent_doors.id', 'advent_rewards.door_id')
      .select(['advent_rewards.id', 'advent_rewards.valid_from', 'advent_rewards.valid_to'])
      .where('advent_rewards.owner_id', '=', params.ownerId)
      .where('advent_rewards.customer_id', '=', params.customerId)
      .where('advent_doors.kind', '=', 'double_stamps')
      .where('advent_rewards.status', '=', 'available')
      .orderBy('advent_rewards.opened_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!reward) return { added: 0, reason: 'NO_REWARD' as const };
    if ((reward.valid_from && params.visitDate < reward.valid_from) || (reward.valid_to && params.visitDate > reward.valid_to)) {
      return { added: 0, reason: 'OUT_OF_RANGE' as const };
    }

    const card = await trx
      .selectFrom('issued_cards')
      .leftJoin('campaigns', 'campaigns.id', 'issued_cards.campaign_id')
      .select([
        'issued_cards.id as id',
        'issued_cards.stamps as stamps',
        'issued_cards.template_snapshot as snapshot',
        'campaigns.total_stamps as campaignTotal',
      ])
      .where('issued_cards.owner_id', '=', params.ownerId)
      .where('issued_cards.customer_id', '=', params.customerId)
      .where('issued_cards.status', '=', 'Active')
      .orderBy('issued_cards.created_at', 'desc')
      .limit(1)
      .forUpdate('issued_cards')
      .executeTakeFirst();
    if (!card) return { added: 0, reason: 'NO_ACTIVE_CARD' as const };

    const inserted = await trx
      .insertInto('advent_double_stamps')
      .values({ reward_id: reward.id, visit_ref: params.visitRef, card_id: card.id, visit_date: params.visitDate })
      .onConflict((oc) => oc.doNothing())
      .returning('reward_id')
      .executeTakeFirst();
    if (!inserted) return { added: 0, reason: 'ALREADY_APPLIED' as const };

    const snapshotTotal = Number((card.snapshot as Record<string, unknown> | null)?.['totalStamps']);
    const total = Number.isFinite(snapshotTotal) && snapshotTotal > 0 ? snapshotTotal : card.campaignTotal;
    if (total && card.stamps >= total) return { added: 0, reason: 'FULL' as const, cardId: card.id, stamps: card.stamps };

    const stamps = card.stamps + 1;
    await trx.updateTable('issued_cards').set({ stamps }).where('id', '=', card.id).execute();
    await trx
      .insertInto('transactions')
      .values({
        id: randomUUID(),
        card_id: card.id,
        type: 'bonus',
        amount: 1,
        date: params.visitDate,
        timestamp: params.now.getTime(),
        title: 'Sello doble de Adviento',
        remarks: `Visita ${params.visitRef}`,
        actor_id: ADVENT_ACTOR.id,
        actor_name: ADVENT_ACTOR.name,
        actor_role: ADVENT_ACTOR.role,
      })
      .execute();
    return { added: 1, cardId: card.id, stamps };
  });
  if (out.added > 0 && out.cardId) onCardChanged(out.cardId, 'bonus', out.added);
  return out;
};

// ---------------------------------------------------------------- seeding

export interface CalendarInput {
  enabled: boolean;
  opensUntil: string;
  commonTerms: string[];
  doors: Array<{
    doorNo: number;
    dayLabel: number;
    unlockAt: string;
    flashUntil?: string | null;
    kind: AdventRewardKind;
    title: string;
    subtitle?: string;
    terms?: string[];
    valueCop?: number | null;
    stamps?: number | null;
    url?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    config?: Record<string, unknown>;
  }>;
}

/**
 * Creates or updates a year's calendar and its doors (the private door file is
 * loaded through PUT /advent/calendars/:year). A door that customers already
 * opened can't change kind: their gifts would stop making sense.
 */
export const upsertCalendar = async (db: Kysely<Database>, ownerId: string, year: number, input: CalendarInput) =>
  db.transaction().execute(async (trx) => {
    const calendar = await trx
      .insertInto('advent_calendars')
      .values({
        owner_id: ownerId,
        year,
        enabled: input.enabled,
        opens_until: input.opensUntil,
        common_terms: JSON.stringify(input.commonTerms),
      })
      .onConflict((oc) =>
        oc.columns(['owner_id', 'year']).doUpdateSet({
          enabled: input.enabled,
          opens_until: input.opensUntil,
          common_terms: JSON.stringify(input.commonTerms),
        }),
      )
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const existing = (await trx
      .selectFrom('advent_doors')
      .select(['id', 'door_no', 'kind'])
      .where('calendar_id', '=', calendar.id)
      .execute()) as Array<{ id: string; door_no: number; kind: AdventRewardKind }>;
    const openedDoorIds = new Set(
      existing.length
        ? (
            await trx
              .selectFrom('advent_rewards')
              .select('door_id')
              .where(
                'door_id',
                'in',
                existing.map((d) => d.id),
              )
              .groupBy('door_id')
              .execute()
          ).map((r) => r.door_id)
        : [],
    );

    for (const d of input.doors) {
      const prev = existing.find((e) => e.door_no === d.doorNo);
      if (prev && prev.kind !== d.kind && openedDoorIds.has(prev.id)) {
        throw new AppError(409, 'DOOR_IN_USE', `Door ${d.doorNo} was already opened; its kind can't change.`);
      }
      const row = {
        day_label: d.dayLabel,
        unlock_at: d.unlockAt,
        flash_until: d.flashUntil ?? null,
        kind: d.kind,
        title: d.title,
        subtitle: d.subtitle ?? '',
        terms: JSON.stringify(d.terms ?? []),
        value_cop: d.valueCop ?? null,
        stamps: d.stamps ?? null,
        url: d.url ?? null,
        valid_from: d.validFrom ?? null,
        valid_to: d.validTo ?? null,
        config: JSON.stringify(d.config ?? {}),
      };
      if (prev) await trx.updateTable('advent_doors').set(row).where('id', '=', prev.id).execute();
      else await trx.insertInto('advent_doors').values({ ...row, calendar_id: calendar.id, door_no: d.doorNo }).execute();
    }
    const keep = new Set(input.doors.map((d) => d.doorNo));
    for (const e of existing) {
      if (keep.has(e.door_no)) continue;
      if (openedDoorIds.has(e.id)) throw new AppError(409, 'DOOR_IN_USE', `Door ${e.door_no} was already opened; it can't be removed.`);
      await trx.deleteFrom('advent_doors').where('id', '=', e.id).execute();
    }
    return { calendarId: calendar.id, doors: input.doors.length };
  });

/** Opens and redemptions per door, for the owner. */
export const adventSummary = async (db: Executor, ownerId: string) => {
  const loaded = await loadCalendar(db, ownerId);
  if (!loaded) return null;
  const counts = await db
    .selectFrom('advent_rewards')
    .select([
      'door_id',
      sql<number>`count(*)::int`.as('opened'),
      sql<number>`count(*) filter (where status = 'redeemed')::int`.as('redeemed'),
    ])
    .where('owner_id', '=', ownerId)
    .groupBy('door_id')
    .execute();
  const byDoor = new Map(counts.map((c) => [c.door_id, c]));
  const eligible = await db
    .selectFrom('customers')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('owner_id', '=', ownerId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('transactions')
          .innerJoin('issued_cards', 'issued_cards.id', 'transactions.card_id')
          .select('transactions.id')
          .whereRef('issued_cards.customer_id', '=', 'customers.id')
          .where('transactions.type', '=', 'stamp_add'),
      ),
    )
    .executeTakeFirst();
  return {
    year: loaded.calendar.year,
    eligibleCustomers: eligible?.n ?? 0,
    doors: loaded.doors.map((d) => ({
      no: d.door_no,
      dayLabel: d.day_label,
      kind: d.kind,
      title: d.title,
      opened: byDoor.get(d.id)?.opened ?? 0,
      redeemed: byDoor.get(d.id)?.redeemed ?? 0,
    })),
  };
};
