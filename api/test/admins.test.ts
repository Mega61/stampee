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

afterEach(() => {
  // Reset the Google verifier seam so identities don't leak between cases.
  rig.setGoogleVerifierOverride(null);
});

// Helpers ----------------------------------------------------------------

const json = (): Record<string, string> => ({ 'content-type': 'application/json' });

const post = (path: string, body: unknown, session?: Session) =>
  rig.app.inject({
    method: 'POST',
    url: path,
    payload: body,
    headers: session?.cookieJarHeader()
      ? { ...json(), cookie: session.cookieJarHeader()! }
      : json(),
  });

const get = (path: string, session?: Session) =>
  rig.app.inject({
    method: 'GET',
    url: path,
    ...(session?.cookieJarHeader() ? { headers: { cookie: session.cookieJarHeader()! } } : {}),
  });

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

// Log an owner in via email + password; returns a Session with cookies.
const loginOwner = async (email: string, password: string): Promise<Session> => {
  const session = new Session();
  const res = await post('/auth/login', { email, password });
  expect(res.statusCode).toBe(200);
  session.captureFromResponse(res);
  return session;
};

// Sign an admin in via Google SSO (links existing pre-invited user by email).
const loginAdminViaGoogle = async (identity: Identity): Promise<{ session: Session; res: ReturnType<typeof post> extends Promise<infer R> ? R : never }> => {
  setIdentity(identity);
  const res = await post('/auth/google', { credential: 'x' });
  const session = new Session();
  session.captureFromResponse(res);
  return { session, res };
};

const OWNER = {
  email: 'owner@example.com',
  password: 'hunter2bravo',
  businessName: 'Test Cafe',
  slug: 'test-cafe',
};

const validCampaignBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Coffee Club',
  description: 'Buy 10 get 1 free',
  rewardName: 'Free coffee',
  iconKey: 'Coffee',
  colors: { primary: '#000', secondary: '#fff', text: '#000', accent: '#888' },
  totalStamps: 10,
  ...overrides,
});

// Tests ------------------------------------------------------------------

describe('admins: owner manages co-admins', () => {
  it('(a) owner POST /admins → 200 role=admin; appears in GET /admins', async () => {
    await insertOwner(rig.pool, OWNER);
    const session = await loginOwner(OWNER.email, OWNER.password);

    const create = await post('/admins', { name: 'Co Owner', email: 'co@example.com' }, session);
    expect(create.statusCode).toBe(200);
    const dto = create.json().data;
    expect(dto.role).toBe('admin');
    expect(dto.email).toBe('co@example.com');
    expect(dto.businessName).toBe('Co Owner');
    expect(dto.slug).toBeNull();
    expect(dto.ownerId).toBeTruthy();

    const list = await get('/admins', session);
    expect(list.statusCode).toBe(200);
    const emails = list.json().data.map((a: { email: string }) => a.email);
    expect(emails).toContain('co@example.com');
  });

  it('(b) POST /admins with an already-used email → 409 EMAIL_TAKEN', async () => {
    await insertOwner(rig.pool, OWNER);
    const session = await loginOwner(OWNER.email, OWNER.password);

    const first = await post('/admins', { name: 'Co Owner', email: 'co@example.com' }, session);
    expect(first.statusCode).toBe(200);

    const dup = await post('/admins', { name: 'Co Owner 2', email: 'co@example.com' }, session);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('(c) invited admin signs in via /auth/google → 200, role=admin', async () => {
    await insertOwner(rig.pool, OWNER);
    const ownerSession = await loginOwner(OWNER.email, OWNER.password);
    const invite = await post('/admins', { name: 'Co Owner', email: 'co@example.com' }, ownerSession);
    expect(invite.statusCode).toBe(200);

    const { res } = await loginAdminViaGoogle({
      sub: 'g-admin-c',
      email: 'co@example.com',
      emailVerified: true,
      hd: 'example.com',
      name: 'Co Owner',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.role).toBe('admin');
  });

  it('(d) admin POST /campaigns → 200; owner sees it (shared scope)', async () => {
    const owner = await insertOwner(rig.pool, OWNER);
    const ownerSession = await loginOwner(OWNER.email, OWNER.password);
    await post('/admins', { name: 'Co Owner', email: 'co@example.com' }, ownerSession);

    const { session: adminSession, res: loginRes } = await loginAdminViaGoogle({
      sub: 'g-admin-d',
      email: 'co@example.com',
      emailVerified: true,
      hd: 'example.com',
      name: 'Co Owner',
    });
    expect(loginRes.statusCode).toBe(200);

    const create = await post('/campaigns', validCampaignBody({ name: 'Admin Campaign' }), adminSession);
    expect(create.statusCode).toBe(200);

    // Owner sees the admin-created campaign (proves shared owner scope).
    const ownerList = await get('/campaigns', ownerSession);
    expect(ownerList.statusCode).toBe(200);
    const names = ownerList.json().data.map((c: { name: string }) => c.name);
    expect(names).toContain('Admin Campaign');

    // And it lives under the owner's scope id in the DB.
    const { rows } = await rig.pool.query<{ owner_id: string }>(
      `select owner_id from loyalty.campaigns where name = 'Admin Campaign'`,
    );
    expect(rows[0]?.owner_id).toBe(owner.userId);
  });

  it('(e) admin POST /staff → 200 and admin GET /staff lists it', async () => {
    await insertOwner(rig.pool, OWNER);
    const ownerSession = await loginOwner(OWNER.email, OWNER.password);
    await post('/admins', { name: 'Co Owner', email: 'co@example.com' }, ownerSession);

    const { session: adminSession } = await loginAdminViaGoogle({
      sub: 'g-admin-e',
      email: 'co@example.com',
      emailVerified: true,
      hd: 'example.com',
      name: 'Co Owner',
    });

    const create = await post(
      '/staff',
      { name: 'Barista', email: 'barista@example.com', pin: '1234' },
      adminSession,
    );
    expect(create.statusCode).toBe(200);
    expect(create.json().data.role).toBe('staff');

    const list = await get('/staff', adminSession);
    expect(list.statusCode).toBe(200);
    const emails = list.json().data.map((s: { email: string }) => s.email);
    expect(emails).toContain('barista@example.com');
  });

  it('(f) admin cannot manage admins: GET /admins and POST /admins → 403 FORBIDDEN', async () => {
    await insertOwner(rig.pool, OWNER);
    const ownerSession = await loginOwner(OWNER.email, OWNER.password);
    await post('/admins', { name: 'Co Owner', email: 'co@example.com' }, ownerSession);

    const { session: adminSession } = await loginAdminViaGoogle({
      sub: 'g-admin-f',
      email: 'co@example.com',
      emailVerified: true,
      hd: 'example.com',
      name: 'Co Owner',
    });

    const list = await get('/admins', adminSession);
    expect(list.statusCode).toBe(403);
    expect(list.json().error.code).toBe('FORBIDDEN');

    const create = await post('/admins', { name: 'Another', email: 'two@example.com' }, adminSession);
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe('FORBIDDEN');
  });

  it('(g) staff cannot create campaigns: POST /campaigns → 403 FORBIDDEN', async () => {
    await insertOwner(rig.pool, OWNER);
    const ownerSession = await loginOwner(OWNER.email, OWNER.password);

    // Create a staff account (owner can manage staff).
    const created = await post(
      '/staff',
      { name: 'Barista', email: 'barista@example.com', pin: '1234' },
      ownerSession,
    );
    expect(created.statusCode).toBe(200);

    // Staff signs in via the staff portal (email + PIN + org slug).
    const staffSession = new Session();
    const login = await post('/auth/staff-login', {
      email: 'barista@example.com',
      pin: '1234',
      orgId: OWNER.slug,
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.user.role).toBe('staff');
    staffSession.captureFromResponse(login);

    const create = await post('/campaigns', validCampaignBody(), staffSession);
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe('FORBIDDEN');
  });
});
