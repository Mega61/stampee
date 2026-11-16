// Gift cards — anonymous surface (the link the buyer shares). No phones ever
// leave this file; the code is shown because the holder needs it to redeem.
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { parseBody } from '../lib/dto.js';
import { normalizeSlug } from '../lib/slug.js';
import { rejectMalformedUniqueId } from '../lib/uniqueId.js';
import { publicImageUrl } from './publicImages.js';
import { effectiveStatus, firstName, giftCardTerms, logGiftEvent, setRecipientOnce, type GiftCardRow } from '../lib/giftCards.js';
import { PublicRecipientBody } from '../schemas/giftCards.js';

const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const PUBLIC_POST = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

/** At most one 'viewed' event per card per window (stats, not analytics). */
export const VIEW_THROTTLE_MINUTES = 30;

const findOwner = async (rawSlug: string) => {
  const owner = await db
    .selectFrom('profiles')
    .select(['id', 'slug', 'business_name'])
    .where('slug', '=', normalizeSlug(rawSlug))
    .where('role', '=', 'owner')
    .executeTakeFirst();
  if (!owner) throw new AppError(404, 'NOT_FOUND', 'Gift card not found.');
  return owner;
};

/** The business logo: the newest enabled campaign that has one (profiles carry no logo). */
const businessLogo = async (ownerId: string) => {
  const row = await db
    .selectFrom('campaigns')
    .select('logo_image')
    .where('owner_id', '=', ownerId)
    .where('logo_image', 'is not', null)
    .where('logo_image', '!=', '')
    .orderBy('is_enabled', 'desc')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return (await publicImageUrl(row?.logo_image ?? null)) ?? null;
};

const toPublicGift = async (
  card: GiftCardRow,
  owner: { id: string; slug: string | null; business_name: string },
) => {
  const tier = card.tier_id
    ? await db.selectFrom('gift_card_tiers').select('design').where('id', '=', card.tier_id).executeTakeFirst()
    : undefined;
  return {
    code: card.code,
    amountCop: card.amount_cop,
    tierName: card.tier_name,
    effectiveStatus: effectiveStatus(card),
    funded: card.funded,
    source: card.source,
    buyerFirstName: firstName(card.buyer_name),
    recipientName: card.recipient_name,
    message: card.message,
    validFrom: card.valid_from,
    validTo: card.valid_to,
    minTicketCop: card.min_ticket_cop,
    terms: giftCardTerms(card),
    business: { name: owner.business_name, logo: await businessLogo(owner.id), slug: owner.slug },
    design: tier?.design ?? null,
  };
};

export const publicGiftRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', rejectMalformedUniqueId);

  // GET /public/gift-tiers/:slug — enabled tiers, for the landing's order form.
  app.get<{ Params: { slug: string } }>('/public/gift-tiers/:slug', PUBLIC_GET, async (req) => {
    const owner = await findOwner(req.params.slug);
    const rows = await db
      .selectFrom('gift_card_tiers')
      .select(['id', 'name', 'amount_cop', 'description', 'validity_days', 'design'])
      .where('owner_id', '=', owner.id)
      .where('is_enabled', '=', true)
      .orderBy('sort', 'asc')
      .orderBy('amount_cop', 'asc')
      .execute();
    return {
      ok: true,
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        amountCop: t.amount_cop,
        description: t.description,
        validityDays: t.validity_days,
        design: t.design ?? null,
      })),
    };
  });

  // GET /public/gift/:slug/:uniqueId — the gift page. Logs a throttled 'viewed'.
  app.get<{ Params: { slug: string; uniqueId: string } }>('/public/gift/:slug/:uniqueId', PUBLIC_GET, async (req) => {
    const owner = await findOwner(req.params.slug);
    const card = (await db
      .selectFrom('gift_cards')
      .selectAll()
      .where('owner_id', '=', owner.id)
      .where('unique_id', '=', req.params.uniqueId)
      .executeTakeFirst()) as GiftCardRow | undefined;
    if (!card) throw new AppError(404, 'NOT_FOUND', 'Gift card not found.');

    const recent = await db
      .selectFrom('gift_card_events')
      .select('id')
      .where('gift_card_id', '=', card.id)
      .where('type', '=', 'viewed')
      .where('created_at', '>', sql<Date>`now() - make_interval(mins => ${VIEW_THROTTLE_MINUTES})`)
      .executeTakeFirst();
    if (!recent) await logGiftEvent(db, card.id, 'viewed');

    return { ok: true, data: await toPublicGift(card, owner) };
  });

  // POST /public/gift/:slug/:uniqueId/recipient { name } — once, while the card
  // is pending or active. 409 when already named.
  app.post<{ Params: { slug: string; uniqueId: string } }>(
    '/public/gift/:slug/:uniqueId/recipient',
    PUBLIC_POST,
    async (req) => {
      const body = parseBody(PublicRecipientBody, req.body);
      const owner = await findOwner(req.params.slug);
      const card = await setRecipientOnce(db, owner.id, req.params.uniqueId, body.name, body.phone);
      return { ok: true, data: await toPublicGift(card, owner) };
    },
  );
};
