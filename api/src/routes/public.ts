import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import {
  toCampaignDtoSigned,
  toTransactionDto,
  signTemplateSnapshot,
  parseBody,
  type CampaignRow,
  type IssuedCardRow,
  type TransactionRow,
} from '../lib/dto.js';
import { normalizeSlug } from '../lib/slug.js';
import { signedReadUrl } from '../storage/gcs.js';

const PublicSignupBody = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: z.string().trim().max(254).optional().nullable(),
  mobile: z.string().trim().max(50).optional().nullable(),
});

type SignupOutcome = {
  outcome: 'issued' | 'redirect_existing' | 'campaign_disabled_no_existing' | 'error';
  uniqueId?: string;
  error?: string;
};

// Per-route rate limits. Public surface is the obvious abuse vector, so we
// tighten beyond the global 300/min in server.ts.
const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const PUBLIC_POST_SIGNUP = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

export const publicRoutes: FastifyPluginAsync = async (app) => {
  // GET /public/cards/:slug/:uniqueId — anonymous loyalty-card view.
  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId',
    PUBLIC_GET,
    async (req) => {
      const slug = normalizeSlug(req.params.slug);
      const owner = await db
        .selectFrom('profiles')
        .select(['id', 'slug', 'business_name'])
        .where('slug', '=', slug)
        .where('role', '=', 'owner')
        .executeTakeFirst();
      if (!owner) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      const card = (await db
        .selectFrom('issued_cards')
        .selectAll()
        .where('unique_id', '=', req.params.uniqueId)
        .where('owner_id', '=', owner.id)
        .executeTakeFirst()) as IssuedCardRow | undefined;
      if (!card) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      const customer = await db
        .selectFrom('customers')
        .select(['id', 'name'])
        .where('id', '=', card.customer_id)
        .executeTakeFirst();
      if (!customer) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      let campaign: Awaited<ReturnType<typeof toCampaignDtoSigned>> | null = null;
      if (card.campaign_id) {
        const campaignRow = (await db
          .selectFrom('campaigns')
          .selectAll()
          .where('id', '=', card.campaign_id)
          .executeTakeFirst()) as CampaignRow | undefined;
        if (campaignRow) campaign = await toCampaignDtoSigned(campaignRow, signedReadUrl);
      }

      const history = (await db
        .selectFrom('transactions')
        .selectAll()
        .where('card_id', '=', card.id)
        .orderBy('timestamp', 'asc')
        .execute()) as TransactionRow[];

      const templateSnapshot = await signTemplateSnapshot(card.template_snapshot, signedReadUrl);

      return {
        ok: true,
        data: {
          card: {
            id: card.id,
            uniqueId: card.unique_id,
            campaignId: card.campaign_id,
            campaignName: card.campaign_name,
            stamps: card.stamps,
            lastVisit: card.last_visit,
            status: card.status,
            completedDate: card.completed_date ?? undefined,
            templateSnapshot,
            history: history.map(toTransactionDto),
          },
          customer: { id: customer.id, name: customer.name },
          campaign,
        },
      };
    },
  );

  // GET /public/scan/:slug/:uniqueId — staff scans a card with no session yet;
  // tells the SPA where to redirect them to log in.
  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/scan/:slug/:uniqueId',
    PUBLIC_GET,
    async (req) => {
      const slug = normalizeSlug(req.params.slug);
      const owner = await db
        .selectFrom('profiles')
        .select(['id', 'slug', 'business_name'])
        .where('slug', '=', slug)
        .where('role', '=', 'owner')
        .executeTakeFirst();
      if (!owner) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      const card = await db
        .selectFrom('issued_cards')
        .select('unique_id')
        .where('unique_id', '=', req.params.uniqueId)
        .where('owner_id', '=', owner.id)
        .executeTakeFirst();
      if (!card) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      return {
        ok: true,
        data: {
          owner: {
            id: owner.id,
            slug: owner.slug,
            businessName: owner.business_name,
          },
          card: { uniqueId: card.unique_id },
        },
      };
    },
  );

  // GET /public/signup/:slug/:campaignId — context for the public signup page.
  // Returns the campaign even if disabled so the SPA can render the right state.
  app.get<{ Params: { slug: string; campaignId: string } }>(
    '/public/signup/:slug/:campaignId',
    PUBLIC_GET,
    async (req) => {
      const slug = normalizeSlug(req.params.slug);
      const owner = await db
        .selectFrom('profiles')
        .select(['id', 'slug', 'business_name'])
        .where('slug', '=', slug)
        .where('role', '=', 'owner')
        .executeTakeFirst();
      if (!owner) throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');

      const campaign = await db
        .selectFrom('campaigns')
        .select(['id', 'name', 'is_enabled'])
        .where('id', '=', req.params.campaignId)
        .where('owner_id', '=', owner.id)
        .executeTakeFirst();
      if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');

      return {
        ok: true,
        data: {
          owner: {
            id: owner.id,
            slug: owner.slug,
            businessName: owner.business_name,
          },
          campaign: {
            id: campaign.id,
            name: campaign.name,
            isEnabled: campaign.is_enabled,
          },
        },
      };
    },
  );

  // POST /public/signup/:slug/:campaignId — atomic public customer signup.
  // Body { name, email?, mobile? } — at least one of email/mobile recommended
  // but the DB function tolerates both being null.
  app.post<{ Params: { slug: string; campaignId: string } }>(
    '/public/signup/:slug/:campaignId',
    PUBLIC_POST_SIGNUP,
    async (req) => {
      const body = parseBody(PublicSignupBody, req.body);
      const slug = normalizeSlug(req.params.slug);
      const result = await sql<{ register_public_campaign_signup: SignupOutcome }>`
        select loyalty.register_public_campaign_signup(
          ${slug}::text,
          ${req.params.campaignId}::text,
          ${body.name}::text,
          ${body.email ?? null}::text,
          ${body.mobile ?? null}::text
        )
      `.execute(db);
      const outcome = result.rows[0]?.register_public_campaign_signup;
      if (!outcome) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Signup failed.');
      }
      if (outcome.outcome === 'error') {
        // 404 when the business/campaign cannot be resolved, 400 otherwise.
        const status = outcome.error?.includes('not found') ? 404 : 400;
        throw new AppError(status, 'SIGNUP_FAILED', outcome.error ?? 'Signup failed.');
      }
      return { ok: true, data: outcome };
    },
  );
};
