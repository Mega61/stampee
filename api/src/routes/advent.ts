// Advent calendar routes (docs/ADVENT_CONTRACT.md).
//
// Public (the customer's card, by her permanent link or any card id):
//   GET  /public/cards/:slug/:uniqueId/advent
//   POST /public/cards/:slug/:uniqueId/advent/doors/:no/open
// Studio (owner session or API key):
//   GET  /advent/rewards?customerId=&status=available|all
//   POST /advent/rewards/:code/redeem | /unredeem
//   POST /advent/double-stamps        (the CRM, once per qualifying visit)
//   PUT  /advent/calendars/:year      (load the door file)
//   GET  /advent/summary
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { parseBody } from '../lib/dto.js';
import { clock } from '../lib/clock.js';
import { requireRole } from '../middleware/requireRole.js';
import { rejectMalformedUniqueId } from '../lib/uniqueId.js';
import { resolvePublicCustomer } from '../lib/publicCustomer.js';
import {
  adventSummary,
  applyDoubleStamp,
  buildAdventState,
  listStudioRewards,
  openDoor,
  redeemReward,
  unredeemReward,
  upsertCalendar,
} from '../lib/advent.js';

const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const PUBLIC_OPEN = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const instant = z.string().datetime({ offset: true });

const RewardsQuery = z.object({
  customerId: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['available', 'all']).default('available'),
});
const RedeemBody = z.object({
  actorName: z.string().trim().min(1).max(120),
  ticketRef: z.string().trim().max(120).optional().nullable(),
});
const UnredeemBody = z.object({ actorName: z.string().trim().min(1).max(120) });
const DoubleStampBody = z.object({
  customerId: z.string().trim().min(1).max(120),
  visitRef: z.string().trim().min(1).max(120),
  visitDate: day,
});
const CalendarBody = z.object({
  enabled: z.boolean(),
  opensUntil: instant,
  commonTerms: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  doors: z
    .array(
      z.object({
        doorNo: z.number().int().min(1).max(31),
        dayLabel: z.number().int().min(1).max(31),
        unlockAt: instant,
        flashUntil: instant.nullable().optional(),
        kind: z.enum(['coupon', 'bonus_stamps', 'double_stamps', 'link', 'gift_card']),
        title: z.string().trim().min(1).max(120),
        subtitle: z.string().trim().max(240).optional(),
        terms: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
        valueCop: z.number().int().min(0).nullable().optional(),
        stamps: z.number().int().min(1).max(10).nullable().optional(),
        url: z.string().url().nullable().optional(),
        validFrom: day.nullable().optional(),
        validTo: day.nullable().optional(),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(31),
});

const adventOff = () => new AppError(404, 'ADVENT_OFF', 'There is no advent calendar for this card.');

export const adventRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', rejectMalformedUniqueId);

  // ---------------------------------------------------------------- public

  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/advent',
    PUBLIC_GET,
    async (req) => {
      const { owner, customer } = await resolvePublicCustomer(db, req.params.slug, req.params.uniqueId);
      const state = await buildAdventState(db, owner.id, customer.id, clock.now());
      if (!state) throw adventOff();
      return { ok: true, data: state };
    },
  );

  app.post<{ Params: { slug: string; uniqueId: string; no: string } }>(
    '/public/cards/:slug/:uniqueId/advent/doors/:no/open',
    PUBLIC_OPEN,
    async (req) => {
      const doorNo = Number(req.params.no);
      if (!Number.isInteger(doorNo) || doorNo < 1 || doorNo > 31) throw new AppError(404, 'NOT_FOUND', 'Door not found.');
      const { owner, customer, current } = await resolvePublicCustomer(db, req.params.slug, req.params.uniqueId);
      const now = clock.now();
      const opened = await openDoor(db, { ownerId: owner.id, customerId: customer.id, doorNo, cardId: current?.id ?? null, now });
      const state = await buildAdventState(db, owner.id, customer.id, now);
      if (!state) throw adventOff();
      return { ok: true, data: { reward: opened.reward, state, card: opened.card } };
    },
  );

  // ---------------------------------------------------------------- studio

  app.get('/advent/rewards', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const query = parseBody(RewardsQuery, req.query);
    const rewards = await listStudioRewards(db, claims.ownerScopeId, { ...query, now: clock.now() });
    return { ok: true, data: { rewards } };
  });

  app.post<{ Params: { code: string } }>('/advent/rewards/:code/redeem', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const body = parseBody(RedeemBody, req.body);
    const out = await redeemReward(db, {
      ownerId: claims.ownerScopeId,
      code: req.params.code,
      actorName: body.actorName,
      ticketRef: body.ticketRef ?? null,
      now: clock.now(),
    });
    return { ok: true, data: out };
  });

  app.post<{ Params: { code: string } }>('/advent/rewards/:code/unredeem', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const body = parseBody(UnredeemBody, req.body);
    const reward = await unredeemReward(db, { ownerId: claims.ownerScopeId, code: req.params.code, actorName: body.actorName, now: clock.now() });
    return { ok: true, data: { reward } };
  });

  app.post('/advent/double-stamps', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin', 'staff');
    const body = parseBody(DoubleStampBody, req.body);
    const customer = await db
      .selectFrom('customers')
      .select('id')
      .where('id', '=', body.customerId)
      .where('owner_id', '=', claims.ownerScopeId)
      .executeTakeFirst();
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');
    const out = await applyDoubleStamp(db, { ownerId: claims.ownerScopeId, ...body, now: clock.now() });
    return { ok: true, data: out };
  });

  app.put<{ Params: { year: string } }>('/advent/calendars/:year', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 2024 || year > 2100) throw new AppError(400, 'VALIDATION', 'year: invalid.');
    const body = parseBody(CalendarBody, req.body);
    const nos = new Set(body.doors.map((d) => d.doorNo));
    if (nos.size !== body.doors.length) throw new AppError(400, 'VALIDATION', 'doors: duplicate doorNo.');
    const out = await upsertCalendar(db, claims.ownerScopeId, year, body);
    return { ok: true, data: out };
  });

  app.get('/advent/summary', async (req) => {
    const claims = await requireRole(req, 'owner', 'admin');
    const summary = await adventSummary(db, claims.ownerScopeId);
    if (!summary) throw adventOff();
    return { ok: true, data: summary };
  });
};
