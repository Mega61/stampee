// OWNER: agent A.
// POST /public/cards/:slug/:uniqueId/views — engagement beacon, one row per
// card-open session (docs/CARD_ENGAGEMENT_PLAN.md §4.2).
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { parseBody } from '../lib/dto.js';
import { normalizeSlug } from '../lib/slug.js';
import { CardViewBody } from '../schemas/engagement.js';

// The client pings at mount and again on pagehide, so 30/min/IP is plenty.
const PUBLIC_BEACON = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registered without fastify-plugin, so this parser override is encapsulated
// to this plugin and the rest of the API keeps Fastify's default text/plain.
export const publicViewsRoutes: FastifyPluginAsync = async (app) => {
  // navigator.sendBeacon can only send a JSON string as text/plain without
  // triggering a CORS preflight, so parse it as JSON here. Unparseable input
  // falls through as the raw string and fails zod validation with a 400.
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, body);
    }
  });

  app.post<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/views',
    { ...PUBLIC_BEACON, bodyLimit: 4096 },
    async (req, reply) => {
      const body = parseBody(CardViewBody, req.body);
      if (!UUID_RE.test(req.params.uniqueId)) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      const card = await db
        .selectFrom('issued_cards')
        .innerJoin('profiles', 'profiles.id', 'issued_cards.owner_id')
        .select(['issued_cards.id', 'issued_cards.owner_id'])
        .where('profiles.slug', '=', normalizeSlug(req.params.slug))
        .where('profiles.role', '=', 'owner')
        .where('issued_cards.unique_id', '=', req.params.uniqueId)
        .executeTakeFirst();
      if (!card) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      // Start ping + final ping share a session id: keep the first source and
      // variant, and the max of the counters (pings can arrive out of order).
      await db
        .insertInto('card_views')
        .values({
          card_id: card.id,
          owner_id: card.owner_id,
          session_id: body.sessionId,
          source: body.source,
          variant: body.variant,
          duration_ms: body.durationMs,
          interactions: body.interactions,
          saw_new_stamps: body.sawNewStamps,
        })
        .onConflict((oc) =>
          oc.columns(['card_id', 'session_id']).doUpdateSet({
            duration_ms: sql<number>`greatest(card_views.duration_ms, excluded.duration_ms)`,
            interactions: sql<number>`greatest(card_views.interactions, excluded.interactions)`,
            saw_new_stamps: sql<boolean>`card_views.saw_new_stamps or excluded.saw_new_stamps`,
          }),
        )
        .execute();

      return reply.code(204).send();
    },
  );
};
