import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import forge from 'node-forge';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from './helpers/db.js';
import { buildTestRig, insertCampaign, insertCustomer, insertOwner, type TestRig } from './helpers/app.js';
import type { AppleWalletConfig } from '../src/lib/wallet/apple.js';

let db: TestDb;
let rig: TestRig;
let owner: { userId: string; slug: string };
let apple: typeof import('../src/lib/wallet/apple.js');
let config: AppleWalletConfig;
let caPem: string;

const PASS_TYPE = 'pass.com.goldenbeauty.loyalty';
const DEVICE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PUSH_TOKEN = 'f'.repeat(64);

// ---- throwaway PKI: "WWDR" CA → Pass Type ID signer ------------------------

const makeCert = (params: {
  subject: string;
  publicKeyPem: string;
  issuer: { name: string; keyPem: string };
  ca: boolean;
}) => {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(params.publicKeyPem);
  cert.serialNumber = `0${Math.floor(Math.random() * 1e12).toString(16)}`;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: params.subject }]);
  cert.setIssuer([{ name: 'commonName', value: params.issuer.name }]);
  cert.setExtensions([
    { name: 'basicConstraints', cA: params.ca },
    { name: 'keyUsage', keyCertSign: params.ca, digitalSignature: true },
  ]);
  const signingKey = forge.pki.privateKeyFromPem(params.issuer.keyPem);
  cert.sign(signingKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
};

const rsa = () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};

// ---- minimal zip reader (central directory; stored or deflated) ------------

const unzip = (buf: Buffer): Record<string, Buffer> => {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files[name] = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
};

const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// ---- fixtures ---------------------------------------------------------------

beforeAll(async () => {
  db = await setupTestDb();
  rig = await buildTestRig(db);
  apple = await import('../src/lib/wallet/apple.js');

  const caKeys = rsa();
  // Self-signed: issued and signed by its own key.
  caPem = makeCert({
    subject: 'Test WWDR G4',
    publicKeyPem: caKeys.publicPem,
    issuer: { name: 'Test WWDR G4', keyPem: caKeys.privatePem },
    ca: true,
  });
  const signerKeys = rsa();
  const signerPem = makeCert({
    subject: `Pass Type ID: ${PASS_TYPE}`,
    publicKeyPem: signerKeys.publicPem,
    issuer: { name: 'Test WWDR G4', keyPem: caKeys.privatePem },
    ca: false,
  });
  config = {
    passTypeId: PASS_TYPE,
    teamId: 'ABCDE12345',
    signerCert: signerPem,
    signerKey: signerKeys.privatePem,
    wwdr: caPem,
    apnsHost: 'api.push.apple.invalid',
    appPublicUrl: 'http://localhost:3000',
    apiPublicUrl: 'http://localhost:3001',
  };
}, 120_000);

afterAll(async () => {
  apple?.setAppleWalletOverrides(null);
  await rig?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.reset();
  owner = await insertOwner(db.pool, {
    email: 'owner@example.com',
    password: 'hunter2bravo',
    businessName: 'Golden Beauty',
    slug: 'golden-beauty',
  });
});

afterEach(() => {
  apple.setAppleWalletOverrides(null);
});

/** No-network APNs: records tokens, `respond` picks each status. */
const fakeApns = (respond: (token: string) => number = () => 200) => {
  const calls: Array<{ topic: string; tokens: string[] }> = [];
  const push: import('../src/lib/wallet/apple.js').ApnsPush = async (cfg, tokens) => {
    calls.push({ topic: cfg.passTypeId, tokens: [...tokens].sort() });
    return tokens.map((pushToken) => ({ pushToken, status: respond(pushToken) }));
  };
  return { calls, push };
};

const insertCard = async (params: {
  campaignId: string;
  stamps?: number;
  status?: 'Active' | 'Redeemed';
  snapshot?: Record<string, unknown> | null;
}) => {
  const customerId = await insertCustomer(db.pool, owner.userId, { name: 'Ana María Pérez' });
  const uniqueId = randomUUID();
  const id = `ic-${uniqueId}`;
  await db.pool.query(
    `insert into loyalty.issued_cards
       (id, owner_id, customer_id, campaign_id, campaign_name, unique_id, stamps, status, template_snapshot)
     values ($1, $2, $3, $4, 'Uñas', $5, $6, $7, $8)`,
    [
      id,
      owner.userId,
      customerId,
      params.campaignId,
      uniqueId,
      params.stamps ?? 0,
      params.status ?? 'Active',
      params.snapshot ? JSON.stringify(params.snapshot) : null,
    ],
  );
  return { id, uniqueId };
};

const styledCampaign = async () => {
  const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas felices', totalStamps: 10 });
  await db.pool.query(
    `update loyalty.campaigns set reward_name = 'Manicure gratis',
       colors = '{"background":"bg-[#F4E1D2]","text":"#3a2a1f","muted":"text-[#8a6f5c]"}'::jsonb
     where id = $1`,
    [campaignId],
  );
  return campaignId;
};

const getConfig = () => rig.app.inject({ method: 'GET', url: '/public/wallet/config' });
const getPkpass = (slug: string, uniqueId: string) =>
  rig.app.inject({ method: 'GET', url: `/public/cards/${slug}/${uniqueId}/wallet/apple` });

const ws = '/wallet/apple/v1';
const regUrl = (serial: string, passType = PASS_TYPE, device = DEVICE) =>
  `${ws}/devices/${device}/registrations/${passType}/${serial}`;
const auth = (token: string) => ({ authorization: `ApplePass ${token}` });

const readPkpass = (buf: Buffer) => {
  const files = unzip(buf);
  const pass = JSON.parse(files['pass.json']!.toString('utf8'));
  return { files, pass, token: pass.authenticationToken as string };
};

/** Download the pass over HTTP (rate limited: 10/min per IP). */
const download = async (uniqueId: string) => {
  const res = await getPkpass(owner.slug, uniqueId);
  expect(res.statusCode).toBe(200);
  return { res, ...readPkpass(res.rawPayload) };
};

/** Same use case as the download route, without its rate limit. */
const issue = async (uniqueId: string) => {
  const buf = await apple.issueApplePass(owner.slug, uniqueId);
  expect(buf).toBeInstanceOf(Buffer);
  return readPkpass(buf!);
};

const register = (serial: string, token: string, opts: { device?: string; pushToken?: string } = {}) =>
  rig.app.inject({
    method: 'POST',
    url: regUrl(serial, PASS_TYPE, opts.device),
    headers: { ...auth(token), 'content-type': 'application/json' },
    payload: { pushToken: opts.pushToken ?? PUSH_TOKEN },
  });

// ---------------------------------------------------------------------------

describe('Apple Wallet: not configured', () => {
  it('reports apple=false and 404s every route', async () => {
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });

    expect((await getConfig()).json()).toEqual({ ok: true, data: { google: false, apple: false } });
    expect((await getPkpass(owner.slug, card.uniqueId)).statusCode).toBe(404);
    expect((await register(card.uniqueId, 'x'.repeat(64))).statusCode).toBe(404);
    expect((await rig.app.inject({ method: 'GET', url: `${ws}/passes/${PASS_TYPE}/${card.uniqueId}` })).statusCode).toBe(404);
    expect((await rig.app.inject({ method: 'GET', url: `${ws}/devices/${DEVICE}/registrations/${PASS_TYPE}` })).statusCode).toBe(404);
    expect((await rig.app.inject({ method: 'POST', url: `${ws}/log`, payload: { logs: ['x'] } })).statusCode).toBe(404);
    const { rows } = await db.pool.query('select * from loyalty.wallet_passes');
    expect(rows).toHaveLength(0);
  });
});

describe('Apple Wallet: pass download', () => {
  it('reports apple=true', async () => {
    apple.setAppleWalletOverrides({ config });
    expect((await getConfig()).json()).toEqual({ ok: true, data: { google: false, apple: true } });
  });

  it('serves a signed pkpass with the card state, live campaign colors and images', async () => {
    apple.setAppleWalletOverrides({ config });
    const campaignId = await styledCampaign();
    const card = await insertCard({
      campaignId,
      stamps: 4,
      // Live campaign colors win over the snapshot.
      snapshot: { totalStamps: 10, colors: { background: '#000000', text: '#ffffff', muted: '#cccccc' } },
    });

    const { res, files, pass, token } = await download(card.uniqueId);
    expect(res.headers['content-type']).toBe('application/vnd.apple.pkpass');
    expect(res.headers['content-disposition']).toBe('attachment; filename="tarjeta.pkpass"');
    expect(res.headers['cache-control']).toBe('no-store');

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE,
      teamIdentifier: 'ABCDE12345',
      serialNumber: card.uniqueId,
      webServiceURL: 'http://localhost:3001/wallet/apple',
      organizationName: 'Golden Beauty',
      description: 'Tarjeta de sellos de Golden Beauty',
      logoText: 'Uñas felices',
      backgroundColor: 'rgb(244, 225, 210)',
      foregroundColor: 'rgb(58, 42, 31)',
      labelColor: 'rgb(138, 111, 92)',
      barcodes: [
        {
          format: 'PKBarcodeFormatQR',
          message: `http://localhost:3000/golden-beauty/scan/${card.uniqueId}`,
          messageEncoding: 'iso-8859-1',
        },
      ],
    });
    expect(pass.voided).toBeUndefined();
    expect(pass.storeCard.primaryFields).toEqual([
      { key: 'stamps', label: 'Sellos', value: '4/10', changeMessage: 'Ahora tienes %@ sellos' },
    ]);
    expect(pass.storeCard.secondaryFields).toEqual([
      { key: 'reward', label: 'Recompensa', value: 'Manicure gratis' },
      { key: 'customer', label: 'Cliente', value: 'Ana' },
    ]);
    expect(pass.storeCard.backFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'card', value: `http://localhost:3000/golden-beauty/${card.uniqueId}?src=wallet` }),
        expect.objectContaining({ key: 'business', value: 'Golden Beauty' }),
      ]),
    );

    // Images at the sizes Wallet expects.
    for (const [name, size] of [['icon.png', 29], ['icon@2x.png', 58], ['icon@3x.png', 87], ['logo.png', 50], ['logo@2x.png', 100]] as const) {
      expect(files[name], name).toBeDefined();
      const meta = await sharp(files[name]!).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', size, size]);
    }

    // Manifest covers every other file with its sha1.
    const manifest = JSON.parse(files['manifest.json']!.toString('utf8')) as Record<string, string>;
    const content = Object.keys(files).filter((f) => f !== 'manifest.json' && f !== 'signature').sort();
    expect(Object.keys(manifest).sort()).toEqual(content);
    for (const f of content) expect(manifest[f], f).toBe(sha1(files[f]!));

    // PKCS#7 detached signature carrying the signer + WWDR certificates.
    const signature = files['signature']!;
    expect(signature.length).toBeGreaterThan(500);
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(signature.toString('binary')))) as forge.pkcs7.PkcsSignedData;
    expect(p7.certificates.map((c) => c.subject.getField('CN').value).sort()).toEqual(
      [`Pass Type ID: ${PASS_TYPE}`, 'Test WWDR G4'].sort(),
    );
    if (hasOpenssl) {
      const dir = mkdtempSync(join(tmpdir(), 'pkpass-'));
      try {
        writeFileSync(join(dir, 'manifest.json'), files['manifest.json']!);
        writeFileSync(join(dir, 'signature'), signature);
        writeFileSync(join(dir, 'ca.pem'), caPem);
        execFileSync('openssl', [
          'cms', '-verify', '-binary', '-inform', 'DER', '-in', join(dir, 'signature'),
          '-content', join(dir, 'manifest.json'), '-CAfile', join(dir, 'ca.pem'), '-purpose', 'any', '-out', '/dev/null',
        ], { stdio: 'pipe' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const { rows } = await db.pool.query('select * from loyalty.wallet_passes');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ card_id: card.id, provider: 'apple', object_id: card.uniqueId, auth_token: token });
  });

  it('keeps the same auth token across downloads and voids redeemed cards', async () => {
    apple.setAppleWalletOverrides({ config });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId, stamps: 9, status: 'Redeemed' });

    const first = await download(card.uniqueId);
    const second = await issue(card.uniqueId);
    expect(second.token).toBe(first.token);
    expect(first.pass.voided).toBe(true);
    // No snapshot → campaign total; white fallback background, dark text.
    expect(first.pass.storeCard.primaryFields[0].value).toBe('9/10');
    expect(first.pass.backgroundColor).toBe('rgb(255, 255, 255)');
    const { rows } = await db.pool.query('select * from loyalty.wallet_passes');
    expect(rows).toHaveLength(1);
  });

  it('404s for unknown cards, other businesses and malformed ids', async () => {
    apple.setAppleWalletOverrides({ config });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });
    await insertOwner(db.pool, { email: 'other@example.com', password: 'hunter2bravo', businessName: 'Other', slug: 'other' });

    expect((await getPkpass(owner.slug, randomUUID())).statusCode).toBe(404);
    expect((await getPkpass('other', card.uniqueId)).statusCode).toBe(404);
    expect((await getPkpass(owner.slug, 'not-a-uuid')).statusCode).toBe(404);
  });

  it('answers 502 when signing fails', async () => {
    apple.setAppleWalletOverrides({ config: { ...config, signerKey: 'garbage' } });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });
    const res = await getPkpass(owner.slug, card.uniqueId);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('WALLET_UNAVAILABLE');
  });
});

describe('Apple Wallet: PassKit web service', () => {
  it('registers (201 then 200), lists, and unregisters a device', async () => {
    apple.setAppleWalletOverrides({ config });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId, stamps: 2 });
    const { token } = await issue(card.uniqueId);

    expect((await register(card.uniqueId, token)).statusCode).toBe(201);
    const again = await register(card.uniqueId, token, { pushToken: 'a'.repeat(64) });
    expect(again.statusCode).toBe(200);
    const { rows } = await db.pool.query('select * from loyalty.wallet_devices');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ device_library_id: DEVICE, pass_type_id: PASS_TYPE, serial: card.uniqueId, push_token: 'a'.repeat(64) });

    const list = await rig.app.inject({ method: 'GET', url: `${ws}/devices/${DEVICE}/registrations/${PASS_TYPE}` });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { serialNumbers: string[]; lastUpdated: string };
    expect(body.serialNumbers).toEqual([card.uniqueId]);
    expect(body.lastUpdated).toMatch(/^\d+$/);

    const del = await rig.app.inject({ method: 'DELETE', url: regUrl(card.uniqueId), headers: auth(token) });
    expect(del.statusCode).toBe(200);
    expect((await db.pool.query('select * from loyalty.wallet_devices')).rows).toHaveLength(0);
    const empty = await rig.app.inject({ method: 'GET', url: `${ws}/devices/${DEVICE}/registrations/${PASS_TYPE}` });
    expect(empty.statusCode).toBe(204);
  });

  it('rejects missing/wrong tokens (401), wrong pass types (404) and bad push tokens (400)', async () => {
    apple.setAppleWalletOverrides({ config });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });
    const other = await insertCard({ campaignId });
    const { token } = await issue(card.uniqueId);
    const { token: otherToken } = await issue(other.uniqueId);

    expect((await register(card.uniqueId, 'f'.repeat(64))).statusCode).toBe(401);
    // Another pass's token doesn't open this one.
    expect((await register(card.uniqueId, otherToken)).statusCode).toBe(401);
    const noAuth = await rig.app.inject({
      method: 'POST',
      url: regUrl(card.uniqueId),
      headers: { 'content-type': 'application/json' },
      payload: { pushToken: PUSH_TOKEN },
    });
    expect(noAuth.statusCode).toBe(401);
    const bearer = await rig.app.inject({
      method: 'GET',
      url: `${ws}/passes/${PASS_TYPE}/${card.uniqueId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.statusCode).toBe(401);
    // Unknown serial with a plausible token.
    expect((await register(randomUUID(), token)).statusCode).toBe(401);
    expect((await register('nope', token)).statusCode).toBe(401);

    const wrongType = await rig.app.inject({
      method: 'POST',
      url: regUrl(card.uniqueId, 'pass.com.someone.else'),
      headers: { ...auth(token), 'content-type': 'application/json' },
      payload: { pushToken: PUSH_TOKEN },
    });
    expect(wrongType.statusCode).toBe(404);
    expect((await rig.app.inject({ method: 'GET', url: `${ws}/passes/pass.com.someone.else/${card.uniqueId}`, headers: auth(token) })).statusCode).toBe(404);
    expect((await rig.app.inject({ method: 'GET', url: `${ws}/devices/${DEVICE}/registrations/pass.com.someone.else` })).statusCode).toBe(404);
    expect((await rig.app.inject({ method: 'DELETE', url: regUrl(card.uniqueId), headers: auth(otherToken) })).statusCode).toBe(401);

    expect((await register(card.uniqueId, token, { pushToken: '../../evil' })).statusCode).toBe(400);
    expect((await db.pool.query('select * from loyalty.wallet_devices')).rows).toHaveLength(0);
  });

  it('passesUpdatedSince only returns passes changed after the tag', async () => {
    apple.setAppleWalletOverrides({ config, push: fakeApns().push });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const a = await insertCard({ campaignId });
    const b = await insertCard({ campaignId });
    const ta = (await issue(a.uniqueId)).token;
    const tb = (await issue(b.uniqueId)).token;
    expect((await register(a.uniqueId, ta)).statusCode).toBe(201);
    expect((await register(b.uniqueId, tb)).statusCode).toBe(201);
    // A device that only has `a`.
    expect((await register(a.uniqueId, ta, { device: 'other-device' })).statusCode).toBe(201);

    const list = (since?: string, device = DEVICE) =>
      rig.app.inject({
        method: 'GET',
        url: `${ws}/devices/${device}/registrations/${PASS_TYPE}${since ? `?passesUpdatedSince=${since}` : ''}`,
      });

    const all = (await list()).json() as { serialNumbers: string[]; lastUpdated: string };
    expect(all.serialNumbers.sort()).toEqual([a.uniqueId, b.uniqueId].sort());
    expect((await list(all.lastUpdated)).statusCode).toBe(204);

    await apple.notifyApplePass(b.id);
    const changed = await list(all.lastUpdated);
    expect(changed.statusCode).toBe(200);
    const body = changed.json() as { serialNumbers: string[]; lastUpdated: string };
    expect(body.serialNumbers).toEqual([b.uniqueId]);
    expect(BigInt(body.lastUpdated)).toBeGreaterThan(BigInt(all.lastUpdated));
    expect((await list(body.lastUpdated)).statusCode).toBe(204);
    // The other device never had `b`.
    expect((await list(all.lastUpdated, 'other-device')).statusCode).toBe(204);
    // Garbage tags count as "no tag".
    expect(((await list('abc')).json() as { serialNumbers: string[] }).serialNumbers).toHaveLength(2);
  });

  it('serves the latest pass with Last-Modified and honors If-Modified-Since', async () => {
    apple.setAppleWalletOverrides({ config, push: fakeApns().push });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId, stamps: 1 });
    const { token } = await issue(card.uniqueId);
    const url = `${ws}/passes/${PASS_TYPE}/${card.uniqueId}`;

    const first = await rig.app.inject({ method: 'GET', url, headers: auth(token) });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('application/vnd.apple.pkpass');
    const lastModified = first.headers['last-modified'] as string;
    expect(Number.isFinite(Date.parse(lastModified))).toBe(true);

    const notModified = await rig.app.inject({ method: 'GET', url, headers: { ...auth(token), 'if-modified-since': lastModified } });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.rawPayload.length).toBe(0);

    // The card changes twice within the same second: still never a stale 304.
    await db.pool.query('update loyalty.issued_cards set stamps = 3 where id = $1', [card.id]);
    await apple.notifyApplePass(card.id);
    const updated = await rig.app.inject({ method: 'GET', url, headers: { ...auth(token), 'if-modified-since': lastModified } });
    expect(updated.statusCode).toBe(200);
    expect(Date.parse(updated.headers['last-modified'] as string)).toBeGreaterThan(Date.parse(lastModified));
    const pass = JSON.parse(unzip(updated.rawPayload)['pass.json']!.toString('utf8'));
    expect(pass.storeCard.primaryFields[0].value).toBe('3/10');
    expect(pass.authenticationToken).toBe(token);

    await apple.notifyApplePass(card.id);
    const again = await rig.app.inject({
      method: 'GET',
      url,
      headers: { ...auth(token), 'if-modified-since': updated.headers['last-modified'] as string },
    });
    expect(again.statusCode).toBe(200);

    expect((await rig.app.inject({ method: 'GET', url, headers: auth('0'.repeat(64)) })).statusCode).toBe(401);
  });

  it('accepts device logs', async () => {
    apple.setAppleWalletOverrides({ config });
    const res = await rig.app.inject({ method: 'POST', url: `${ws}/log`, payload: { logs: ['Web service error'] } });
    expect(res.statusCode).toBe(200);
  });
});

describe('Apple Wallet: notifyApplePass', () => {
  it('bumps updated_at and pushes only this pass’s devices, dropping 410s', async () => {
    const apns = fakeApns((t) => (t === 'b'.repeat(64) ? 410 : 200));
    apple.setAppleWalletOverrides({ config, push: apns.push });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });
    const other = await insertCard({ campaignId });
    const { token } = await issue(card.uniqueId);
    const { token: otherToken } = await issue(other.uniqueId);
    await register(card.uniqueId, token, { device: 'd1', pushToken: 'a'.repeat(64) });
    await register(card.uniqueId, token, { device: 'd2', pushToken: 'b'.repeat(64) });
    await register(other.uniqueId, otherToken, { device: 'd3', pushToken: 'c'.repeat(64) });
    const before = (await db.pool.query('select updated_at from loyalty.wallet_passes where card_id = $1', [card.id])).rows[0].updated_at as Date;

    const result = await apple.notifyApplePass(card.id);
    expect(result?.unregistered).toBe(1);
    expect(apns.calls).toEqual([{ topic: PASS_TYPE, tokens: ['a'.repeat(64), 'b'.repeat(64)] }]);
    const after = (await db.pool.query('select updated_at from loyalty.wallet_passes where card_id = $1', [card.id])).rows[0].updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    const { rows } = await db.pool.query('select device_library_id from loyalty.wallet_devices order by 1');
    expect(rows.map((r) => r.device_library_id)).toEqual(['d1', 'd3']);
  });

  it('is a no-op without an Apple pass or when Apple Wallet is off', async () => {
    const apns = fakeApns();
    apple.setAppleWalletOverrides({ config, push: apns.push });
    const campaignId = await insertCampaign(db.pool, owner.userId, { name: 'Uñas' });
    const card = await insertCard({ campaignId });
    expect(await apple.notifyApplePass(card.id)).toBeNull();

    await issue(card.uniqueId);
    apple.setAppleWalletOverrides({ config: null, push: apns.push });
    expect(await apple.notifyApplePass(card.id)).toBeNull();
    expect(apns.calls).toHaveLength(0);
  });

  it('isAuthorized is strict about the scheme', () => {
    expect(apple.isAuthorized('ApplePass abc123', 'abc123')).toBe(true);
    expect(apple.isAuthorized('ApplePass abc1234', 'abc123')).toBe(false);
    expect(apple.isAuthorized('applepass abc123', 'abc123')).toBe(false);
    expect(apple.isAuthorized(undefined, 'abc123')).toBe(false);
    expect(apple.isAuthorized('ApplePass abc123', null)).toBe(false);
  });
});
