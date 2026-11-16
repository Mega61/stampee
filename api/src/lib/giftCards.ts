// Gift cards ("tarjetas regalo"): fixed-amount cards, used whole in one
// visit. The routes (routes/giftCards.ts, routes/publicGifts.ts) are thin;
// the lifecycle lives here so in-process callers (e.g. a promotion that
// issues cards) get the same rules:
//
//   pending_payment ──activate──▶ active ──redeem──▶ redeemed
//          │                       │  ◀──unredeem──┘
//          └──────── void ◀────────┘
//
// 'expired' is never stored: it is derived (active and valid_to before today
// in America/Bogota). funded=true cards were sold (money already booked at
// sale time); funded=false cards are promotional (a discount at redemption).
import { randomInt } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { Database, GiftCardEventType, GiftCardSource, GiftCardStatus, GiftCardsTable } from '../db/types.js';
import { env } from '../config.js';
import { AppError } from './errors.js';
import { onCardChanged } from './cardEvents.js';
import { giftStampToCustomer, type GiftActor, type GiftStampResult } from './giftStamps.js';

export type Executor = Kysely<Database> | Transaction<Database>;
export type GiftCardRow = Selectable<GiftCardsTable>;
export type GiftCardEffectiveStatus = GiftCardStatus | 'expired';

export interface GiftCardRules {
  recipient?: 'any' | 'new_or_dormant';
  giverStampOnRedeem?: boolean;
  buyerStampOnPaid?: boolean;
  ref?: string;
}

export const GIFT_TIME_ZONE = 'America/Bogota';
export const DEFAULT_VALIDITY_DAYS = 365;

// ---------------------------------------------------------------- dates

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: GIFT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) of an instant in Bogota. */
export const bogotaDate = (at: Date = new Date()): string => dayFormatter.format(at);

/** YYYY-MM-DD plus n calendar days. */
export const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** SQL: today's date in Bogota (the DB clock, so list filters match the DTO). */
export const sqlBogotaToday = sql<string>`(now() at time zone 'America/Bogota')::date`;

export const effectiveStatus = (
  card: Pick<GiftCardRow, 'status' | 'valid_to'>,
  today: string = bogotaDate(),
): GiftCardEffectiveStatus =>
  card.status === 'active' && card.valid_to !== null && card.valid_to < today ? 'expired' : card.status;

// ---------------------------------------------------------------- codes / phones

// Crockford base32 without I, L, O, U.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const generateGiftCode = (): string => {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `TR-${raw.slice(0, 4)}-${raw.slice(4)}`;
};

/**
 * Normalize a code typed by a person: case, spaces and dashes don't matter,
 * and the Crockford look-alikes (O→0, I/L→1) are folded. Anything that is not
 * a TR code comes back trimmed and upper-cased.
 */
export const normalizeGiftCode = (input: string): string => {
  const compact = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (compact.length === 10 && compact.startsWith('TR')) {
    const body = compact.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
    return `TR-${body.slice(0, 4)}-${body.slice(4)}`;
  }
  return input.trim().toUpperCase();
};

/** Phones match on their last 10 digits ("+57 300…", "300…", "57300…"). */
export const phoneKey = (value: string) => value.replace(/\D+/g, '').slice(-10);

const sqlPhoneKey = (column: string) =>
  sql`right(regexp_replace(coalesce(${sql.ref(column)}, ''), '[^0-9]+', '', 'g'), 10)`;

// ---------------------------------------------------------------- helpers

export const publicBaseFor = (slug: string | null | undefined): string | null =>
  slug ? `${env.APP_PUBLIC_URL.replace(/\/+$/, '')}/${slug}/regalo` : null;

const ownerSlug = async (db: Executor, ownerId: string) =>
  (await db.selectFrom('profiles').select('slug').where('id', '=', ownerId).executeTakeFirst())?.slug ?? null;

export const logGiftEvent = async (
  db: Executor,
  giftCardId: string,
  type: GiftCardEventType,
  data: Record<string, unknown> = {},
  actorName: string | null = null,
) => {
  await db.insertInto('gift_card_events').values({ gift_card_id: giftCardId, type, data, actor_name: actorName }).execute();
};

/**
 * Find the owner's customer by phone (last 10 digits) or create one. Returns
 * null when the phone has too few digits to be a real number.
 */
export const upsertCustomerByPhone = async (
  db: Executor,
  ownerId: string,
  params: { name: string; phone: string },
): Promise<string | null> => {
  const key = phoneKey(params.phone);
  if (key.length < 7) return null;
  const existing = await db
    .selectFrom('customers')
    .select('id')
    .where('owner_id', '=', ownerId)
    .where(sqlPhoneKey('mobile'), '=', key)
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (existing) return existing.id;
  const created = await db
    .insertInto('customers')
    .values({ owner_id: ownerId, name: params.name.trim() || 'Cliente', email: '', mobile: params.phone.trim(), status: 'Active' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
};

const inTransaction = async <T>(db: Executor, fn: (trx: Executor) => Promise<T>): Promise<T> =>
  db.isTransaction ? fn(db) : (db as Kysely<Database>).transaction().execute(fn);

const findForUpdate = async (trx: Executor, ownerId: string, where: { id?: string; code?: string }) => {
  let q = trx.selectFrom('gift_cards').selectAll().where('owner_id', '=', ownerId);
  if (where.id !== undefined) q = q.where('id', '=', where.id);
  if (where.code !== undefined) q = q.where('code', '=', normalizeGiftCode(where.code));
  const row = (await q.forUpdate().executeTakeFirst()) as GiftCardRow | undefined;
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Gift card not found.');
  return row;
};

const rulesOf = (row: Pick<GiftCardRow, 'rules'>): GiftCardRules => (row.rules ?? {}) as GiftCardRules;

/** Validity of a card's tier, or the default when the tier is gone. */
const validityDaysFor = async (db: Executor, row: Pick<GiftCardRow, 'tier_id'>) => {
  if (!row.tier_id) return DEFAULT_VALIDITY_DAYS;
  const tier = await db.selectFrom('gift_card_tiers').select('validity_days').where('id', '=', row.tier_id).executeTakeFirst();
  return tier?.validity_days ?? DEFAULT_VALIDITY_DAYS;
};

// ---------------------------------------------------------------- issue

export interface IssueGiftCardInput {
  ownerId: string;
  buyerCustomerId: string | null;
  buyerName?: string;
  buyerPhone?: string;
  amountCop: number;
  tierId?: string | null;
  source: GiftCardSource;
  funded: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  minTicketCop?: number | null;
  transferable?: boolean;
  rules?: GiftCardRules;
  message?: string;
  recipientName?: string | null;
  externalRef?: string | null;
  status?: 'pending_payment' | 'active';
  /** Audit trail only. */
  actorName?: string | null;
}

export interface IssueGiftCardResult {
  giftCardId: string;
  code: string;
  amountCop: number;
  validTo: string | null;
  transferable: boolean;
  publicUrl: string | null;
  status: GiftCardStatus;
}

const toIssueResult = (row: GiftCardRow, base: string | null): IssueGiftCardResult => ({
  giftCardId: row.id,
  code: row.code,
  amountCop: row.amount_cop,
  validTo: row.valid_to,
  transferable: row.transferable,
  publicUrl: base ? `${base}/${row.unique_id}` : null,
  status: row.status,
});

/**
 * Issue a gift card. Idempotent on (ownerId, externalRef): a second call with
 * the same ref returns the card issued the first time. Default status is
 * 'active' for promotional cards (funded=false) and 'pending_payment' for sold
 * ones. An active card gets valid_from = today (Bogota) and valid_to =
 * valid_from + the tier's validity days unless given.
 */
export const issueGiftCard = async (
  db: Executor,
  input: IssueGiftCardInput,
): Promise<IssueGiftCardResult> => {
  if (!Number.isInteger(input.amountCop) || input.amountCop <= 0) {
    throw new AppError(400, 'VALIDATION', 'amountCop: must be a positive integer.');
  }
  const base = publicBaseFor(await ownerSlug(db, input.ownerId));
  const externalRef = input.externalRef?.trim() || null;

  const findByRef = async () =>
    externalRef
      ? ((await db
          .selectFrom('gift_cards')
          .selectAll()
          .where('owner_id', '=', input.ownerId)
          .where('external_ref', '=', externalRef)
          .executeTakeFirst()) as GiftCardRow | undefined)
      : undefined;

  const existing = await findByRef();
  if (existing) return toIssueResult(existing, base);

  let tierName = '';
  let validityDays = DEFAULT_VALIDITY_DAYS;
  if (input.tierId) {
    const tier = await db
      .selectFrom('gift_card_tiers')
      .select(['name', 'validity_days'])
      .where('id', '=', input.tierId)
      .where('owner_id', '=', input.ownerId)
      .executeTakeFirst();
    if (!tier) throw new AppError(404, 'TIER_NOT_FOUND', 'Gift card tier not found.');
    tierName = tier.name;
    validityDays = tier.validity_days;
  }

  const status = input.status ?? (input.funded ? 'pending_payment' : 'active');
  let validFrom = input.validFrom ?? null;
  let validTo = input.validTo ?? null;
  if (status === 'active') {
    validFrom = validFrom ?? bogotaDate();
    validTo = validTo ?? addDays(validFrom, validityDays);
  }

  // A fresh code collides with ~0 probability (32^8), but retry anyway. ON
  // CONFLICT DO NOTHING keeps a caller's transaction usable on a collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = (await db
      .insertInto('gift_cards')
      .values({
        owner_id: input.ownerId,
        code: generateGiftCode(),
        tier_id: input.tierId ?? null,
        tier_name: tierName,
        amount_cop: input.amountCop,
        status,
        funded: input.funded,
        source: input.source,
        buyer_customer_id: input.buyerCustomerId,
        buyer_name: input.buyerName?.trim() ?? '',
        buyer_phone: input.buyerPhone?.trim() ?? '',
        recipient_name: input.recipientName?.trim() || null,
        message: input.message?.trim() ?? '',
        valid_from: validFrom,
        valid_to: validTo,
        min_ticket_cop: input.minTicketCop ?? null,
        transferable: input.transferable ?? true,
        rules: { ...(input.rules ?? {}) },
        external_ref: externalRef,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst()) as GiftCardRow | undefined;
    if (row) {
      await logGiftEvent(db, row.id, 'created', { source: row.source, funded: row.funded, status: row.status, amountCop: row.amount_cop }, input.actorName ?? null);
      return toIssueResult(row, base);
    }
    // Lost a race on external_ref: the other insert won, return its card.
    const raced = await findByRef();
    if (raced) return toIssueResult(raced, base);
  }
  throw new AppError(500, 'INTERNAL_ERROR', 'Could not generate a unique gift card code.');
};

// ---------------------------------------------------------------- activate

export interface ActivateInput {
  paidAt: Date;
  method: 'efectivo' | 'transferencia' | 'otro';
  paidAmountCop: number;
  paidRef?: string | null;
}

/**
 * pending_payment → active. Idempotent: an active card with the same paidRef
 * is returned as is. Fires rules.buyerStampOnPaid (one gift stamp to the
 * buyer's newest active loyalty card).
 */
export const activateGiftCard = async (
  db: Executor,
  ownerId: string,
  id: string,
  input: ActivateInput,
  actor: GiftActor,
): Promise<{ card: GiftCardRow; buyerStamp: GiftStampResult | null }> => {
  const out = await inTransaction(db, async (trx) => {
    const row = await findForUpdate(trx, ownerId, { id });
    const paidRef = input.paidRef?.trim() || null;
    if (row.status === 'active' && row.paid_at && paidRef !== null && row.paid_ref === paidRef) {
      return { card: row, buyerStamp: null };
    }
    if (row.status !== 'pending_payment') {
      throw new AppError(409, row.status === 'active' ? 'ALREADY_ACTIVE' : 'NOT_PENDING', `Gift card is ${row.status}.`);
    }
    const validFrom = bogotaDate(input.paidAt);
    const validTo = addDays(validFrom, await validityDaysFor(trx, row));
    const card = (await trx
      .updateTable('gift_cards')
      .set({
        status: 'active',
        paid_at: input.paidAt,
        paid_method: input.method,
        paid_amount_cop: input.paidAmountCop,
        paid_ref: paidRef,
        valid_from: validFrom,
        valid_to: validTo,
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as GiftCardRow;

    let buyerStamp: GiftStampResult | null = null;
    if (rulesOf(card).buyerStampOnPaid && card.buyer_customer_id) {
      buyerStamp = await giftStampToCustomer(trx, {
        ownerId,
        customerId: card.buyer_customer_id,
        remarks: `Tarjeta regalo ${card.code}`,
        actor,
      });
    }
    await logGiftEvent(
      trx,
      card.id,
      'paid',
      { method: input.method, paidAmountCop: input.paidAmountCop, paidRef, validFrom, validTo, ...(buyerStamp ? { buyerStamp } : {}) },
      actor.name,
    );
    return { card, buyerStamp };
  });
  if (out.buyerStamp && out.buyerStamp.added > 0) onCardChanged(out.buyerStamp.cardId, 'gift', out.buyerStamp.added);
  return out;
};

// ---------------------------------------------------------------- redeem

export interface RedeemInput {
  code: string;
  externalRef: string;
  amountUsedCop: number;
  customer?: { name: string; phone: string } | null;
  /** Visit date (YYYY-MM-DD, Bogota). Defaults to today. */
  date?: string;
}

/**
 * active → redeemed (single use). Idempotent on externalRef: the same ref is
 * OK, a different one is 409 ALREADY_REDEEMED. Links the client to the card
 * and fires rules.giverStampOnRedeem (once per card, ever).
 */
export const redeemGiftCard = async (
  db: Executor,
  ownerId: string,
  input: RedeemInput,
  actor: GiftActor,
): Promise<{ card: GiftCardRow; alreadyRedeemed: boolean; giverStamp: GiftStampResult | null }> => {
  const externalRef = input.externalRef.trim();
  const out = await inTransaction(db, async (trx) => {
    const row = await findForUpdate(trx, ownerId, { code: input.code });
    if (row.status === 'redeemed') {
      if (row.redeemed_ref === externalRef) return { card: row, alreadyRedeemed: true, giverStamp: null };
      throw new AppError(409, 'ALREADY_REDEEMED', 'Gift card was already used.');
    }
    if (row.status === 'pending_payment') throw new AppError(409, 'NOT_PAID', 'Gift card payment is not confirmed yet.');
    if (row.status === 'void') throw new AppError(409, 'VOID', 'Gift card was voided.');

    const date = input.date ?? bogotaDate();
    if (row.valid_from && date < row.valid_from) throw new AppError(409, 'NOT_YET_VALID', `Gift card is valid from ${row.valid_from}.`);
    if (row.valid_to && date > row.valid_to) throw new AppError(409, 'EXPIRED', `Gift card expired on ${row.valid_to}.`);
    if (input.amountUsedCop > row.amount_cop) {
      throw new AppError(400, 'VALIDATION', 'amountUsedCop: cannot exceed the card amount.');
    }

    let recipientCustomerId = row.recipient_customer_id;
    if (input.customer) {
      recipientCustomerId = (await upsertCustomerByPhone(trx, ownerId, input.customer)) ?? recipientCustomerId;
    }

    const card = (await trx
      .updateTable('gift_cards')
      .set({
        status: 'redeemed',
        redeemed_at: new Date(),
        redeemed_ref: externalRef,
        redeemed_amount_cop: input.amountUsedCop,
        recipient_customer_id: recipientCustomerId,
        recipient_name: row.recipient_name ?? input.customer?.name.trim() ?? null,
        recipient_phone: row.recipient_phone ?? input.customer?.phone.trim() ?? null,
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as GiftCardRow;

    let giverStamp: GiftStampResult | null = null;
    if (rulesOf(card).giverStampOnRedeem && card.buyer_customer_id) {
      // Redeem → unredeem → redeem must not stamp the giver twice.
      const already = await trx
        .selectFrom('gift_card_events')
        .select('id')
        .where('gift_card_id', '=', card.id)
        .where('type', '=', 'redeemed')
        .where(sql`coalesce((data->'giverStamp'->>'added')::int, 0)`, '>', 0)
        .executeTakeFirst();
      if (!already) {
        giverStamp = await giftStampToCustomer(trx, {
          ownerId,
          customerId: card.buyer_customer_id,
          remarks: `Tarjeta regalo ${card.code}`,
          actor,
        });
      }
    }
    await logGiftEvent(
      trx,
      card.id,
      'redeemed',
      { externalRef, amountUsedCop: input.amountUsedCop, date, recipientCustomerId, ...(giverStamp ? { giverStamp } : {}) },
      actor.name,
    );
    return { card, alreadyRedeemed: false, giverStamp };
  });
  if (out.giverStamp && out.giverStamp.added > 0) onCardChanged(out.giverStamp.cardId, 'gift', out.giverStamp.added);
  return out;
};

/**
 * redeemed → active, only when redeemed_ref matches (a panel account was
 * edited or reopened). Already active = no-op (safe to retry a compensation).
 */
export const unredeemGiftCard = async (
  db: Executor,
  ownerId: string,
  code: string,
  externalRef: string,
  actor: GiftActor,
): Promise<{ card: GiftCardRow; changed: boolean }> =>
  inTransaction(db, async (trx) => {
    const row = await findForUpdate(trx, ownerId, { code });
    const ref = externalRef.trim();
    if (row.status === 'active') return { card: row, changed: false };
    if (row.status !== 'redeemed') throw new AppError(409, 'NOT_REDEEMED', `Gift card is ${row.status}.`);
    if (row.redeemed_ref !== ref) throw new AppError(409, 'REF_MISMATCH', 'Gift card was redeemed by another reference.');
    const card = (await trx
      .updateTable('gift_cards')
      .set({ status: 'active', redeemed_at: null, redeemed_ref: null, redeemed_amount_cop: null })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as GiftCardRow;
    await logGiftEvent(trx, card.id, 'unredeemed', { externalRef: ref }, actor.name);
    return { card, changed: true };
  });

// ---------------------------------------------------------------- void / edit / recipient

export const voidGiftCard = async (
  db: Executor,
  ownerId: string,
  id: string,
  reason: string,
  actor: GiftActor,
): Promise<GiftCardRow> =>
  inTransaction(db, async (trx) => {
    const row = await findForUpdate(trx, ownerId, { id });
    if (row.status === 'void') return row;
    if (row.status === 'redeemed') throw new AppError(409, 'ALREADY_REDEEMED', 'A redeemed gift card cannot be voided.');
    const card = (await trx
      .updateTable('gift_cards')
      .set({ status: 'void', voided_at: new Date(), void_reason: reason })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as GiftCardRow;
    await logGiftEvent(trx, card.id, 'voided', { reason, previousStatus: row.status }, actor.name);
    return card;
  });

export interface UpdateGiftCardInput {
  recipientName?: string | null;
  recipientPhone?: string | null;
  message?: string;
  validTo?: string;
}

export const updateGiftCard = async (
  db: Executor,
  ownerId: string,
  id: string,
  input: UpdateGiftCardInput,
  actor: GiftActor,
): Promise<GiftCardRow> =>
  inTransaction(db, async (trx) => {
    const row = await findForUpdate(trx, ownerId, { id });
    const set: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};
    if (input.recipientName !== undefined) set['recipient_name'] = input.recipientName?.trim() || null;
    if (input.recipientPhone !== undefined) set['recipient_phone'] = input.recipientPhone?.trim() || null;
    if (input.message !== undefined) set['message'] = input.message.trim();
    if (input.validTo !== undefined) {
      if (row.valid_from && input.validTo < row.valid_from) {
        throw new AppError(400, 'VALIDATION', 'validTo: cannot be before validFrom.');
      }
      set['valid_to'] = input.validTo;
    }
    for (const [k, v] of Object.entries(set)) {
      const before = row[k as keyof GiftCardRow];
      if (before !== v) changes[k] = { from: before ?? null, to: v };
    }
    if (Object.keys(changes).length === 0) return row;
    const card = (await trx
      .updateTable('gift_cards')
      .set(set)
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as GiftCardRow;
    await logGiftEvent(trx, card.id, 'updated', changes, actor.name);
    return card;
  });

/** Public: the link holder names the recipient once (pending or active cards only). */
export const setRecipientOnce = async (db: Executor, ownerId: string, uniqueId: string, name: string): Promise<GiftCardRow> =>
  inTransaction(db, async (trx) => {
    const row = (await trx
      .selectFrom('gift_cards')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .where('unique_id', '=', uniqueId)
      .forUpdate()
      .executeTakeFirst()) as GiftCardRow | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Gift card not found.');
    if (row.recipient_name) throw new AppError(409, 'RECIPIENT_ALREADY_SET', 'This gift already has a recipient.');
    if (row.status !== 'pending_payment' && row.status !== 'active') {
      throw new AppError(409, 'NOT_EDITABLE', `Gift card is ${row.status}.`);
    }
    if (effectiveStatus(row) === 'expired') throw new AppError(409, 'NOT_EDITABLE', 'Gift card expired.');
    const card = (await trx
      .updateTable('gift_cards')
      .set({ recipient_name: name })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as GiftCardRow;
    await logGiftEvent(trx, card.id, 'recipient_set', { name, via: 'public' }, null);
    return card;
  });

// ---------------------------------------------------------------- DTO

const iso = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export const toGiftCardDto = (r: GiftCardRow, publicBase: string | null, today: string = bogotaDate()) => ({
  id: r.id,
  uniqueId: r.unique_id,
  code: r.code,
  amountCop: r.amount_cop,
  status: r.status,
  effectiveStatus: effectiveStatus(r, today),
  funded: r.funded,
  source: r.source,
  tierId: r.tier_id,
  tierName: r.tier_name,
  buyerCustomerId: r.buyer_customer_id,
  buyerName: r.buyer_name,
  buyerPhone: r.buyer_phone,
  recipientName: r.recipient_name,
  recipientPhone: r.recipient_phone,
  recipientCustomerId: r.recipient_customer_id,
  message: r.message,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  minTicketCop: r.min_ticket_cop,
  transferable: r.transferable,
  rules: rulesOf(r),
  paidAt: iso(r.paid_at),
  paidMethod: r.paid_method,
  paidAmountCop: r.paid_amount_cop,
  paidRef: r.paid_ref,
  redeemedAt: iso(r.redeemed_at),
  redeemedRef: r.redeemed_ref,
  redeemedAmountCop: r.redeemed_amount_cop,
  voidedAt: iso(r.voided_at),
  voidReason: r.void_reason,
  externalRef: r.external_ref,
  publicUrl: publicBase ? `${publicBase}/${r.unique_id}` : null,
  terms: giftCardTerms(r),
  createdAt: iso(r.created_at)!,
});

export type GiftCardDto = ReturnType<typeof toGiftCardDto>;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

const copFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/**
 * The card's terms, in Spanish, as shown to the holder. Single source for the
 * public /regalo page and for integrations (the advent "Mis regalos").
 */
export const giftCardTerms = (r: Pick<GiftCardRow, 'min_ticket_cop' | 'funded' | 'transferable' | 'rules'>): string[] => {
  const rules = rulesOf(r as GiftCardRow);
  const terms = [
    'Se usa completa en una sola visita. Presenta el código al pagar.',
    'Si el servicio cuesta más, pagas la diferencia con otro medio. Si cuesta menos, el saldo no se devuelve.',
  ];
  if (r.min_ticket_cop) terms.push(`Aplica en servicios desde ${copFormatter.format(r.min_ticket_cop)}.`);
  if (rules.recipient === 'new_or_dormant') terms.push('Es para alguien que aún no conoce el estudio o que no viene hace un tiempo.');
  if (!r.funded) terms.push('Es un beneficio promocional: no se acumula con otras promociones.');
  if (!r.transferable) terms.push('Es personal: solo la puede usar quien la recibió.');
  terms.push('No se cambia por dinero.');
  return terms;
};

// ---------------------------------------------------------------- per customer

/** Public-safe card shape (no phones, no customer ids, no payment refs). */
export const toPublicGiftCardDto = (r: GiftCardRow, publicBase: string | null, today: string = bogotaDate()) => ({
  id: r.id,
  uniqueId: r.unique_id,
  code: r.code,
  amountCop: r.amount_cop,
  tierName: r.tier_name,
  effectiveStatus: effectiveStatus(r, today),
  funded: r.funded,
  source: r.source,
  buyerFirstName: firstName(r.buyer_name),
  recipientName: r.recipient_name,
  message: r.message,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  minTicketCop: r.min_ticket_cop,
  transferable: r.transferable,
  terms: giftCardTerms(r),
  publicUrl: publicBase ? `${publicBase}/${r.unique_id}` : null,
});

export type CustomerGiftCard = ReturnType<typeof toPublicGiftCardDto> & { role: 'buyer' | 'recipient' };

/**
 * A customer's gift cards (as buyer or as recipient), void excluded, newest
 * first. When the same customer is both, the role is 'buyer'.
 */
export const listGiftCardsForCustomer = async (
  db: Executor,
  ownerId: string,
  customerId: string,
): Promise<CustomerGiftCard[]> => {
  const rows = (await db
    .selectFrom('gift_cards')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', '!=', 'void')
    .where((eb) => eb.or([eb('buyer_customer_id', '=', customerId), eb('recipient_customer_id', '=', customerId)]))
    .orderBy('created_at', 'desc')
    .execute()) as GiftCardRow[];
  if (rows.length === 0) return [];
  const base = publicBaseFor(await ownerSlug(db, ownerId));
  const today = bogotaDate();
  return rows.map((r) => ({
    ...toPublicGiftCardDto(r, base, today),
    role: r.buyer_customer_id === customerId ? ('buyer' as const) : ('recipient' as const),
  }));
};
