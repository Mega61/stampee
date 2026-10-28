// Per-pass notification budget (Google: 3 notifying updates/messages per pass
// per 24 h). Every decision is logged in wallet_notifications; the `notified`
// rows of the last 24 h are what's been spent. Claims are serialized per pass
// with an advisory lock so two syncs can't both take the last slot.
import { sql } from 'kysely';
import { db } from '../../db/kysely.js';
import type { WalletNotificationKind } from '../../db/types.js';
import { DAILY_NOTIFY_BUDGET, NOTIFY_RESERVE } from './passContent.js';

export type Provider = 'google' | 'apple';
export type ClaimResult = { outcome: 'notify' | 'silent'; id: string } | { outcome: 'duplicate' };

/**
 * Decides whether a notification of `kind` may ring on this pass and records
 * the decision. `duplicate` when `dedupeKey` was already used for this pass.
 * With `allowNotify: false` it only records a silent row (e.g. a lower-priority
 * candidate in a sync where something else already notified).
 */
export const claimNotification = async (params: {
  cardId: string;
  provider: Provider;
  kind: WalletNotificationKind;
  dedupeKey?: string | null;
  message?: Record<string, unknown> | null;
  now?: Date;
}): Promise<ClaimResult> =>
  db.transaction().execute(async (trx) => {
    const now = params.now ?? new Date();
    await sql`select pg_advisory_xact_lock(hashtext(${`wallet_notify:${params.provider}:${params.cardId}`}))`.execute(trx);
    const spent = await trx
      .selectFrom('wallet_notifications')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('card_id', '=', params.cardId)
      .where('provider', '=', params.provider)
      .where('notified', '=', true)
      .where('created_at', '>', new Date(now.getTime() - 24 * 60 * 60 * 1000))
      .executeTakeFirst();
    const notify = Number(spent?.n ?? 0) + NOTIFY_RESERVE[params.kind] < DAILY_NOTIFY_BUDGET;
    const inserted = await trx
      .insertInto('wallet_notifications')
      .values({
        card_id: params.cardId,
        provider: params.provider,
        kind: params.kind,
        notified: notify,
        dedupe_key: params.dedupeKey ?? null,
        message: params.message ?? null,
        created_at: now,
      })
      .onConflict((oc) => oc.columns(['card_id', 'provider', 'dedupe_key']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return { outcome: 'duplicate' as const };
    return { outcome: notify ? ('notify' as const) : ('silent' as const), id: String(inserted.id) };
  });

/** Forget a claim whose delivery failed, so it doesn't count against the budget. */
export const releaseNotification = async (id: string) => {
  await db.deleteFrom('wallet_notifications').where('id', '=', id).execute();
};
