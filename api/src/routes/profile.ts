import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { requireUser } from '../middleware/requireUser.js';
import { normalizeSlug, isSlugValid } from '../lib/slug.js';
import { UpdateProfileBody, SlugQuery, BySlugQuery } from '../schemas/profile.js';

const parse = <T>(schema: { parse: (input: unknown) => T }, input: unknown): T => {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.errors[0];
      throw new AppError(400, 'VALIDATION', first?.message ?? 'Invalid request.');
    }
    throw err;
  }
};

type ProfileRow = {
  id: string;
  business_name: string;
  email: string;
  slug: string | null;
  role: 'owner' | 'staff';
  owner_id: string | null;
  status: 'unverified' | 'verified';
  access: 'active' | 'disabled';
  created_at: Date | string;
};

const toUserDto = (p: ProfileRow) => ({
  id: p.id,
  email: p.email,
  businessName: p.business_name,
  slug: p.slug,
  role: p.role,
  ownerId: p.owner_id,
  status: p.status,
  access: p.access,
  createdAt: p.created_at instanceof Date ? p.created_at.toISOString() : p.created_at,
});

export const profileRoutes: FastifyPluginAsync = async (app) => {
  // GET /profile (any signed-in user)
  app.get('/profile', async (req) => {
    const claims = await requireUser(req);
    const row = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', claims.sub)
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
    return { ok: true, data: toUserDto(row as ProfileRow) };
  });

  // PATCH /profile { businessName?, email?, slug? }
  app.patch('/profile', async (req) => {
    const claims = await requireUser(req);
    const body = parse(UpdateProfileBody, req.body);

    const current = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', claims.sub)
      .executeTakeFirst();
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
    const profile = current as ProfileRow;

    // Staff cannot change their slug (they don't have one to begin with).
    if (body.slug !== undefined && profile.role !== 'owner') {
      throw new AppError(403, 'FORBIDDEN', 'Only owners can change the business slug.');
    }

    const profileUpdates: Record<string, unknown> = {};
    if (body.businessName !== undefined) profileUpdates['business_name'] = body.businessName;

    let newEmail: string | undefined;
    if (body.email !== undefined && body.email !== profile.email) {
      const taken = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', body.email)
        .where('id', '!=', claims.sub)
        .executeTakeFirst();
      if (taken) throw new AppError(409, 'EMAIL_TAKEN', 'That email is already in use.');
      newEmail = body.email;
      profileUpdates['email'] = body.email;
    }

    let newSlug: string | undefined;
    if (body.slug !== undefined) {
      const normalized = normalizeSlug(body.slug);
      if (!isSlugValid(normalized)) {
        throw new AppError(400, 'INVALID_SLUG', 'Slug must be 3-30 lowercase letters, numbers, or hyphens.');
      }
      if (normalized !== profile.slug) {
        const taken = await db
          .selectFrom('profiles')
          .select('id')
          .where('slug', '=', normalized)
          .where('role', '=', 'owner')
          .where('id', '!=', claims.sub)
          .executeTakeFirst();
        if (taken) throw new AppError(409, 'SLUG_TAKEN', 'That slug is already taken.');
        newSlug = normalized;
        profileUpdates['slug'] = normalized;
      }
    }

    await db.transaction().execute(async (tx) => {
      if (newEmail) {
        await tx.updateTable('users').set({ email: newEmail }).where('id', '=', claims.sub).execute();
      }
      if (Object.keys(profileUpdates).length > 0) {
        await tx
          .updateTable('profiles')
          .set(profileUpdates)
          .where('id', '=', claims.sub)
          .execute();
      }
    });

    const updated = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', claims.sub)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toUserDto(updated as ProfileRow) };
  });

  // GET /profile/by-slug?slug=... (public)
  app.get('/profile/by-slug', async (req) => {
    const query = parse(BySlugQuery, req.query);
    const normalized = normalizeSlug(query.slug);
    const row = await db
      .selectFrom('profiles')
      .select(['id', 'slug', 'business_name'])
      .where('slug', '=', normalized)
      .where('role', '=', 'owner')
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Business not found.');
    return {
      ok: true,
      data: {
        id: row.id,
        slug: row.slug,
        businessName: row.business_name,
      },
    };
  });

  // GET /slug/available?slug=... (auth)
  app.get('/slug/available', async (req) => {
    await requireUser(req);
    const query = parse(SlugQuery, req.query);
    const normalized = normalizeSlug(query.slug);
    if (!isSlugValid(normalized)) {
      return { ok: true, data: { available: false, reason: 'invalid_format' as const } };
    }
    const taken = await db
      .selectFrom('profiles')
      .select('id')
      .where('slug', '=', normalized)
      .where('role', '=', 'owner')
      .executeTakeFirst();
    return { ok: true, data: { available: !taken } };
  });
};
