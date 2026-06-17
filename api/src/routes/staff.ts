import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { hashPin } from '../lib/passwords.js';
import { requireHuman } from '../middleware/requireRole.js';
import { email } from '../email/index.js';
import { staffWelcomeTemplate } from '../email/templates/staffWelcome.js';
import {
  CreateStaffBody,
  UpdateStaffPinBody,
  UpdateStaffAccessBody,
} from '../schemas/staff.js';

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

// Ensure the staff id belongs to the current owner before any mutation.
const requireOwnedStaff = async (staffId: string, ownerId: string): Promise<ProfileRow> => {
  const row = await db
    .selectFrom('profiles')
    .selectAll()
    .where('id', '=', staffId)
    .where('owner_id', '=', ownerId)
    .where('role', '=', 'staff')
    .executeTakeFirst();
  if (!row) {
    // 404 to avoid leaking existence of other tenants' staff.
    throw new AppError(404, 'NOT_FOUND', 'Staff account not found.');
  }
  return row as ProfileRow;
};

export const staffRoutes: FastifyPluginAsync = async (app) => {
  // GET /staff — list current owner's staff
  app.get('/staff', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const rows = await db
      .selectFrom('profiles')
      .selectAll()
      .where('owner_id', '=', claims.ownerScopeId)
      .where('role', '=', 'staff')
      .orderBy('created_at', 'asc')
      .execute();
    return { ok: true, data: (rows as ProfileRow[]).map(toUserDto) };
  });

  // POST /staff { name, email, pin } — create a staff account
  app.post('/staff', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const body = parse(CreateStaffBody, req.body);

    // Email must be unique across loyalty.users.
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }

    // Resolve the primary owner's profile (for the welcome email's slug).
    const owner = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', claims.ownerScopeId)
      .executeTakeFirstOrThrow();

    const pinHash = await hashPin(body.pin);
    const createdId = await db.transaction().execute(async (tx) => {
      const user = await tx
        .insertInto('users')
        .values({
          email: body.email,
          password_hash: pinHash,
          // Staff accounts skip email verification — owner vouches.
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
          role: 'staff',
          owner_id: claims.ownerScopeId,
          status: 'verified',
          access: 'active',
        })
        .execute();
      return user.id;
    });

    // Welcome email is best-effort (the PIN is shown in the response too).
    try {
      await email.send(
        staffWelcomeTemplate({
          to: body.email,
          staffName: body.name,
          ownerSlug: (owner as ProfileRow).slug ?? '',
          ownerBusinessName: (owner as ProfileRow).business_name,
          pin: body.pin,
        }),
      );
    } catch (err) {
      app.log.warn({ err }, 'Failed to send staff welcome email');
    }

    const created = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', createdId)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toUserDto(created as ProfileRow) };
  });

  // PATCH /staff/:id/pin { pin }
  app.patch<{ Params: { id: string } }>('/staff/:id/pin', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const body = parse(UpdateStaffPinBody, req.body);
    const staff = await requireOwnedStaff(req.params.id, claims.ownerScopeId);
    const pinHash = await hashPin(body.pin);
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('users')
        .set({ password_hash: pinHash })
        .where('id', '=', staff.id)
        .execute();
      // PIN change invalidates existing staff sessions.
      await tx
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', staff.id)
        .where('revoked_at', 'is', null)
        .execute();
    });
    return { ok: true, data: {} };
  });

  // PATCH /staff/:id/access { access }
  app.patch<{ Params: { id: string } }>('/staff/:id/access', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const body = parse(UpdateStaffAccessBody, req.body);
    const staff = await requireOwnedStaff(req.params.id, claims.ownerScopeId);
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('profiles')
        .set({ access: body.access })
        .where('id', '=', staff.id)
        .execute();
      if (body.access === 'disabled') {
        await tx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('user_id', '=', staff.id)
          .where('revoked_at', 'is', null)
          .execute();
      }
    });
    const updated = await db
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', staff.id)
      .executeTakeFirstOrThrow();
    return { ok: true, data: toUserDto(updated as ProfileRow) };
  });

  // DELETE /staff/:id
  app.delete<{ Params: { id: string } }>('/staff/:id', async (req) => {
    const claims = await requireHuman(req, 'owner', 'admin');
    const staff = await requireOwnedStaff(req.params.id, claims.ownerScopeId);
    await db.deleteFrom('users').where('id', '=', staff.id).execute();
    return { ok: true, data: {} };
  });
};
