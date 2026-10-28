import { z } from 'zod';

// Body of POST /public/cards/:slug/:uniqueId/views. Mirrors `CardViewEvent`
// in the SPA's root types.ts.
export const CardViewBody = z.object({
  sessionId: z.string().min(8).max(64),
  source: z.enum(['link', 'pwa', 'wallet', 'whatsapp']),
  variant: z.enum(['fx', 'holdout']),
  durationMs: z.number().int().min(0).max(3_600_000),
  interactions: z.number().int().min(0).max(10_000),
  sawNewStamps: z.boolean(),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Invalid date.');

export const MAX_ENGAGEMENT_RANGE_DAYS = 731;

// GET /analytics/engagement?from&to — inclusive calendar days, America/Bogota.
export const EngagementQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => q.from <= q.to, { message: '`from` must be on or before `to`.', path: ['from'] })
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_ENGAGEMENT_RANGE_DAYS,
    { message: `Range can span at most ${MAX_ENGAGEMENT_RANGE_DAYS} days.`, path: ['to'] },
  );
