import { z } from 'zod';
import 'dotenv/config';

const timeWindow = z.string().regex(/^\d+(ms|s|m|h|d)$/, 'expected a duration like 15m or 30d');
// PEM blobs in env files: accept one line with `\n` escapes.
// PEM from env: `\n` escapes become newlines, and quotes pasted around the
// value (Portainer passes them through literally) are dropped.
const pem = z
  .string()
  .default('')
  .transform((v) => v.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').replace(/\\n/g, '\n').trim());

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  SPA_ORIGIN: z.string().url(),
  APP_PUBLIC_URL: z.string().url(),
  API_PUBLIC_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  PG_POOL_SIZE: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: timeWindow.default('15m'),
  JWT_REFRESH_TTL: timeWindow.default('30d'),
  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_SECURE: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  PIN_BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),

  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Stampee <no-reply@localhost>'),
  EMAIL_ADAPTER: z.enum(['resend', 'console', 'test']).default('console'),

  GCS_BUCKET: z.string().default(''),
  GCS_PROJECT_ID: z.string().default(''),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default(''),
  GCS_PUBLIC_HOST: z.string().url().default('https://storage.googleapis.com'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_WORKSPACE_DOMAIN: z.string().default(''),

  // Google Wallet loyalty passes (docs/CARD_ENGAGEMENT_PLAN.md §7.3). The
  // feature stays off unless issuer id, service-account email and key are all
  // set. The key is the PEM `private_key` from the service-account JSON; `\n`
  // escapes (as found in the JSON / one-line env files) are accepted.
  GOOGLE_WALLET_ISSUER_ID: z.string().trim().default(''),
  GOOGLE_WALLET_SA_EMAIL: z.string().trim().default(''),
  GOOGLE_WALLET_SA_KEY: pem,
  GOOGLE_WALLET_CLASS_PREFIX: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]*$/, 'letters, digits, "_" and "-" only')
    .default('stampee')
    .transform((v) => v || 'stampee'),

  // Apple Wallet passes (docs/CARD_ENGAGEMENT_PLAN.md §7.3). Off unless the
  // pass type id, team id, Pass Type ID certificate + key and the Apple WWDR
  // (G4) certificate are all set. PEMs accept `\n` escapes like
  // GOOGLE_WALLET_SA_KEY. The same certificate authenticates APNs pushes.
  APPLE_PASS_TYPE_ID: z.string().trim().default(''),
  APPLE_TEAM_ID: z.string().trim().default(''),
  APPLE_PASS_CERT: pem,
  APPLE_PASS_KEY: pem,
  APPLE_PASS_KEY_PASSPHRASE: z.string().default(''),
  APPLE_WWDR_CERT: pem,
  APPLE_APNS_HOST: z
    .string()
    .trim()
    .default('api.push.apple.com')
    .transform((v) => v || 'api.push.apple.com'),

  // Reverse-proxy hops in front of the API (Caddy = 1). Rate limits key on the
  // client IP, which is only correct when the proxy's X-Forwarded-For is
  // trusted. Defaults to 1 in production, 0 otherwise.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof Env>;

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
