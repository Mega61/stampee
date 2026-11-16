// Gift stamps: stamps handed out without a visit (win-back campaigns, gift
// cards). The guard lives here so every caller behaves the same way:
//   - only Active cards get stamps ('REDEEMED' otherwise),
//   - a gift never completes a card: at least one stamp is always left to
//     earn with a real visit ('NEARLY_FULL' when nothing fits),
//   - recorded as type 'gift' (never 'stamp_add') so analytics never count
//     it as a visit.
// Callers run it inside their own transaction and call onCardChanged for
// each result with added > 0 once that transaction commits.
import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { AccessClaims } from './jwt.js';

export type Executor = Kysely<Database> | Transaction<Database>;

export interface GiftActor {
  id: string | null;
  name: string | null;
  role: string;
}

export interface GiftStampResult {
  cardId: string;
  added: number;
  stamps: number;
  reason?: 'REDEEMED' | 'UNKNOWN_TOTAL' | 'NEARLY_FULL' | 'NOT_FOUND' | 'NO_ACTIVE_CARD';
}

/** Who to credit an activity row to. API keys have no profile: attribute to the key. */
export const resolveActor = async (db: Executor, claims: AccessClaims): Promise<GiftActor> => {
  if (claims.role === 'api') return { id: null, name: `API: ${claims.email}`, role: claims.role };
  const actor = await db
    .selectFrom('profiles')
    .select('business_name')
    .where('id', '=', claims.sub)
    .executeTakeFirst();
  return { id: claims.sub, name: actor?.business_name ?? null, role: claims.role };
};

const activityDate = (now: Date) =>
  now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

/** Adds up to `stamps` to each card (locked FOR UPDATE), never completing one. */
export const giftStampsToCards = async (
  trx: Executor,
  params: { ownerId: string; cardIds: string[]; stamps: number; remarks?: string | null; actor: GiftActor; now?: Date },
): Promise<GiftStampResult[]> => {
  const cardIds = Array.from(new Set(params.cardIds));
  if (cardIds.length === 0) return [];
  const now = params.now ?? new Date();
  const date = activityDate(now);

  const cards = await trx
    .selectFrom('issued_cards')
    .leftJoin('campaigns', 'campaigns.id', 'issued_cards.campaign_id')
    .select([
      'issued_cards.id as id',
      'issued_cards.stamps as stamps',
      'issued_cards.status as status',
      'issued_cards.template_snapshot as snapshot',
      'campaigns.total_stamps as campaignTotal',
    ])
    .where('issued_cards.id', 'in', cardIds)
    .where('issued_cards.owner_id', '=', params.ownerId)
    .forUpdate('issued_cards')
    .execute();

  const out: GiftStampResult[] = [];
  for (const card of cards) {
    // The card's own snapshot is what the customer sees, so it wins.
    const snapshotTotal = Number((card.snapshot as Record<string, unknown> | null)?.['totalStamps']);
    const total = Number.isFinite(snapshotTotal) && snapshotTotal > 0 ? snapshotTotal : card.campaignTotal;
    if (card.status !== 'Active') {
      out.push({ cardId: card.id, added: 0, stamps: card.stamps, reason: 'REDEEMED' });
      continue;
    }
    if (!total) {
      out.push({ cardId: card.id, added: 0, stamps: card.stamps, reason: 'UNKNOWN_TOTAL' });
      continue;
    }
    const added = Math.max(0, Math.min(params.stamps, total - 1 - card.stamps));
    if (added === 0) {
      out.push({ cardId: card.id, added: 0, stamps: card.stamps, reason: 'NEARLY_FULL' });
      continue;
    }
    const stamps = card.stamps + added;
    await trx.updateTable('issued_cards').set({ stamps }).where('id', '=', card.id).execute();
    await trx
      .insertInto('transactions')
      .values({
        id: randomUUID(),
        card_id: card.id,
        type: 'gift',
        amount: added,
        date,
        timestamp: now.getTime(),
        title: 'Gift Stamps',
        remarks: params.remarks ?? null,
        actor_id: params.actor.id,
        actor_name: params.actor.name,
        actor_role: params.actor.role,
      })
      .execute();
    out.push({ cardId: card.id, added, stamps });
  }
  const found = new Set(cards.map((c) => c.id));
  for (const id of cardIds) {
    if (!found.has(id)) out.push({ cardId: id, added: 0, stamps: 0, reason: 'NOT_FOUND' });
  }
  return out;
};

/** Gift stamp to a customer's newest Active card (same guard as giftStampsToCards). */
export const giftStampToCustomer = async (
  trx: Executor,
  params: { ownerId: string; customerId: string; stamps?: number; remarks?: string | null; actor: GiftActor; now?: Date },
): Promise<GiftStampResult> => {
  const card = await trx
    .selectFrom('issued_cards')
    .select('id')
    .where('owner_id', '=', params.ownerId)
    .where('customer_id', '=', params.customerId)
    .where('status', '=', 'Active')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!card) return { cardId: '', added: 0, stamps: 0, reason: 'NO_ACTIVE_CARD' };
  const [result] = await giftStampsToCards(trx, {
    ownerId: params.ownerId,
    cardIds: [card.id],
    stamps: params.stamps ?? 1,
    remarks: params.remarks,
    actor: params.actor,
    now: params.now,
  });
  return result!;
};
