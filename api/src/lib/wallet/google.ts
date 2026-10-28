// Google Wallet loyalty passes (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
//
//   - One LoyaltyClass per campaign (program name, business name, logo, color).
//   - One LoyaltyObject per issued card (stamp count, staff-scan QR, link back
//     to the card). Google pushes object changes to the client's device.
//   - "Save to Google Wallet" is a signed JWT link (pay.google.com/gp/v/save/…).
//
// Env-gated: with no GOOGLE_WALLET_* credentials `googleWalletConfig()` is
// null and nothing here touches the network. Tests install a config and a fake
// HTTP layer with `setGoogleWalletOverrides()` (cf. setStorageOverrides).
import { importPKCS8, SignJWT, type KeyLike } from 'jose';
import { JWT } from 'google-auth-library';
import { env } from '../../config.js';
import { db } from '../../db/kysely.js';
import { normalizeSlug } from '../slug.js';

export const WALLET_API_BASE = 'https://walletobjects.googleapis.com/walletobjects/v1';
export const WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
export const SAVE_URL_BASE = 'https://pay.google.com/gp/v/save/';
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_BG = '#ffffff';

export interface GoogleWalletConfig {
  issuerId: string;
  serviceAccountEmail: string;
  /** PEM (PKCS#8) private key of the service account. */
  privateKey: string;
  classPrefix: string;
  appPublicUrl: string;
  apiPublicUrl: string;
}

export interface WalletRequest {
  method: 'GET' | 'POST' | 'PATCH';
  /** Path under WALLET_API_BASE, e.g. `/loyaltyObject/123.abc`. */
  path: string;
  body?: unknown;
}
export interface WalletResponse {
  status: number;
  body: unknown;
}
export type WalletHttp = (req: WalletRequest) => Promise<WalletResponse>;

// ---------------------------------------------------------------------------
// Config + test seam
// ---------------------------------------------------------------------------

interface GoogleWalletOverrides {
  /** Replaces the env-derived config (null forces the feature off). */
  config?: GoogleWalletConfig | null;
  /** Replaces the authenticated HTTP layer. */
  http?: WalletHttp;
}

let overrides: GoogleWalletOverrides | null = null;
let cachedClient: GoogleWalletClient | null = null;

export const setGoogleWalletOverrides = (next: GoogleWalletOverrides | null): void => {
  overrides = next;
  cachedClient = null;
};

const trimSlash = (url: string) => url.replace(/\/+$/, '');

const envConfig = (): GoogleWalletConfig | null => {
  if (!env.GOOGLE_WALLET_ISSUER_ID || !env.GOOGLE_WALLET_SA_EMAIL || !env.GOOGLE_WALLET_SA_KEY) return null;
  return {
    issuerId: env.GOOGLE_WALLET_ISSUER_ID,
    serviceAccountEmail: env.GOOGLE_WALLET_SA_EMAIL,
    privateKey: env.GOOGLE_WALLET_SA_KEY,
    classPrefix: env.GOOGLE_WALLET_CLASS_PREFIX,
    appPublicUrl: env.APP_PUBLIC_URL,
    apiPublicUrl: env.API_PUBLIC_URL,
  };
};

export const googleWalletConfig = (): GoogleWalletConfig | null =>
  overrides && 'config' in overrides ? (overrides.config ?? null) : envConfig();

export const isGoogleWalletEnabled = (): boolean => googleWalletConfig() !== null;

/** The configured client, or null when Google Wallet is off. */
export const getGoogleWalletClient = (): GoogleWalletClient | null => {
  const config = googleWalletConfig();
  if (!config) return null;
  if (!cachedClient) cachedClient = new GoogleWalletClient(config, overrides?.http);
  return cachedClient;
};

// ---------------------------------------------------------------------------
// Payload builders (pure)
// ---------------------------------------------------------------------------

/** Google ids are `<issuerId>.<suffix>`, suffix limited to [A-Za-z0-9._-]. */
export const sanitizeIdPart = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');

export const classIdFor = (config: GoogleWalletConfig, campaignKey: string) =>
  `${config.issuerId}.${config.classPrefix}_${sanitizeIdPart(campaignKey)}`;

export const objectIdFor = (config: GoogleWalletConfig, uniqueId: string) =>
  `${config.issuerId}.${config.classPrefix}_${sanitizeIdPart(uniqueId)}`;

/** First #rgb / #rrggbb in a stored color (they may be Tailwind-ish classes). */
export const firstHex = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i);
  if (!match) return null;
  const hex = match[1]!.toLowerCase();
  return `#${hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex}`;
};

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** Everything a pass shows, resolved from the card, its campaign and owner. */
export interface CardPassData {
  cardId: string;
  uniqueId: string;
  slug: string;
  /** Campaign id, or a per-owner key for campaign-less cards. */
  campaignKey: string;
  programName: string;
  businessName: string;
  customerName: string;
  stamps: number;
  totalStamps: number;
  status: 'Active' | 'Redeemed';
  /** #rrggbb */
  background: string;
}

const absolute = (base: string, path: string) => `${trimSlash(base)}${path}`;

export const buildLoyaltyClass = (config: GoogleWalletConfig, data: CardPassData) => {
  const name = data.businessName.trim() || data.programName;
  return {
    id: classIdFor(config, data.campaignKey),
    issuerName: name,
    programName: data.programName || name,
    // The brand icon route (publicPwa.ts) renders the campaign logo on the
    // card color, or the business initial when there is no logo.
    programLogo: {
      sourceUri: {
        uri: absolute(
          config.apiPublicUrl,
          `/public/brand/${encodeURIComponent(data.slug)}/icon-512.png?bg=${data.background.slice(1)}`,
        ),
      },
      contentDescription: { defaultValue: { language: 'es-CO', value: name } },
    },
    hexBackgroundColor: data.background,
    reviewStatus: 'UNDER_REVIEW',
    countryCode: 'CO',
  };
};

/** The mutable part of an object: what onCardChanged patches. */
export const buildObjectState = (data: CardPassData) => ({
  state: data.status === 'Redeemed' ? 'INACTIVE' : 'ACTIVE',
  loyaltyPoints: {
    label: 'Sellos',
    balance: { string: `${Math.max(0, data.stamps)}/${data.totalStamps}` },
  },
});

export const buildLoyaltyObject = (config: GoogleWalletConfig, data: CardPassData) => {
  const app = trimSlash(config.appPublicUrl);
  const slug = encodeURIComponent(data.slug);
  const uid = encodeURIComponent(data.uniqueId);
  return {
    id: objectIdFor(config, data.uniqueId),
    classId: classIdFor(config, data.campaignKey),
    ...buildObjectState(data),
    accountName: firstName(data.customerName) || data.customerName,
    // Same QR as the card: staff scan it to open the card in the kiosk
    // (buildStaffScanEntryUrl in lib/links.ts).
    barcode: { type: 'QR_CODE', value: `${app}/${slug}/scan/${uid}` },
    linksModuleData: {
      uris: [{ id: 'card', uri: `${app}/${slug}/${uid}?src=wallet`, description: 'Ver mi tarjeta' }],
    },
  };
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GoogleWalletError extends Error {
  constructor(
    readonly status: number,
    readonly request: WalletRequest,
    readonly responseBody: unknown,
  ) {
    super(`Google Wallet ${request.method} ${request.path} failed with ${status}`);
    this.name = 'GoogleWalletError';
  }
}

/** Service-account authenticated fetch against the Wallet REST API. */
const defaultHttp = (config: GoogleWalletConfig): WalletHttp => {
  const auth = new JWT({ email: config.serviceAccountEmail, key: config.privateKey, scopes: [WALLET_SCOPE] });
  return async (req) => {
    const { token } = await auth.getAccessToken();
    const res = await fetch(`${WALLET_API_BASE}${req.path}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw text
    }
    return { status: res.status, body };
  };
};

export class GoogleWalletClient {
  private readonly http: WalletHttp;
  // Classes rarely change; skip re-upserting an identical payload.
  private readonly classCache = new Map<string, string>();
  private signingKey: Promise<KeyLike> | null = null;

  constructor(
    readonly config: GoogleWalletConfig,
    http?: WalletHttp,
  ) {
    this.http = http ?? defaultHttp(config);
  }

  private async call(req: WalletRequest, okStatuses: number[] = []): Promise<WalletResponse> {
    const res = await this.http(req);
    if ((res.status >= 200 && res.status < 300) || okStatuses.includes(res.status)) return res;
    throw new GoogleWalletError(res.status, req, res.body);
  }

  /** Insert, or patch when it already exists (409). */
  private async upsert(resource: 'loyaltyClass' | 'loyaltyObject', payload: { id: string }) {
    const inserted = await this.call({ method: 'POST', path: `/${resource}`, body: payload }, [409]);
    if (inserted.status !== 409) return;
    await this.call({ method: 'PATCH', path: `/${resource}/${encodeURIComponent(payload.id)}`, body: payload });
  }

  async upsertClass(payload: ReturnType<typeof buildLoyaltyClass>) {
    const key = JSON.stringify(payload);
    if (this.classCache.get(payload.id) === key) return;
    await this.upsert('loyaltyClass', payload);
    this.classCache.set(payload.id, key);
  }

  async upsertObject(payload: ReturnType<typeof buildLoyaltyObject>) {
    await this.upsert('loyaltyObject', payload);
  }

  /** PATCH an existing object. Returns false when Google no longer has it. */
  async patchObject(objectId: string, patch: Record<string, unknown>): Promise<boolean> {
    const res = await this.call(
      { method: 'PATCH', path: `/loyaltyObject/${encodeURIComponent(objectId)}`, body: patch },
      [404],
    );
    return res.status !== 404;
  }

  /** Signed "Save to Google Wallet" link for an existing object. */
  async saveUrl(objectId: string): Promise<string> {
    this.signingKey ??= importPKCS8(this.config.privateKey, 'RS256');
    const key = await this.signingKey.catch((err) => {
      this.signingKey = null;
      throw err;
    });
    const jwt = await new SignJWT({
      typ: 'savetowallet',
      origins: [new URL(this.config.appPublicUrl).origin],
      payload: { loyaltyObjects: [{ id: objectId }] },
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.config.serviceAccountEmail)
      .setAudience('google')
      .setIssuedAt()
      .sign(key);
    return `${SAVE_URL_BASE}${jwt}`;
  }
}

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

const cardPassQuery = () =>
  db
    .selectFrom('issued_cards')
    .innerJoin('profiles', 'profiles.id', 'issued_cards.owner_id')
    .innerJoin('customers', 'customers.id', 'issued_cards.customer_id')
    .leftJoin('campaigns', 'campaigns.id', 'issued_cards.campaign_id')
    .select([
      'issued_cards.id as cardId',
      'issued_cards.unique_id as uniqueId',
      'issued_cards.owner_id as ownerId',
      'issued_cards.campaign_id as campaignId',
      'issued_cards.campaign_name as cardCampaignName',
      'issued_cards.stamps as stamps',
      'issued_cards.status as status',
      'issued_cards.template_snapshot as snapshot',
      'profiles.slug as slug',
      'profiles.business_name as businessName',
      'customers.name as customerName',
      'campaigns.name as campaignName',
      'campaigns.total_stamps as campaignTotal',
      'campaigns.colors as campaignColors',
    ])
    .where('profiles.role', '=', 'owner');

type CardPassRow = NonNullable<Awaited<ReturnType<ReturnType<typeof cardPassQuery>['executeTakeFirst']>>>;

const colorOf = (colors: unknown) =>
  colors && typeof colors === 'object' ? firstHex((colors as Record<string, unknown>)['background']) : null;

export const toCardPassData = (row: CardPassRow): CardPassData => {
  // The card's own snapshot is what the customer sees, so it wins.
  const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
  const snapshotTotal = Number(snapshot['totalStamps']);
  const totalStamps = Number.isFinite(snapshotTotal) && snapshotTotal > 0 ? snapshotTotal : (row.campaignTotal ?? 10);
  const snapshotName = typeof snapshot['name'] === 'string' ? (snapshot['name'] as string) : '';
  return {
    cardId: row.cardId,
    uniqueId: row.uniqueId,
    slug: row.slug ?? '',
    campaignKey: row.campaignId ?? `owner_${row.ownerId}`,
    programName: row.campaignName ?? (row.cardCampaignName || snapshotName),
    businessName: row.businessName ?? '',
    customerName: row.customerName,
    stamps: row.stamps,
    totalStamps,
    status: row.status === 'Redeemed' ? 'Redeemed' : 'Active',
    // The class is shared by every card of the campaign, so its color must come
    // from the live campaign; per-card snapshots would make passes flip colors.
    background: colorOf(row.campaignColors) ?? colorOf(snapshot['colors']) ?? DEFAULT_BG,
  };
};

const loadByPublicId = async (slug: string, uniqueId: string) => {
  const row = await cardPassQuery()
    .where('profiles.slug', '=', normalizeSlug(slug))
    .where('issued_cards.unique_id', '=', uniqueId)
    .executeTakeFirst();
  return row && row.slug ? toCardPassData(row) : null;
};

const loadById = async (cardId: string) => {
  const row = await cardPassQuery().where('issued_cards.id', '=', cardId).executeTakeFirst();
  return row && row.slug ? toCardPassData(row) : null;
};

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

/**
 * Creates/updates the campaign class and the card object, records the pass,
 * and returns the save link. Null when Google Wallet is off or the card is
 * unknown. Google errors propagate (the route turns them into a 502).
 */
export const createGoogleSaveUrl = async (slug: string, uniqueId: string): Promise<string | null> => {
  const client = getGoogleWalletClient();
  if (!client) return null;
  const data = await loadByPublicId(slug, uniqueId);
  if (!data) return null;

  const object = buildLoyaltyObject(client.config, data);
  await client.upsertClass(buildLoyaltyClass(client.config, data));
  await client.upsertObject(object);
  await db
    .insertInto('wallet_passes')
    .values({ card_id: data.cardId, provider: 'google', object_id: object.id, last_synced_at: new Date() })
    .onConflict((oc) =>
      oc.columns(['card_id', 'provider']).doUpdateSet({ object_id: object.id, last_synced_at: new Date() }),
    )
    .execute();
  return client.saveUrl(object.id);
};

/**
 * Pushes the card's current stamp count/state to its Google pass. No-op when
 * Google Wallet is off or the card has no pass. Returns whether it patched.
 */
export const syncGooglePass = async (cardId: string): Promise<boolean> => {
  const client = getGoogleWalletClient();
  if (!client) return false;
  const pass = await db
    .selectFrom('wallet_passes')
    .select('object_id')
    .where('card_id', '=', cardId)
    .where('provider', '=', 'google')
    .executeTakeFirst();
  if (!pass) return false;
  const data = await loadById(cardId);
  if (!data) return false;

  const patched = await client.patchObject(pass.object_id, buildObjectState(data));
  if (patched) {
    await db
      .updateTable('wallet_passes')
      .set({ last_synced_at: new Date() })
      .where('card_id', '=', cardId)
      .where('provider', '=', 'google')
      .execute();
  }
  return patched;
};
