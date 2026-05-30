import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import type { TestDb } from './db.js';
import type { EmailMessage } from '../../src/email/types.js';
import type { PresignUploadResult } from '../../src/storage/gcs.js';

export interface EmailCollector {
  messages: EmailMessage[];
  clear(): void;
  last(): EmailMessage | undefined;
  // Pluck a URL by substring from the most recent email body.
  extractUrl(needle: string): string | undefined;
}

export interface StorageRecorder {
  presignedUploads: Array<{ path: string; contentType: string }>;
  deleted: string[];
  clear(): void;
}

export interface TestRig {
  app: FastifyInstance;
  /** Direct pool to the test DB for assertions / fixtures. */
  pool: TestDb['pool'];
  /** Tear everything down in the right order — call from `afterAll`. */
  close(): Promise<void>;
  emails: EmailCollector;
  storage: StorageRecorder;
}

// ---------------- ENV plumbing ----------------
// We set process.env BEFORE the first dynamic-import of any src/* module so
// that config.ts reads the right values. Vitest's per-file module isolation
// guarantees a fresh src/ graph per test file when `isolate: true` (default).

const setTestEnv = (databaseUrl: string) => {
  process.env.NODE_ENV = 'test';
  // Non-zero positive (zod rejects 0). Unused because tests use inject(), not listen().
  process.env.PORT = '3999';
  process.env.SPA_ORIGIN = 'http://localhost:3000';
  process.env.APP_PUBLIC_URL = 'http://localhost:3000';
  process.env.API_PUBLIC_URL = 'http://localhost:3001';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-must-be-32-chars-long-aaa';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-must-be-32-chars-long-bbb';
  process.env.JWT_ACCESS_TTL = '15m';
  process.env.JWT_REFRESH_TTL = '30d';
  process.env.BCRYPT_COST = '4'; // fast in tests
  process.env.PIN_BCRYPT_COST = '4';
  process.env.EMAIL_ADAPTER = 'test';
  process.env.GCS_BUCKET = 'test-bucket';
  process.env.GCS_PROJECT_ID = 'test-project';
  process.env.GCS_PUBLIC_HOST = 'https://storage.googleapis.com';
  process.env.LOG_LEVEL = 'error';
  process.env.COOKIE_DOMAIN = '';
  process.env.COOKIE_SECURE = 'false';
};

// ---------------- Rig ----------------

export const buildTestRig = async (db: TestDb): Promise<TestRig> => {
  setTestEnv(db.container.getConnectionUri());

  // Dynamic imports so env-driven config reads the values above.
  const { buildApp } = await import('../../src/server.js');
  const { setEmailAdapter } = await import('../../src/email/index.js');
  const { setStorageOverrides } = await import('../../src/storage/gcs.js');
  const { pool: apiPool } = await import('../../src/db/pool.js');

  // ----- email collector -----
  const messages: EmailMessage[] = [];
  setEmailAdapter({
    async send(msg: EmailMessage) {
      messages.push(msg);
    },
  });
  const emails: EmailCollector = {
    messages,
    clear: () => {
      messages.length = 0;
    },
    last: () => messages[messages.length - 1],
    extractUrl: (needle: string) => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        const match = m.text.match(new RegExp(`https?://\\S*${needle}\\S*`));
        if (match) return match[0];
      }
      return undefined;
    },
  };

  // ----- storage recorder -----
  const presignedUploads: Array<{ path: string; contentType: string }> = [];
  const deleted: string[] = [];
  setStorageOverrides({
    async presignUpload({ path, contentType }): Promise<PresignUploadResult> {
      presignedUploads.push({ path, contentType });
      return {
        uploadUrl: `https://fake-bucket.test/${path}`,
        path,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        readUrl: `https://fake-bucket.test/${path}?read=1`,
      };
    },
    async presignRead(path: string): Promise<string> {
      return `https://fake-bucket.test/${path}?signed=1`;
    },
    async deleteAsset(path: string): Promise<boolean> {
      deleted.push(path);
      return true;
    },
  });
  const storage: StorageRecorder = {
    presignedUploads,
    deleted,
    clear: () => {
      presignedUploads.length = 0;
      deleted.length = 0;
    },
  };

  const app = await buildApp();
  await app.ready();

  return {
    app,
    pool: db.pool,
    emails,
    storage,
    async close() {
      // Order matters: stop Fastify first (drains in-flight requests), then
      // close the app's pg pool so the testcontainer doesn't get killed with
      // open connections still attached (which otherwise raises a
      // "terminating connection due to administrator command" noise during
      // teardown — harmless but distracting).
      await app.close();
      await apiPool.end();
    },
  };
};

// ---------------- Session helper ----------------
// Tracks cookies across multiple inject() calls so a test reads like a session.

export class Session {
  private cookies: Map<string, string> = new Map();

  cookieJarHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  captureFromResponse(response: { cookies: Array<{ name: string; value: string; maxAge?: number }> }): void {
    for (const c of response.cookies) {
      // Max-Age=0 = clear
      if (typeof c.maxAge === 'number' && c.maxAge <= 0) {
        this.cookies.delete(c.name);
      } else {
        this.cookies.set(c.name, c.value);
      }
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  clear(): void {
    this.cookies.clear();
  }
}

// ---------------- Fixture helpers ----------------
// Insert an owner directly into the DB (skip /auth/signup so we don't have
// to fish a verify token out of email). Returns the user/profile ids.

export const insertOwner = async (
  pool: TestDb['pool'],
  params: { email: string; password: string; businessName: string; slug: string },
): Promise<{ userId: string; profileId: string; slug: string }> => {
  const hash = await bcrypt.hash(params.password, 4);
  const { rows: userRows } = await pool.query<{ id: string }>(
    `insert into loyalty.users (email, password_hash, email_verified_at)
     values ($1, $2, now())
     returning id`,
    [params.email.toLowerCase(), hash],
  );
  const userId = userRows[0]!.id;
  await pool.query(
    `insert into loyalty.profiles
       (id, business_name, email, slug, role, owner_id, status, access)
     values ($1, $2, $3, $4, 'owner', null, 'verified', 'active')`,
    [userId, params.businessName, params.email.toLowerCase(), params.slug],
  );
  return { userId, profileId: userId, slug: params.slug };
};

export const insertCampaign = async (
  pool: TestDb['pool'],
  ownerId: string,
  params: { id?: string; name: string; isEnabled?: boolean; totalStamps?: number },
): Promise<string> => {
  const id = params.id ?? `campaign-${Math.random().toString(36).slice(2, 10)}`;
  await pool.query(
    `insert into loyalty.campaigns
       (id, owner_id, name, is_enabled, description, reward_name,
        background_opacity, show_logo, icon_key, colors, total_stamps)
     values ($1, $2, $3, $4, '', '', 100, true, 'Coffee',
             '{"primary":"#000","secondary":"#fff","text":"#000","accent":"#888"}'::jsonb,
             $5)`,
    [id, ownerId, params.name, params.isEnabled ?? true, params.totalStamps ?? 10],
  );
  return id;
};

export const insertCustomer = async (
  pool: TestDb['pool'],
  ownerId: string,
  params: { name: string; email?: string; mobile?: string },
): Promise<string> => {
  const id = `customer-${Math.random().toString(36).slice(2, 10)}`;
  await pool.query(
    `insert into loyalty.customers (id, owner_id, name, email, mobile, status)
     values ($1, $2, $3, $4, $5, 'Active')`,
    [id, ownerId, params.name, params.email ?? '', params.mobile ?? null],
  );
  return id;
};
