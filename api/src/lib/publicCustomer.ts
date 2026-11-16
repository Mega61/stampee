// The customer's permanent public link (migration 0018). A public URL id is
// either the customer's public_id or any of her cards' unique_id (links sent
// before 0018); both resolve to the same customer, and the page shows her
// current card. See docs/ADVENT_PLAN.md §0.
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { AppError } from './errors.js';
import { normalizeSlug } from './slug.js';
import type { IssuedCardRow } from './dto.js';

type Executor = Kysely<Database> | Transaction<Database>;

export interface PublicOwner {
  id: string;
  slug: string | null;
  business_name: string | null;
}

export interface PublicCustomer {
  id: string;
  name: string;
  public_id: string;
  mobile: string | null;
}

export interface ResolvedPublicCustomer {
  owner: PublicOwner;
  customer: PublicCustomer;
  /** Every card of the customer, newest first. */
  cards: IssuedCardRow[];
  /** The card the page shows: newest Active, else newest. Null if she has none. */
  current: IssuedCardRow | null;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Card not found.');

/**
 * The card the customer sees and the CRM stamps: the newest Active card
 * (same rule as the CRM's planStamps), else the newest card so a redeemed
 * one still shows its reward. `cards` must be sorted newest first.
 */
export const pickCurrentCard = (cards: IssuedCardRow[]): IssuedCardRow | null =>
  cards.find((c) => c.status === 'Active') ?? cards[0] ?? null;

export const findPublicOwner = async (db: Executor, rawSlug: string): Promise<PublicOwner> => {
  const owner = await db
    .selectFrom('profiles')
    .select(['id', 'slug', 'business_name'])
    .where('slug', '=', normalizeSlug(rawSlug))
    .where('role', '=', 'owner')
    .executeTakeFirst();
  if (!owner) throw notFound();
  return owner;
};

/** Resolves /:slug/:id to the customer and her cards. 404 when nothing matches. */
export const resolvePublicCustomer = async (
  db: Executor,
  rawSlug: string,
  id: string,
): Promise<ResolvedPublicCustomer> => {
  const owner = await findPublicOwner(db, rawSlug);

  let customer = (await db
    .selectFrom('customers')
    .select(['id', 'name', 'public_id', 'mobile'])
    .where('owner_id', '=', owner.id)
    .where('public_id', '=', id)
    .executeTakeFirst()) as PublicCustomer | undefined;

  if (!customer) {
    const card = await db
      .selectFrom('issued_cards')
      .select('customer_id')
      .where('owner_id', '=', owner.id)
      .where('unique_id', '=', id)
      .executeTakeFirst();
    if (card) {
      customer = (await db
        .selectFrom('customers')
        .select(['id', 'name', 'public_id', 'mobile'])
        .where('id', '=', card.customer_id)
        .where('owner_id', '=', owner.id)
        .executeTakeFirst()) as PublicCustomer | undefined;
    }
  }
  if (!customer) throw notFound();

  const cards = (await db
    .selectFrom('issued_cards')
    .selectAll()
    .where('customer_id', '=', customer.id)
    .where('owner_id', '=', owner.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute()) as IssuedCardRow[];

  return { owner, customer, cards, current: pickCurrentCard(cards) };
};
