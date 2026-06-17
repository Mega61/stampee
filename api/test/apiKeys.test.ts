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
let owner: { userId: string; slug: string };
let session: Session;
let campaignId: string;
let customerId: string;

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
  owner = await insertOwner(db.pool, {
    email: 'owner@example.com',
    password: 'hunter2bravo',
    businessName: 'Test Cafe',
    slug: 'test-cafe',
  });
  campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Coffee', totalStamps: 10 });
  customerId = await insertCustomer(db.pool, owner.userId, { name: 'Alice', email: 'alice@x.com' });

  session = new Session();
  const login = await rig.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'owner@example.com', password: 'hunter2bravo' },
    headers: { 'content-type': 'application/json' },
  });
  session.captureFromResponse(login);
});

const json = { 'content-type': 'application/json' } as const;
const withSession = (s: Session) => ({ cookie: s.cookieJarHeader() ?? '' });
const withKey = (key: string) => ({ authorization: `Bearer ${key}` });

// Create a key as the logged-in owner and return its plaintext secret.
const mintKey = async (name = 'Integration', s: Session = session): Promise<{ key: string; id: string }> => {
  const res = await rig.app.inject({
    method: 'POST',
    url: '/api-keys',
    payload: { name },
    headers: { ...json, ...withSession(s) },
  });
  expect(res.statusCode).toBe(200);
  const data = res.json().data;
  return { key: data.key as string, id: data.id as string };
};

// ---------------------------------------------------------------- management

describe('api-keys: management (owner/admin, humans only)', () => {
  it('owner POST /api-keys → plaintext returned once; list shows prefix, never the secret', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api-keys',
      payload: { name: 'Reporting bot' },
      headers: { ...json, ...withSession(session) },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.key).toMatch(/^stmp_[0-9a-f]+$/);
    expect(data.keyPrefix.startsWith('stmp_')).toBe(true);
    expect(data.status).toBe('active');
    expect(data.name).toBe('Reporting bot');

    const list = await rig.app.inject({
      method: 'GET',
      url: '/api-keys',
      headers: { ...withSession(session) },
    });
    expect(list.statusCode).toBe(200);
    const keys = list.json().data;
    expect(keys).toHaveLength(1);
    expect(keys[0].keyPrefix).toBe(data.keyPrefix);
    // The list DTO must never carry the secret or its hash.
    expect(keys[0].key).toBeUndefined();
    expect(keys[0].tokenHash).toBeUndefined();
  });

  it('DELETE /api-keys/:id revokes; the key then 401s and shows status=revoked', async () => {
    const { key, id } = await mintKey();

    const revoke = await rig.app.inject({
      method: 'DELETE',
      url: `/api-keys/${id}`,
      headers: { ...withSession(session) },
    });
    expect(revoke.statusCode).toBe(200);

    const after = await rig.app.inject({
      method: 'GET',
      url: '/customers',
      headers: { ...withKey(key) },
    });
    expect(after.statusCode).toBe(401);

    const list = await rig.app.inject({
      method: 'GET',
      url: '/api-keys',
      headers: { ...withSession(session) },
    });
    expect(list.json().data[0].status).toBe('revoked');
  });

  it('enforces the active-key limit with 409 API_KEY_LIMIT', async () => {
    for (let i = 0; i < 10; i++) await mintKey(`k${i}`);
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api-keys',
      payload: { name: 'one too many' },
      headers: { ...json, ...withSession(session) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('API_KEY_LIMIT');
  });
});

// --------------------------------------------------------------- consumption

describe('api-keys: consumption (read + write within owner scope)', () => {
  it('authenticates GET /customers and write POST /cards via the Bearer header', async () => {
    const { key } = await mintKey();

    const read = await rig.app.inject({
      method: 'GET',
      url: '/customers?include=cards',
      headers: { ...withKey(key) },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().ok).toBe(true);

    const write = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { ...json, ...withKey(key) },
    });
    expect(write.statusCode).toBe(200);
    expect(write.json().data.stamps).toBe(0);
  });

  it('attributes transactions to the key (actor_role=api, actor_name=API: <name>)', async () => {
    const { key } = await mintKey('Stamper');
    const issue = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId, campaignId },
      headers: { ...json, ...withKey(key) },
    });
    const cardId = issue.json().data.id as string;

    const tx = await rig.app.inject({
      method: 'POST',
      url: `/cards/${cardId}/transactions`,
      payload: {
        type: 'stamp_add',
        amount: 1,
        date: '2026-06-16',
        timestamp: 1_750_000_000,
        title: 'Stamp added',
      },
      headers: { ...json, ...withKey(key) },
    });
    expect(tx.statusCode).toBe(200);
    expect(tx.json().data.actorRole).toBe('api');
    expect(tx.json().data.actorName).toBe('API: Stamper');
    expect(tx.json().data.actorId).toBeUndefined();
  });

  it('updates last_used_at when the key is used', async () => {
    const { key, id } = await mintKey();
    await rig.app.inject({ method: 'GET', url: '/customers', headers: { ...withKey(key) } });
    // last_used_at is a best-effort fire-and-forget; give it a tick to land.
    await new Promise((r) => setTimeout(r, 50));
    const { rows } = await rig.pool.query<{ last_used_at: Date | null }>(
      'select last_used_at from loyalty.api_keys where id = $1',
      [id],
    );
    expect(rows[0]?.last_used_at).not.toBeNull();
  });

  it('rejects unknown, revoked, and expired keys with 401', async () => {
    const unknown = await rig.app.inject({
      method: 'GET',
      url: '/customers',
      headers: { authorization: 'Bearer stmp_deadbeef' },
    });
    expect(unknown.statusCode).toBe(401);

    const { key, id } = await mintKey();
    await rig.pool.query(
      "update loyalty.api_keys set expires_at = now() - interval '1 day' where id = $1",
      [id],
    );
    const expired = await rig.app.inject({
      method: 'GET',
      url: '/customers',
      headers: { ...withKey(key) },
    });
    expect(expired.statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------ security

describe('api-keys: tenant isolation + management lockout', () => {
  it('a key for owner A cannot see or mutate owner B data', async () => {
    // Owner B with its own customer.
    const ownerB = await insertOwner(db.pool, {
      email: 'b@example.com',
      password: 'hunter2bravo',
      businessName: 'Other Cafe',
      slug: 'other-cafe',
    });
    const customerB = await insertCustomer(db.pool, ownerB.userId, { name: 'Bob', email: 'bob@x.com' });

    const { key } = await mintKey(); // belongs to owner A

    // A's key sees only A's customers, never B's.
    const list = await rig.app.inject({
      method: 'GET',
      url: '/customers',
      headers: { ...withKey(key) },
    });
    expect(list.statusCode).toBe(200);
    const ids = list.json().data.map((c: { id: string }) => c.id);
    expect(ids).toContain(customerId);
    expect(ids).not.toContain(customerB);

    // And cannot issue a card against B's customer (404, no existence leak).
    const write = await rig.app.inject({
      method: 'POST',
      url: '/cards',
      payload: { customerId: customerB, campaignId },
      headers: { ...json, ...withKey(key) },
    });
    expect(write.statusCode).toBe(404);
  });

  it('an API key cannot manage keys, staff, admins, or the account', async () => {
    const { key } = await mintKey();
    const headers = { ...json, ...withKey(key) };

    const cannotList = await rig.app.inject({ method: 'GET', url: '/api-keys', headers });
    expect(cannotList.statusCode).toBe(403);

    const cannotMint = await rig.app.inject({
      method: 'POST',
      url: '/api-keys',
      payload: { name: 'nope' },
      headers,
    });
    expect(cannotMint.statusCode).toBe(403);

    const cannotStaff = await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'X', email: 'x@example.com', pin: '1234' },
      headers,
    });
    expect(cannotStaff.statusCode).toBe(403);

    const cannotMe = await rig.app.inject({ method: 'GET', url: '/auth/me', headers });
    expect(cannotMe.statusCode).toBe(403);
  });

  it('staff cannot manage API keys (403)', async () => {
    // Owner creates a staff account, staff logs in, then attempts key mgmt.
    const created = await rig.app.inject({
      method: 'POST',
      url: '/staff',
      payload: { name: 'Barista', email: 'barista@example.com', pin: '1234' },
      headers: { ...json, ...withSession(session) },
    });
    expect(created.statusCode).toBe(200);

    const staffSession = new Session();
    const login = await rig.app.inject({
      method: 'POST',
      url: '/auth/staff-login',
      payload: { email: 'barista@example.com', pin: '1234', orgId: owner.slug },
      headers: json,
    });
    expect(login.statusCode).toBe(200);
    staffSession.captureFromResponse(login);

    const list = await rig.app.inject({
      method: 'GET',
      url: '/api-keys',
      headers: { ...withSession(staffSession) },
    });
    expect(list.statusCode).toBe(403);
  });
});
