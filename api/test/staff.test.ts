import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertOwner, Session, type TestRig } from './helpers/app.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };

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
  owner = await insertOwner(db.pool, {
    email: 'owner@example.com',
    password: 'hunter2bravo',
    businessName: 'Test Cafe',
    slug: 'test-cafe',
  });
});

const ownerSession = async (): Promise<Session> => {
  const s = new Session();
  const res = await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'owner@example.com', password: 'hunter2bravo' },
    headers: { 'content-type': 'application/json' },
  });
  s.captureFromResponse(res);
  return s;
};

const withSession = (s: Session) => ({ cookie: s.cookieJarHeader() ?? '' });

describe('staff: list + create', () => {
  it('GET /staff initially empty for a fresh owner', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'GET',
      url: '/staff',
      headers: withSession(s),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('POST /staff creates a staff profile + emails the PIN', async () => {
    const s = await ownerSession();
    rig.emails.clear();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'Lisa', email: 'lisa@example.com', pin: '5678' },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(200);
    const created = res.json().data;
    expect(created.role).toBe('staff');
    expect(created.ownerId).toBe(owner.userId);
    expect(created.access).toBe('active');

    const last = rig.emails.last();
    expect(last?.to).toBe('lisa@example.com');
    expect(last?.subject).toMatch(/staff/i);
    expect(last?.text).toContain('5678'); // PIN in the welcome email
  });

  it('POST /staff with a duplicate email → 409 EMAIL_TAKEN', async () => {
    const s = await ownerSession();
    await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'Lisa', email: 'lisa@example.com', pin: '5678' },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'Lisa 2', email: 'lisa@example.com', pin: '1234' },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });
});

describe('staff: PIN rotation + access toggle + delete', () => {
  const createLisa = async (s: Session) => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'Lisa', email: 'lisa@example.com', pin: '5678' },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    return res.json().data.id as string;
  };

  const staffLogin = async (pin: string) =>
    rig.app.inject({
      method: 'POST',
      url: '/auth/staff-login',
      payload: { email: 'lisa@example.com', pin, orgId: owner.slug },
      headers: { 'content-type': 'application/json' },
    });

  it('PATCH /staff/:id/pin invalidates the old PIN', async () => {
    const s = await ownerSession();
    const staffId = await createLisa(s);

    expect((await staffLogin('5678')).statusCode).toBe(200);

    const rotate = await rig.app.inject({
      method: 'PATCH',
      url: `/staff/${staffId}/pin`,
      payload: { pin: '9999' },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(rotate.statusCode).toBe(200);

    expect((await staffLogin('5678')).statusCode).toBe(401);
    expect((await staffLogin('9999')).statusCode).toBe(200);
  });

  it('PATCH /staff/:id/access disabled → next login returns 403 ACCOUNT_DISABLED', async () => {
    const s = await ownerSession();
    const staffId = await createLisa(s);

    const off = await rig.app.inject({
      method: 'PATCH',
      url: `/staff/${staffId}/access`,
      payload: { access: 'disabled' },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(off.statusCode).toBe(200);

    const blocked = await staffLogin('5678');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('ACCOUNT_DISABLED');
  });

  it('DELETE /staff/:id removes the user + profile + refresh_tokens', async () => {
    const s = await ownerSession();
    const staffId = await createLisa(s);

    const res = await rig.app.inject({
      method: 'DELETE',
      url: `/staff/${staffId}`,
      headers: withSession(s),
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await db.pool.query(
      `select count(*)::text as c from loyalty.users where email = 'lisa@example.com'`,
    );
    expect(rows[0].c).toBe('0');
  });

  it('DELETE /staff/:id of another owner\'s staff → 404 (no existence leak)', async () => {
    // Owner A's staff.
    const sA = await ownerSession();
    const staffId = await createLisa(sA);

    // Owner B.
    await insertOwner(db.pool, {
      email: 'b@example.com',
      password: 'hunter2bravo',
      businessName: 'B',
      slug: 'b-shop',
    });
    const sB = new Session();
    const loginB = await rig.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'b@example.com', password: 'hunter2bravo' },
      headers: { 'content-type': 'application/json' },
    });
    sB.captureFromResponse(loginB);

    const res = await rig.app.inject({
      method: 'DELETE',
      url: `/staff/${staffId}`,
      headers: withSession(sB),
    });
    expect(res.statusCode).toBe(404);
  });
});
