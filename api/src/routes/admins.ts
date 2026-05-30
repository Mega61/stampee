import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { requireRole } from '../middleware/requireRole.js';
import { CreateAdminBody, UpdateAdminAccessBody } from '../schemas/admins.js';

const parse = <T>(schema: { parse: (input: unknown) => T }, input: unknown): T => {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.errors[0];
      throw new AppError(400, 'VALIDATION', first?.message ?? 'Invalid request body.');
    }
    throw err;
  }
};

type ProfileRow = {
  id: string;
  business_name: string;
  email: string;
  slug: string | null;
  role: 'owner' | 'staff' | 'admin';
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

// Ensure the admin id belongs to the current owner before any mutation.
const requireOwnedAdmin = async (adminId: string, ownerId: string): Promise<ProfileRow> => {
  const row = await db
    .selectFrom('profiles')
    .selectAll()
    .where('id', '=', adminId)
    .where('owner_id', '=', ownerId)
    .where('role', '=', 'admin')
    .executeTakeFirst();
  if (!row) {
    // 404 to avoid leaking existence of other tenants' admins.
    throw new AppError(404, 'NOT_FOUND', 'Admin account not found.');
  }
  return row as ProfileRow;
};

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // GET /admins — list current owner's co-admins (owner only)
  app.get('/admins', async (req) => {
    const claims = await requireRole(req, 'owner');
    const rows = await db
      .selectFrom('profiles')
      .selectAll()
      .where('owner_id', '=', claims.sub)
      .where('role', '=', 'admin')
      .orderBy('created_at', 'asc')
      .execute();
    return { ok: true, data: (rows as ProfileRow[]).map(toUserDto) };
  });

  // POST /admins { name, email } — invite a co-admin (owner only)
  app.post('/admins', async (req) => {
    const claims = await requireRole(req, 'owner');
    const body = parse(CreateAdminBody, req.body);

    // Email must be unique across loyalty.users.
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }

    const createdId = await db.transaction().execute(async (tx) => {
      const user = await tx
        .insertInto('users')
        .values({
          email: body.email,
          // Admins authenticate via Google only — no password set. The invite
          // pre-creates the user so Google SSO links by email on first sign-in.
          email_verified_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('profiles')
        .values({
          id: user.id,
          business_name: body.name,
          email: body.email,
          slug: null,
          role: 'admin',
          owner_id: claims.sub,
          status: 'verified',
          access: 'active',
        })
        .execute();
      return user.id;
    });

    const created = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', createdId)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toUserDto(created as ProfileRow) };
  });

  // PATCH /admins/:id/access { access } — enable/disable a co-admin (owner only)
  app.patch<{ Params: { id: string } }>('/admins/:id/access', async (req) => {
    const claims = await requireRole(req, 'owner');
    const body = parse(UpdateAdminAccessBody, req.body);
    const admin = await requireOwnedAdmin(req.params.id, claims.sub);
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('profiles')
        .set({ access: body.access })
        .where('id', '=', admin.id)
        .execute();
      if (body.access === 'disabled') {
        await tx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('user_id', '=', admin.id)
          .where('revoked_at', 'is', null)
          .execute();
      }
    });
    const updated = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', admin.id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toUserDto(updated as ProfileRow) };
  });

  // DELETE /admins/:id (owner only)
  app.delete<{ Params: { id: string } }>('/admins/:id', async (req) => {
    const claims = await requireRole(req, 'owner');
    const admin = await requireOwnedAdmin(req.params.id, claims.sub);
    await db.deleteFrom('users').where('id', '=', admin.id).execute();
    return { ok: true, data: {} };
  });
};
