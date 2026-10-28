// Pass saved to / removed from a wallet (wallet_pass_events, 0017).
// Google: class save/delete callbacks. Apple: PassKit device register /
// unregister (one per device, so a pass on iPhone + Watch saves twice).
import { db } from '../../db/kysely.js';

export const recordPassEvent = async (params: {
  cardId: string;
  provider: 'google' | 'apple';
  event: 'save' | 'delete';
  /** Google's nonce: duplicate deliveries are ignored. */
  nonce?: string | null;
}): Promise<boolean> => {
  const row = await db
    .insertInto('wallet_pass_events')
    .values({ card_id: params.cardId, provider: params.provider, event: params.event, nonce: params.nonce || null })
    .onConflict((oc) => oc.columns(['provider', 'nonce']).doNothing())
    .returning('id')
    .executeTakeFirst();
  return Boolean(row);
};
