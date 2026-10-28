// OWNER: agent G. Weekly scratch game "Raspa y gana" (state + play) and the
// owner's cost estimate — see docs/CARD_ENGAGEMENT_PLAN.md §8.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { parseBody } from '../lib/dto.js';
import { normalizeSlug } from '../lib/slug.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  computeGameState,
  estimateGame,
  GAME_ELIGIBILITY_MS,
  loadGameCampaign,
  playGame,
  type GameCard,
  type GameUnavailableReason,
} from '../lib/game.js';

const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const PUBLIC_PLAY = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

const UNAVAILABLE_MESSAGES: Record<GameUnavailableReason, string> = {
  DISABLED: 'The game is not enabled for this card.',
  HOLDOUT: 'The game is not available for this card yet.',
  NOT_ACTIVE: 'The card is not active.',
  NO_RECENT_VISIT: 'The card needs a visit in the last 60 days to play.',
};

const EstimateQuery = z.object({
  winPct: z.coerce.number().int().min(0).max(100).optional(),
  cap: z.coerce.number().int().min(0).max(100_000).optional(),
});

const resolveOwnerId = async (rawSlug: string) => {
  const owner = await db
    .selectFrom('profiles')
    .select('id')
    .where('slug', '=', normalizeSlug(rawSlug))
    .where('role', '=', 'owner')
    .executeTakeFirst();
  if (!owner) throw new AppError(404, 'NOT_FOUND', 'Card not found.');
  return owner.id;
};

export const publicGameRoutes: FastifyPluginAsync = async (app) => {
  // GET /public/cards/:slug/:uniqueId/game — this week's game state.
  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/game',
    PUBLIC_GET,
    async (req) => {
      const ownerId = await resolveOwnerId(req.params.slug);
      const card = (await db
        .selectFrom('issued_cards')
        .select(['id', 'unique_id', 'owner_id', 'status', 'stamps', 'template_snapshot', 'campaign_id'])
        .where('unique_id', '=', req.params.uniqueId)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst()) as (GameCard & { campaign_id: string | null }) | undefined;
      if (!card) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      const campaign = await loadGameCampaign(db, card.campaign_id, ownerId);
      return { ok: true, data: await computeGameState(db, card, campaign) };
    },
  );

  // POST /public/cards/:slug/:uniqueId/game/play — the server decides the
  // result (§8.3); the ticket only animates it. Idempotent per card and week.
  app.post<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/game/play',
    PUBLIC_PLAY,
    async (req, reply) => {
      const ownerId = await resolveOwnerId(req.params.slug);
      const outcome = await playGame(db, ownerId, req.params.uniqueId);
      if (outcome.ok) return { ok: true, data: outcome.result };
      if (outcome.reason === 'NOT_FOUND') throw new AppError(404, 'NOT_FOUND', 'Card not found.');
      return reply.status(409).send({
        ok: false,
        error: {
          code: 'GAME_UNAVAILABLE',
          message: UNAVAILABLE_MESSAGES[outcome.reason],
          reason: outcome.reason,
        },
      });
    },
  );

  // GET /campaigns/:id/game-estimate?winPct=&cap= — owner preview of what the
  // game costs per month (§8.4). Query params let the editor preview unsaved
  // settings; they default to the campaign's current values.
  app.get<{ Params: { id: string } }>('/campaigns/:id/game-estimate', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const query = parseBody(EstimateQuery, req.query);
    const campaign = await db
      .selectFrom('campaigns')
      .select(['id', 'total_stamps', 'game_win_pct', 'game_monthly_cap'])
      .where('id', '=', req.params.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');

    const since = Date.now() - GAME_ELIGIBILITY_MS;
    const row = await db
      .selectFrom('issued_cards')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('campaign_id', '=', campaign.id)
      .where('owner_id', '=', claims.ownerScopeId)
      .where('status', '=', 'Active')
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom('transactions')
            .select('transactions.id')
            .whereRef('transactions.card_id', '=', 'issued_cards.id')
            .where('transactions.type', '=', 'stamp_add')
            .where('transactions.timestamp', '>=', since),
        ),
      )
      .executeTakeFirst();

    return {
      ok: true,
      data: estimateGame({
        eligibleCards: Number(row?.count ?? 0),
        winPct: query.winPct ?? campaign.game_win_pct,
        cap: query.cap ?? campaign.game_monthly_cap,
        totalStamps: campaign.total_stamps,
      }),
    };
  });
};
