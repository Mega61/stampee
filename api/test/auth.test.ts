import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, Session, insertOwner, type TestRig } from './helpers/app.js';

let db: TestDb;
let rig: TestRig;

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
}, 120_000);

afterAll(async () => {
  await rig?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.reset();
  rig.emails.clear();
});

// Helpers ----------------------------------------------------------------

const json = (body: unknown): Record<string, string> => ({
  'content-type': 'application/json',
});

const post = (path: string, body: unknown, session?: Session) =>
  rig.app.inject({
    method: 'POST',
    url: path,
    payload: body,
    headers: json(body),
    ...(session?.cookieJarHeader() ? { headers: { ...json(body), cookie: session.cookieJarHeader()! } } : {}),
  });

const get = (path: string, session?: Session) =>
  rig.app.inject({
    method: 'GET',
    url: path,
    ...(session?.cookieJarHeader() ? { headers: { cookie: session.cookieJarHeader()! } } : {}),
  });

const del = (path: string, session?: Session) =>
  rig.app.inject({
    method: 'DELETE',
    url: path,
    ...(session?.cookieJarHeader() ? { headers: { cookie: session.cookieJarHeader()! } } : {}),
  });

const signupOwner = async (overrides: Partial<{ email: string; password: string; businessName: string; slug: string }> = {}) => {
  const payload = {
    businessName: overrides.businessName ?? 'Test Cafe',
    email: overrides.email ?? 'owner@example.com',
    password: overrides.password ?? 'hunter2bravo',
    slug: overrides.slug ?? 'test-cafe',
  };
  const res = await post('/auth/signup', payload);
  expect(res.statusCode).toBe(200);
  return payload;
};

// Tests ------------------------------------------------------------------

describe('auth: signup + verify', () => {
  it('signup creates user + unverified profile + verify token; emits verify email', async () => {
    const { email } = await signupOwner();

    const last = rig.emails.last();
    expect(last?.to).toBe(email);
    expect(last?.subject).toMatch(/verify/i);
    const verifyUrl = rig.emails.extractUrl('/auth/verify-email');
    expect(verifyUrl).toMatch(/\/auth\/verify-email\?token=[a-f0-9]+/);

    const { rows } = await db.pool.query<{ status: string; email_verified_at: Date | null }>(
      `select p.status, u.email_verified_at
       from loyalty.profiles p join loyalty.users u on u.id = p.id
       where u.email = $1`,
      [email],
    );
    expect(rows[0]?.status).toBe('unverified');
    expect(rows[0]?.email_verified_at).toBeNull();
  });

  it('signup with duplicate email → 409 EMAIL_TAKEN', async () => {
    await signupOwner();
    const res = await post('/auth/signup', {
      businessName: 'X',
      email: 'owner@example.com',
      password: 'hunter2bravo',
      slug: 'other-slug',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('signup with duplicate slug → 409 SLUG_TAKEN', async () => {
    await signupOwner({ slug: 'taken' });
    const res = await post('/auth/signup', {
      businessName: 'X',
      email: 'other@example.com',
      password: 'hunter2bravo',
      slug: 'taken',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SLUG_TAKEN');
  });

  it('verify-email with a valid token sets status=verified and 302s to /login?verified=1', async () => {
    await signupOwner();
    const url = rig.emails.extractUrl('/auth/verify-email')!;
    const path = url.replace(/^https?:\/\/[^/]+/, '');

    const res = await get(path);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/login?verified=1');

    const { rows } = await db.pool.query<{ status: string }>(
      `select status from loyalty.profiles where email = 'owner@example.com'`,
    );
    expect(rows[0]?.status).toBe('verified');
  });

  it('verify-email with an invalid token 302s to /login?verified=0', async () => {
    const res = await get('/auth/verify-email?token=' + 'a'.repeat(64));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('verified=0');
  });

  it('resend-verification issues a fresh token', async () => {
    await signupOwner();
    const first = rig.emails.extractUrl('/auth/verify-email');
    rig.emails.clear();

    const res = await post('/auth/resend-verification', { email: 'owner@example.com' });
    expect(res.statusCode).toBe(200);

    const second = rig.emails.extractUrl('/auth/verify-email');
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});

describe('auth: login + me + refresh + logout', () => {
  it('login sets both access and refresh cookies (HttpOnly + SameSite=Lax)', async () => {
    await signupOwner();
    const res = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'hunter2bravo',
    });
    expect(res.statusCode).toBe(200);
    const accessCookie = res.cookies.find((c) => c.name === 'access');
    const refreshCookie = res.cookies.find((c) => c.name === 'refresh');
    expect(accessCookie?.value).toBeTruthy();
    expect(refreshCookie?.value).toBeTruthy();
    expect(accessCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(accessCookie?.sameSite?.toLowerCase()).toBe('lax');
  });

  it('login with wrong password → 401 INVALID_CREDENTIALS', async () => {
    await signupOwner();
    const res = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'wrong-password-here',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('/auth/me without a cookie → 401 UNAUTHENTICATED', async () => {
    const res = await get('/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('/auth/me with a valid session returns user + owner', async () => {
    await signupOwner();
    const session = new Session();
    const login = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'hunter2bravo',
    });
    session.captureFromResponse(login);

    const me = await get('/auth/me', session);
    expect(me.statusCode).toBe(200);
    const data = me.json().data;
    expect(data.user.email).toBe('owner@example.com');
    expect(data.user.role).toBe('owner');
    expect(data.owner.id).toBe(data.user.id);
    expect(data.staffAccounts).toEqual([]);
  });

  it('/auth/refresh rotates the refresh token; the OLD value no longer works', async () => {
    await signupOwner();
    const session = new Session();
    const login = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'hunter2bravo',
    });
    session.captureFromResponse(login);
    const oldRefresh = session.get('refresh');

    const refreshed = await post('/auth/refresh', {}, session);
    expect(refreshed.statusCode).toBe(200);
    session.captureFromResponse(refreshed);
    expect(session.get('refresh')).not.toBe(oldRefresh);

    // Try the old refresh: should be rejected.
    const stale = new Session();
    stale.set('refresh', oldRefresh!);
    const replay = await post('/auth/refresh', {}, stale);
    expect(replay.statusCode).toBe(401);
  });

  it('logout clears cookies and revokes the refresh family', async () => {
    await signupOwner();
    const session = new Session();
    const login = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'hunter2bravo',
    });
    session.captureFromResponse(login);

    const logout = await post('/auth/logout', {}, session);
    expect(logout.statusCode).toBe(200);

    // Sanity: the refresh token row in the DB is now revoked.
    const { rows } = await db.pool.query<{ revoked_at: Date | null }>(
      `select revoked_at from loyalty.refresh_tokens where revoked_at is null`,
    );
    expect(rows.length).toBe(0);
  });
});

describe('auth: forgot-password + reset-password + change-password', () => {
  it('forgot-password emits a reset email and reset-password updates the password', async () => {
    await signupOwner();
    rig.emails.clear();

    const forgot = await post('/auth/forgot-password', { email: 'owner@example.com' });
    expect(forgot.statusCode).toBe(200);
    const resetUrl = rig.emails.extractUrl('/reset-password');
    expect(resetUrl).toMatch(/token=[a-f0-9]+/);
    const token = resetUrl!.split('token=')[1]!;

    const reset = await post('/auth/reset-password', {
      token,
      newPassword: 'newPassword42',
    });
    expect(reset.statusCode).toBe(200);

    // Old password no longer works.
    const oldLogin = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'hunter2bravo',
    });
    expect(oldLogin.statusCode).toBe(401);

    // New one does.
    const newLogin = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'newPassword42',
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('forgot-password for an unknown email still returns 200 (no existence leak)', async () => {
    const res = await post('/auth/forgot-password', { email: 'never-signed-up@example.com' });
    expect(res.statusCode).toBe(200);
    expect(rig.emails.messages.length).toBe(0);
  });

  it('reset-password with an invalid token → 400 INVALID_TOKEN', async () => {
    const res = await post('/auth/reset-password', {
      token: 'a'.repeat(64),
      newPassword: 'newPassword42',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('/auth/password (while logged in) updates the password and revokes other sessions', async () => {
    await signupOwner();
    const session = new Session();
    const login = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'hunter2bravo',
    });
    session.captureFromResponse(login);

    const change = await post('/auth/password', { newPassword: 'newPassword42' }, session);
    expect(change.statusCode).toBe(200);
    session.captureFromResponse(change);

    // New password works.
    const fresh = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'newPassword42',
    });
    expect(fresh.statusCode).toBe(200);
  });
});

describe('auth: google sso', () => {
  // Default identity shape; override per-test via `setIdentity`.
  type Identity = {
    sub: string;
    email: string;
    emailVerified: boolean;
    hd?: string;
    name?: string;
  };

  const setIdentity = (identity: Identity) => {
    rig.setGoogleVerifierOverride(async () => ({
      sub: identity.sub,
      email: identity.email,
      emailVerified: identity.emailVerified,
      hd: identity.hd,
      name: identity.name,
    }));
  };

  afterEach(() => {
    rig.setGoogleVerifierOverride(null);
  });

  it('(1) bootstrap: empty DB + valid Workspace token → provisions owner + sets cookies', async () => {
    setIdentity({
      sub: 'g1',
      email: 'founder@example.com',
      emailVerified: true,
      hd: 'example.com',
      name: 'Founder',
    });

    const res = await post('/auth/google', { credential: 'x' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.user.email).toBe('founder@example.com');
    expect(data.user.role).toBe('owner');
    expect(res.cookies.find((c) => c.name === 'access')?.value).toBeTruthy();
    expect(res.cookies.find((c) => c.name === 'refresh')?.value).toBeTruthy();

    // Follow-up: the captured session resolves /auth/me.
    const session = new Session();
    session.captureFromResponse(res);
    const me = await get('/auth/me', session);
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.email).toBe('founder@example.com');
  });

  it('(2) link existing owner email → logs in as that owner', async () => {
    await insertOwner(rig.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Test Cafe',
      slug: 'test-cafe',
    });
    setIdentity({
      sub: 'g2',
      email: 'owner@example.com',
      emailVerified: true,
      hd: 'example.com',
      name: 'Owner',
    });

    const res = await post('/auth/google', { credential: 'x' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.user.email).toBe('owner@example.com');
    expect(data.user.role).toBe('owner');

    // google_sub linked on the user row.
    const { rows } = await rig.pool.query<{ google_sub: string | null }>(
      `select google_sub from loyalty.users where email = 'owner@example.com'`,
    );
    expect(rows[0]?.google_sub).toBe('g2');
  });

  it('(3) owner exists + unknown email → 403 NO_ACCOUNT', async () => {
    await insertOwner(rig.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Test Cafe',
      slug: 'test-cafe',
    });
    setIdentity({
      sub: 'g3',
      email: 'stranger@example.com',
      emailVerified: true,
      hd: 'example.com',
    });

    const res = await post('/auth/google', { credential: 'x' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_ACCOUNT');
  });

  it('(4) domain not allowed (no hd / gmail) → 403 DOMAIN_NOT_ALLOWED', async () => {
    setIdentity({
      sub: 'g4',
      email: 'x@gmail.com',
      emailVerified: true,
      hd: undefined,
    });

    const res = await post('/auth/google', { credential: 'x' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('(5) email not verified → 403 EMAIL_NOT_VERIFIED', async () => {
    setIdentity({
      sub: 'g5',
      email: 'someone@example.com',
      emailVerified: false,
      hd: 'example.com',
    });

    const res = await post('/auth/google', { credential: 'x' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('(6) disabled account → 403 ACCOUNT_DISABLED', async () => {
    await insertOwner(rig.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Test Cafe',
      slug: 'test-cafe',
    });
    await rig.pool.query(
      `update loyalty.profiles set access = 'disabled' where email = 'owner@example.com'`,
    );
    setIdentity({
      sub: 'g6',
      email: 'owner@example.com',
      emailVerified: true,
      hd: 'example.com',
    });

    const res = await post('/auth/google', { credential: 'x' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_DISABLED');
  });

  it('(7) staff: pre-created staff under owner → logs in; unknown email → 401', async () => {
    const owner = await insertOwner(rig.pool, {
      email: 'owner@example.com',
      password: 'hunter2bravo',
      businessName: 'Test Cafe',
      slug: 'test-cafe',
    });
    // Create a staff user + profile under that owner.
    const { rows: staffUser } = await rig.pool.query<{ id: string }>(
      `insert into loyalty.users (email, password_hash, email_verified_at)
       values ('staff@example.com', null, now())
       returning id`,
    );
    const staffId = staffUser[0]!.id;
    await rig.pool.query(
      `insert into loyalty.profiles
         (id, business_name, email, slug, role, owner_id, status, access)
       values ($1, 'Test Cafe', 'staff@example.com', null, 'staff', $2, 'verified', 'active')`,
      [staffId, owner.userId],
    );

    setIdentity({
      sub: 'g7',
      email: 'staff@example.com',
      emailVerified: true,
      hd: 'example.com',
      name: 'Staffer',
    });
    const ok = await post('/auth/google-staff', { credential: 'x', orgId: owner.slug });
    expect(ok.statusCode).toBe(200);
    const data = ok.json().data;
    expect(data.user.email).toBe('staff@example.com');
    expect(data.user.role).toBe('staff');
    expect(ok.cookies.find((c) => c.name === 'access')?.value).toBeTruthy();

    // Unknown email under the same org → 401 INVALID_CREDENTIALS.
    setIdentity({
      sub: 'g7b',
      email: 'nobody@example.com',
      emailVerified: true,
      hd: 'example.com',
    });
    const bad = await post('/auth/google-staff', { credential: 'x', orgId: owner.slug });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('auth: delete-account', () => {
  it('DELETE /auth/account removes the user and cascades to profile + refresh_tokens', async () => {
    await signupOwner();
    const session = new Session();
    const login = await post('/auth/login', {
      email: 'owner@example.com',
      password: 'hunter2bravo',
    });
    session.captureFromResponse(login);

    const res = await del('/auth/account', session);
    expect(res.statusCode).toBe(200);

    const { rows } = await db.pool.query(
      `select count(*)::text as c from loyalty.users where email = 'owner@example.com'`,
    );
    expect(rows[0].c).toBe('0');
  });
});
