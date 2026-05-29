import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { db } from '../db/kysely.js';
import { env } from '../config.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, verifyHash } from '../lib/passwords.js';
import { signAccessToken, type AccessClaims } from '../lib/jwt.js';
import {
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
} from '../lib/cookies.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { normalizeSlug, isSlugValid } from '../lib/slug.js';
import { requireUser } from '../middleware/requireUser.js';
import { email } from '../email/index.js';
import { verifyTemplate } from '../email/templates/verify.js';
import { resetTemplate } from '../email/templates/reset.js';
import {
  SignupBody,
  LoginBody,
  StaffLoginBody,
  ForgotPasswordBody,
  ResetPasswordBody,
  ChangePasswordBody,
  ResendVerificationBody,
  VerifyEmailQuery,
} from '../schemas/auth.js';

// ---------- helpers ----------

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

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

const loadProfile = async (userId: string): Promise<ProfileRow | null> => {
  const row = await db
    .selectFrom('profiles')
    .selectAll()
    .where('id', '=', userId)
    .executeTakeFirst();
  return (row as ProfileRow | undefined) ?? null;
};

const loadOwnerScope = async (claims: AccessClaims): Promise<ProfileRow | null> => {
  if (claims.role === 'owner') return loadProfile(claims.sub);
  return loadProfile(claims.ownerScopeId);
};

const loadStaffAccounts = async (ownerId: string): Promise<ProfileRow[]> => {
  const rows = await db
    .selectFrom('profiles')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('role', '=', 'staff')
    .execute();
  return rows as ProfileRow[];
};

// Issue NEW (first-time) auth cookies — creates a new refresh-token family.
const issueNewSession = async (
  reply: FastifyReply,
  req: FastifyRequest,
  profile: ProfileRow,
) => {
  const claims: AccessClaims = {
    sub: profile.id,
    email: profile.email,
    role: profile.role,
    ownerScopeId: profile.role === 'owner' ? profile.id : profile.owner_id ?? profile.id,
  };
  const access = await signAccessToken(claims);
  const refresh = generateToken(32);
  const refreshHash = hashToken(refresh);
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await db
    .insertInto('refresh_tokens')
    .values({
      user_id: profile.id,
      family_id: familyId,
      token_hash: refreshHash,
      user_agent: req.headers['user-agent']?.slice(0, 500) ?? null,
      ip: req.ip ?? null,
      expires_at: expiresAt,
    })
    .execute();

  setAccessCookie(reply, access);
  setRefreshCookie(reply, refresh);
  return claims;
};

// Rotate an existing refresh token: insert new row, mark old revoked + replaced_by.
const rotateSession = async (
  reply: FastifyReply,
  req: FastifyRequest,
  profile: ProfileRow,
  oldRow: { id: string; family_id: string },
) => {
  const claims: AccessClaims = {
    sub: profile.id,
    email: profile.email,
    role: profile.role,
    ownerScopeId: profile.role === 'owner' ? profile.id : profile.owner_id ?? profile.id,
  };
  const access = await signAccessToken(claims);
  const refresh = generateToken(32);
  const refreshHash = hashToken(refresh);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await db.transaction().execute(async (tx) => {
    const inserted = await tx
      .insertInto('refresh_tokens')
      .values({
        user_id: profile.id,
        family_id: oldRow.family_id,
        token_hash: refreshHash,
        user_agent: req.headers['user-agent']?.slice(0, 500) ?? null,
        ip: req.ip ?? null,
        expires_at: expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date(), replaced_by: inserted.id })
      .where('id', '=', oldRow.id)
      .execute();
  });

  setAccessCookie(reply, access);
  setRefreshCookie(reply, refresh);
};

// ---------- routes ----------

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /auth/signup
  app.post('/auth/signup', async (req, _reply) => {
    const body = parse(SignupBody, req.body);
    const slug = normalizeSlug(body.slug);
    if (!isSlugValid(slug)) {
      throw new AppError(400, 'INVALID_SLUG', 'Slug must be 3-30 lowercase letters, numbers, or hyphens.');
    }

    const existingEmail = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (existingEmail) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }

    const existingSlug = await db
      .selectFrom('profiles')
      .select('id')
      .where('slug', '=', slug)
      .where('role', '=', 'owner')
      .executeTakeFirst();
    if (existingSlug) {
      throw new AppError(409, 'SLUG_TAKEN', 'This slug is already taken.');
    }

    const passwordHash = await hashPassword(body.password);
    const token = generateToken(32);
    const tokenHash = hashToken(token);
    const verifyExpiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_SECONDS * 1000);

    await db.transaction().execute(async (tx) => {
      const user = await tx
        .insertInto('users')
        .values({ email: body.email, password_hash: passwordHash })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('profiles')
        .values({
          id: user.id,
          business_name: body.businessName,
          email: body.email,
          slug,
          role: 'owner',
          owner_id: null,
          status: 'unverified',
          access: 'active',
        })
        .execute();
      await tx
        .insertInto('email_verification_tokens')
        .values({ token_hash: tokenHash, user_id: user.id, expires_at: verifyExpiresAt })
        .execute();
    });

    // Email is best-effort — failure here doesn't roll back the account.
    try {
      await email.send(verifyTemplate({ to: body.email, businessName: body.businessName, token }));
    } catch (err) {
      app.log.warn({ err }, 'Failed to send verification email');
    }

    return { ok: true, data: { requiresVerify: true } };
  });

  // GET /auth/verify-email?token=...
  app.get('/auth/verify-email', async (req, reply) => {
    const query = parse(VerifyEmailQuery, req.query);
    const tokenHash = hashToken(query.token);
    const row = await db
      .selectFrom('email_verification_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    const redirectBase = env.APP_PUBLIC_URL.replace(/\/$/, '');
    if (!row || row.expires_at.getTime() < Date.now()) {
      return reply.redirect(`${redirectBase}/login?verified=0`);
    }

    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('users')
        .set({ email_verified_at: new Date() })
        .where('id', '=', row.user_id)
        .execute();
      await tx
        .updateTable('profiles')
        .set({ status: 'verified' })
        .where('id', '=', row.user_id)
        .execute();
      await tx
        .deleteFrom('email_verification_tokens')
        .where('user_id', '=', row.user_id)
        .execute();
    });

    return reply.redirect(`${redirectBase}/login?verified=1`);
  });

  // POST /auth/resend-verification
  app.post('/auth/resend-verification', async (req, _reply) => {
    const body = parse(ResendVerificationBody, req.body ?? {});
    const emailAddress = req.user?.email ?? body.email;
    if (!emailAddress) {
      throw new AppError(400, 'VALIDATION', 'Email is required.');
    }
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'email_verified_at'])
      .where('email', '=', emailAddress)
      .executeTakeFirst();
    // Quiet success even if user not found — no existence leak.
    if (!user || user.email_verified_at) return { ok: true, data: {} };

    const profile = await loadProfile(user.id);
    const token = generateToken(32);
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_SECONDS * 1000);
    await db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom('email_verification_tokens')
        .where('user_id', '=', user.id)
        .execute();
      await tx
        .insertInto('email_verification_tokens')
        .values({ token_hash: tokenHash, user_id: user.id, expires_at: expiresAt })
        .execute();
    });
    try {
      await email.send(
        verifyTemplate({ to: user.email, businessName: profile?.business_name ?? '', token }),
      );
    } catch (err) {
      app.log.warn({ err }, 'Failed to resend verification email');
    }
    return { ok: true, data: {} };
  });

  // POST /auth/login (owner password flow)
  app.post('/auth/login', async (req, reply) => {
    const body = parse(LoginBody, req.body);
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'password_hash'])
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (!user) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    const ok = await verifyHash(body.password, user.password_hash);
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

    const profile = await loadProfile(user.id);
    if (!profile) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    if (profile.role !== 'owner') {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Use the staff login URL to sign in as staff.');
    }
    if (profile.access === 'disabled') {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
    }

    await issueNewSession(reply, req, profile);
    const owner = profile;
    const staffAccounts = await loadStaffAccounts(profile.id);
    return {
      ok: true,
      data: {
        user: toUserDto(profile),
        owner: toUserDto(owner),
        staffAccounts: staffAccounts.map(toUserDto),
      },
    };
  });

  // POST /auth/staff-login (email + PIN + orgId where orgId is the owner's slug)
  app.post('/auth/staff-login', async (req, reply) => {
    const body = parse(StaffLoginBody, req.body);
    const ownerSlug = normalizeSlug(body.orgId);

    const owner = await db
      .selectFrom('profiles')
      .selectAll()
      .where('slug', '=', ownerSlug)
      .where('role', '=', 'owner')
      .executeTakeFirst();
    if (!owner) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email, PIN, or business.');

    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'password_hash'])
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (!user) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email, PIN, or business.');
    const ok = await verifyHash(body.pin, user.password_hash);
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email, PIN, or business.');

    const profile = await loadProfile(user.id);
    if (!profile || profile.role !== 'staff' || profile.owner_id !== owner.id) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email, PIN, or business.');
    }
    if (profile.access === 'disabled') {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
    }

    await issueNewSession(reply, req, profile);
    return {
      ok: true,
      data: {
        user: toUserDto(profile),
        owner: toUserDto(owner as ProfileRow),
        staffAccounts: [] as ReturnType<typeof toUserDto>[],
      },
    };
  });

  // POST /auth/refresh
  app.post('/auth/refresh', async (req, reply) => {
    const cookie = req.cookies['refresh'];
    if (!cookie) throw new AppError(401, 'UNAUTHENTICATED', 'No refresh token.');
    const row = await db
      .selectFrom('refresh_tokens')
      .select(['id', 'user_id', 'family_id', 'revoked_at', 'expires_at'])
      .where('token_hash', '=', hashToken(cookie))
      .executeTakeFirst();
    if (!row || row.revoked_at !== null || row.expires_at.getTime() < Date.now()) {
      // TODO(plan §G.13): add 30-second grace window for cross-tab race.
      clearAuthCookies(reply);
      throw new AppError(401, 'UNAUTHENTICATED', 'Refresh token invalid or expired.');
    }
    const profile = await loadProfile(row.user_id);
    if (!profile || profile.access === 'disabled') {
      clearAuthCookies(reply);
      throw new AppError(401, 'UNAUTHENTICATED', 'Account is no longer accessible.');
    }
    await rotateSession(reply, req, profile, row);
    return { ok: true, data: { user: toUserDto(profile) } };
  });

  // POST /auth/logout — revokes the refresh-token family, clears cookies.
  app.post('/auth/logout', async (req, reply) => {
    const cookie = req.cookies['refresh'];
    if (cookie) {
      const tokenHash = hashToken(cookie);
      const row = await db
        .selectFrom('refresh_tokens')
        .select(['family_id'])
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      if (row) {
        await db
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('family_id', '=', row.family_id)
          .where('revoked_at', 'is', null)
          .execute();
      }
    }
    clearAuthCookies(reply);
    return { ok: true, data: {} };
  });

  // GET /auth/me — returns { user, owner, staffAccounts }
  app.get('/auth/me', async (req, _reply) => {
    const claims = await requireUser(req);
    const profile = await loadProfile(claims.sub);
    if (!profile) throw new AppError(401, 'UNAUTHENTICATED', 'Account not found.');
    if (profile.access === 'disabled') {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
    }
    const owner = await loadOwnerScope(claims);
    const staffAccounts = profile.role === 'owner' ? await loadStaffAccounts(profile.id) : [];
    return {
      ok: true,
      data: {
        user: toUserDto(profile),
        owner: owner ? toUserDto(owner) : null,
        staffAccounts: staffAccounts.map(toUserDto),
      },
    };
  });

  // POST /auth/forgot-password — always returns 200 (no existence leak).
  app.post('/auth/forgot-password', async (req, _reply) => {
    const body = parse(ForgotPasswordBody, req.body);
    const user = await db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (user) {
      const token = generateToken(32);
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);
      await db
        .insertInto('password_reset_tokens')
        .values({ token_hash: tokenHash, user_id: user.id, expires_at: expiresAt })
        .execute();
      try {
        await email.send(resetTemplate({ to: user.email, token }));
      } catch (err) {
        app.log.warn({ err }, 'Failed to send password reset email');
      }
    }
    return { ok: true, data: {} };
  });

  // POST /auth/reset-password { token, newPassword }
  app.post('/auth/reset-password', async (req, _reply) => {
    const body = parse(ResetPasswordBody, req.body);
    const tokenHash = hashToken(body.token);
    const row = await db
      .selectFrom('password_reset_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    if (!row || row.used_at !== null || row.expires_at.getTime() < Date.now()) {
      throw new AppError(400, 'INVALID_TOKEN', 'This reset link is invalid or expired.');
    }
    const passwordHash = await hashPassword(body.newPassword);
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('users')
        .set({ password_hash: passwordHash })
        .where('id', '=', row.user_id)
        .execute();
      await tx
        .updateTable('password_reset_tokens')
        .set({ used_at: new Date() })
        .where('token_hash', '=', tokenHash)
        .execute();
      // Revoke ALL refresh tokens for this user — force re-login everywhere.
      await tx
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', row.user_id)
        .where('revoked_at', 'is', null)
        .execute();
    });
    return { ok: true, data: {} };
  });

  // POST /auth/password — change password while logged in.
  app.post('/auth/password', async (req, reply) => {
    const claims = await requireUser(req);
    const body = parse(ChangePasswordBody, req.body);
    const passwordHash = await hashPassword(body.newPassword);
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('users')
        .set({ password_hash: passwordHash })
        .where('id', '=', claims.sub)
        .execute();
      // Revoke every refresh token except the current one. We don't know
      // which row corresponds to the current cookie without an extra lookup,
      // so simplest: revoke all, then re-issue this session.
      await tx
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', claims.sub)
        .where('revoked_at', 'is', null)
        .execute();
    });
    const profile = await loadProfile(claims.sub);
    if (!profile) {
      clearAuthCookies(reply);
      throw new AppError(401, 'UNAUTHENTICATED', 'Account not found.');
    }
    await issueNewSession(reply, req, profile);
    return { ok: true, data: {} };
  });

  // DELETE /auth/account
  app.delete('/auth/account', async (req, reply) => {
    const claims = await requireUser(req);
    if (claims.role === 'owner') {
      await db.transaction().execute(async (tx) => {
        const staff = await tx
          .selectFrom('profiles')
          .select('id')
          .where('owner_id', '=', claims.sub)
          .where('role', '=', 'staff')
          .execute();
        const ids = [claims.sub, ...staff.map((s) => s.id)];
        await tx.deleteFrom('users').where('id', 'in', ids).execute();
      });
    } else {
      await db.deleteFrom('users').where('id', '=', claims.sub).execute();
    }
    clearAuthCookies(reply);
    return { ok: true, data: {} };
  });
};
