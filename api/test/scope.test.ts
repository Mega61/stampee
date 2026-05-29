// AuthZ negatives: the most security-critical tier. Verify that:
//   * staff cannot reach owner-only routes (403)
//   * one tenant cannot read or mutate another tenant's data (404, not 403 — no existence leak)
//   * anonymous callers are bounced at 401
//   * tampered cookies are rejected
//   * the access/refresh cookie split behaves as designed

import bcrypt from 'bcrypt';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import {
  buildTestRig,
  insertCampaign,
  insertCustomer,
  insertOwner,
  Session,
  type TestRig,
} from './helpers/app.js';

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
});

const withSession = (s: Session) => ({ cookie: s.cookieJarHeader() ?? '' });

// ---- Fixture: owner A with one campaign + one customer + one staff. -----
const setupTenantA = async () => {
  const owner = await insertOwner(db.pool, {
    email: 'a@example.com',
    password: 'hunter2bravo',
    businessName: 'Tenant A',
    slug: 'tenant-a',
  });

  const ownerSession = new Session();
  const login = await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'a@example.com', password: 'hunter2bravo' },
    headers: { 'content-type': 'application/json' },
  });
  ownerSession.captureFromResponse(login);

  // Create a staff member via the API so the email/PIN flow runs.
  await rig.app.inject({
    method: 'POST',
    url: '/staff',
    payload: { name: 'Sam', email: 'sam@example.com', pin: '1234' },
    headers: { 'content-type': 'application/json', ...withSession(ownerSession) },
  });
  const staffSession = new Session();
  const staffLogin = await rig.app.inject({
    method: 'POST',
    url: '/auth/staff-login',
    payload: { email: 'sam@example.com', pin: '1234', orgId: owner.slug },
    headers: { 'content-type': 'application/json' },
  });
  staffSession.captureFromResponse(staffLogin);

  const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Coffee' });
  const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Alice', email: 'a@x.com' });
  const issue = await rig.app.inject({
    method: 'POST',
    url: '/cards',
    payload: { customerId, campaignId },
    headers: { 'content-type': 'application/json', ...withSession(ownerSession) },
  });
  const cardId = issue.json().data.id as string;

  return { owner, ownerSession, staffSession, campaignId, customerId, cardId };
};

describe('scope: staff cannot reach owner-only routes', () => {
  it('staff DELETE /campaigns/:id → 403 FORBIDDEN', async () => {
    const t = await setupTenantA();
    const res = await rig.app.inject({
      method: 'DELETE',
      url: `/campaigns/${t.campaignId}`,
      headers: withSession(t.staffSession),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('staff POST /staff → 403', async () => {
    const t = await setupTenantA();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'Ghost', email: 'ghost@example.com', pin: '0000' },
      headers: { 'content-type': 'application/json', ...withSession(t.staffSession) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('staff POST /storage/campaign-assets/presign → 403 (owner-only)', async () => {
    const t = await setupTenantA();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/storage/campaign-assets/presign',
      payload: { kind: 'logo', contentType: 'image/png', sizeBytes: 1000 },
      headers: { 'content-type': 'application/json', ...withSession(t.staffSession) },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('scope: cross-tenant isolation', () => {
  it('owner B PATCH /cards/<A-card> → 404 NOT_FOUND (no existence leak)', async () => {
    const t = await setupTenantA();
    await insertOwner(db.pool, {
      email: 'b@example.com',
      password: 'hunter2bravo',
      businessName: 'Tenant B',
      slug: 'tenant-b',
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
      method: 'PATCH',
      url: `/cards/${t.cardId}`,
      payload: { stamps: 99 },
      headers: { 'content-type': 'application/json', ...withSession(sB) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('owner B PATCH /campaigns/<A-campaign>/enabled → 404', async () => {
    const t = await setupTenantA();
    await insertOwner(db.pool, {
      email: 'b@example.com',
      password: 'hunter2bravo',
      businessName: 'Tenant B',
      slug: 'tenant-b',
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
      method: 'PATCH',
      url: `/campaigns/${t.campaignId}/enabled`,
      payload: { isEnabled: false },
      headers: { 'content-type': 'application/json', ...withSession(sB) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('scope: anonymous + tampered cookies', () => {
  it('anonymous on a protected route → 401', async () => {
    const res = await rig.app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('tampered access cookie (signature break) → 401', async () => {
    const t = await setupTenantA();
    const access = t.ownerSession.get('access')!;
    // Flip a character in the signature segment.
    const parts = access.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -1)}${parts[2]!.endsWith('A') ? 'B' : 'A'}`;
    const res = await rig.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `access=${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid refresh cookie alone can rotate even with no access cookie', async () => {
    const t = await setupTenantA();
    const refresh = t.ownerSession.get('refresh')!;
    // Drop the access cookie entirely; simulates "expired access".
    const res = await rig.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {},
      headers: { 'content-type': 'application/json', cookie: `refresh=${refresh}` },
    });
    expect(res.statusCode).toBe(200);
    const newAccess = res.cookies.find((c) => c.name === 'access');
    expect(newAccess?.value).toBeTruthy();
  });

  it('no cookies at all → /auth/refresh 401', async () => {
    const res = await rig.app.inject({ method: 'POST', url: '/auth/refresh', payload: {}, headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(401);
  });

  it('staff with access=disabled mid-session → /auth/me 403 ACCOUNT_DISABLED', async () => {
    const t = await setupTenantA();
    // Directly disable Sam in the DB.
    await db.pool.query(
      `update loyalty.profiles set access = 'disabled' where email = 'sam@example.com'`,
    );
    const res = await rig.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: withSession(t.staffSession),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_DISABLED');
  });
});

// Silence the unused-import warning if bcrypt isn't referenced — it's imported
// for parity with other test files that share the helpers/app rig.
void bcrypt;
