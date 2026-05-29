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
  rig.storage.clear();
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

describe('storage: presign', () => {
  it('valid logo (image/png, 1 MB) → 200 with uploadUrl + path + headers', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/storage/campaign-assets/presign',
      payload: { kind: 'logo', contentType: 'image/png', sizeBytes: 1_000_000 },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.uploadUrl).toContain('fake-bucket.test');
    expect(data.path).toMatch(new RegExp(`^${owner.userId}/logo/[0-9a-f-]+\\.png$`));
    expect(data.headers['Content-Type']).toBe('image/png');
    expect(data.headers['Cache-Control']).toMatch(/immutable/);

    expect(rig.storage.presignedUploads).toHaveLength(1);
    expect(rig.storage.presignedUploads[0]?.path).toBe(data.path);
  });

  it('logo with non-image mime → 400 INVALID_ASSET', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/storage/campaign-assets/presign',
      payload: { kind: 'logo', contentType: 'application/octet-stream', sizeBytes: 1000 },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ASSET');
  });

  it('logo over 2 MB → 400 INVALID_ASSET', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/storage/campaign-assets/presign',
      payload: { kind: 'logo', contentType: 'image/png', sizeBytes: 3 * 1024 * 1024 },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ASSET');
    expect(res.json().error.message).toMatch(/2 MB/);
  });

  it('background over 6 MB → 400', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/storage/campaign-assets/presign',
      payload: { kind: 'background', contentType: 'image/jpeg', sizeBytes: 8 * 1024 * 1024 },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('background as svg → 400 (svg only allowed for logos)', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'POST',
      url: '/storage/campaign-assets/presign',
      payload: { kind: 'background', contentType: 'image/svg+xml', sizeBytes: 50_000 },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('anonymous → 401 UNAUTHENTICATED', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/storage/campaign-assets/presign',
      payload: { kind: 'logo', contentType: 'image/png', sizeBytes: 1000 },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('storage: DELETE', () => {
  it('valid path under own owner-id → 200 + records the path', async () => {
    const s = await ownerSession();
    const path = `${owner.userId}/logo/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`;
    const res = await rig.app.inject({
      method: 'DELETE',
      url: '/storage/campaign-assets',
      payload: { path },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(200);
    expect(rig.storage.deleted).toContain(path);
  });

  it('path under another owner-id → 403 FORBIDDEN', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'DELETE',
      url: '/storage/campaign-assets',
      payload: {
        path: '99999999-9999-9999-9999-999999999999/logo/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png',
      },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('malformed path → 400 INVALID_PATH', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'DELETE',
      url: '/storage/campaign-assets',
      payload: { path: 'random/garbage.png' },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PATH');
  });

  it('path traversal attempt → 400', async () => {
    const s = await ownerSession();
    const res = await rig.app.inject({
      method: 'DELETE',
      url: '/storage/campaign-assets',
      payload: {
        path: `${owner.userId}/logo/../../../etc/passwd`,
      },
      headers: { 'content-type': 'application/json', ...withSession(s) },
    });
    expect(res.statusCode).toBe(400);
  });
});
