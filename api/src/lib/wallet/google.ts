// Google Wallet loyalty passes (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
//
//   - One LoyaltyClass per campaign (program name, business name, logo, color).
//   - One LoyaltyObject per issued card (stamp count, staff-scan QR, link back
//     to the card). Google pushes object changes to the client's device.
//   - "Save to Google Wallet" is a signed JWT link (pay.google.com/gp/v/save/…).
//
// What lives where. Business-wide content goes on the class, so editing the
// campaign updates every pass at once: hero image (campaign background via
// GET /public/brand/:slug/hero.jpg), contact links (WhatsApp, maps, call,
// Instagram), the "Horario" text module, and the save/delete callback URL.
// Per-client content goes on the object: stamps, "Sellos de la suerte"
// (secondaryLoyaltyPoints, game bonus stamps), the "Te faltan…" line, the
// client level, the barcode short code and the link back to the card.
//
// Client level: Google's `rewardsTier` exists only on the LoyaltyClass (one
// value for every pass of the campaign); the LoyaltyObject has no per-object
// tier field (checked against the v1 LoyaltyObject reference), and
// secondaryLoyaltyPoints is taken by the lucky stamps. So the level is an
// object text module ("Tu nivel"), and a level-up notifies through
// addMessage instead of a tier-field update.
//
// Notifications (passContent.ts / notifyBudget.ts): at most one per sync —
// a balance PATCH with notifyPreference NOTIFY_ON_UPDATE for a stamp, or an
// addMessage(TEXT_AND_NOTIFY) for reward ready / gift / level up / weekly
// game — within Google's 3-per-pass-per-24h budget, counted on our side.
//
// Env-gated: with no GOOGLE_WALLET_* credentials `googleWalletConfig()` is
// null and nothing here touches the network. Tests install a config and a fake
// HTTP layer with `setGoogleWalletOverrides()` (cf. setStorageOverrides).
import { importPKCS8, SignJWT, type KeyLike } from 'jose';
import { JWT } from 'google-auth-library';
import { env } from '../../config.js';
import { db } from '../../db/kysely.js';
import { normalizeSlug } from '../slug.js';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { ClientLevel } from '../../db/types.js';
import {
  contactFrom,
  contactLinks,
  levelFor,
  levelLabel,
  messageFor,
  noChanges,
  planNotifications,
  progressText,
  shortCode,
  type BusinessContact,
  type CardChanges,
  type WalletMessage,
} from './passContent.js';
import { claimNotification, releaseNotification } from './notifyBudget.js';

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
  /** Replaces the fetch of Google's callback signing keys (googleCallback.ts). */
  callbackKeys?: () => Promise<unknown>;
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

export const googleWalletOverrides = (): GoogleWalletOverrides | null => overrides;

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
  rewardName: string;
  /** Business contact from the live campaign's social links. */
  contact: BusinessContact;
  /** Live campaign background image reference (the hero image), if any. */
  heroRef: string | null;
  /** Real visits (stamp_add) on all of this client's cards with the business. */
  visits: number;
  level: ClientLevel;
  /** Game bonus stamps on this card ("Sellos de la suerte"). */
  luckyStamps: number;
}

const absolute = (base: string, path: string) => `${trimSlash(base)}${path}`;

const localized = (value: string) => ({ defaultValue: { language: 'es-CO', value } });

/** Short content hash: busts Google's image cache when the background changes. */
const versionOf = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 10);

/** Hero image URL (campaign background, resized by publicPwa.ts), or null. */
export const heroUrl = (config: GoogleWalletConfig, data: Pick<CardPassData, 'slug' | 'campaignKey' | 'heroRef'>) =>
  data.heroRef && !data.campaignKey.startsWith('owner_')
    ? absolute(
        config.apiPublicUrl,
        `/public/brand/${encodeURIComponent(data.slug)}/hero.jpg?c=${encodeURIComponent(data.campaignKey)}&v=${versionOf(data.heroRef)}`,
      )
    : null;

export const callbackUrl = (config: GoogleWalletConfig) => absolute(config.apiPublicUrl, '/wallet/google/callback');

export const buildLoyaltyClass = (config: GoogleWalletConfig, data: CardPassData) => {
  const name = data.businessName.trim() || data.programName;
  const hero = heroUrl(config, data);
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
      contentDescription: localized(name),
    },
    ...(hero ? { heroImage: { sourceUri: { uri: hero }, contentDescription: localized(name) } } : {}),
    hexBackgroundColor: data.background,
    // Always sent (empty when unset) so clearing a field in the editor clears
    // it on the passes: PATCH leaves omitted fields untouched.
    textModulesData: data.contact.hours ? [{ id: 'hours', header: 'Horario', body: data.contact.hours }] : [],
    linksModuleData: {
      uris: contactLinks(data.contact).map((l) => ({ id: l.id, uri: l.uri, description: l.description })),
    },
    // Save / delete events → POST /wallet/google/callback (routes/wallet.ts).
    callbackOptions: { url: callbackUrl(config) },
    reviewStatus: 'UNDER_REVIEW',
    countryCode: 'CO',
  };
};

/** The mutable part of an object: what onCardChanged patches. */
export const buildObjectState = (config: GoogleWalletConfig, data: CardPassData) => {
  const app = trimSlash(config.appPublicUrl);
  const slug = encodeURIComponent(data.slug);
  const uid = encodeURIComponent(data.uniqueId);
  return {
    state: data.status === 'Redeemed' ? 'INACTIVE' : 'ACTIVE',
    loyaltyPoints: {
      label: 'Sellos',
      balance: { string: `${Math.max(0, data.stamps)}/${data.totalStamps}` },
    },
    ...(data.luckyStamps > 0
      ? { secondaryLoyaltyPoints: { label: 'Sellos de la suerte', balance: { int: data.luckyStamps } } }
      : {}),
    textModulesData: [
      { id: 'progress', header: 'Tu recompensa', body: progressText(data.stamps, data.totalStamps, data.rewardName) },
      { id: 'level', header: 'Tu nivel', body: levelLabel(data.level) },
    ],
    // Same QR as the card: staff scan it to open the card in the kiosk
    // (buildStaffScanEntryUrl in lib/links.ts). The short code under it is
    // what staff type when the QR won't scan.
    barcode: { type: 'QR_CODE', value: `${app}/${slug}/scan/${uid}`, alternateText: shortCode(data.uniqueId) },
    linksModuleData: {
      uris: [{ id: 'card', uri: `${app}/${slug}/${uid}?src=wallet`, description: 'Ver mi tarjeta' }],
    },
  };
};

export const buildLoyaltyObject = (config: GoogleWalletConfig, data: CardPassData) => ({
  id: objectIdFor(config, data.uniqueId),
  classId: classIdFor(config, data.campaignKey),
  ...buildObjectState(config, data),
  accountName: firstName(data.customerName) || data.customerName,
});

/** A Google `Message` for addMessage. */
export const buildMessage = (id: string, message: WalletMessage, notify: boolean, endsAt: Date) => ({
  id,
  header: message.header,
  body: message.body,
  messageType: notify ? 'TEXT_AND_NOTIFY' : 'TEXT',
  displayInterval: { end: { date: endsAt.toISOString() } },
});

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

  /** Adds a message to an object. Returns false when Google no longer has it. */
  async addMessage(objectId: string, message: ReturnType<typeof buildMessage>): Promise<boolean> {
    const res = await this.call(
      { method: 'POST', path: `/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`, body: { message } },
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
      'issued_cards.customer_id as customerId',
      'issued_cards.campaign_id as campaignId',
      'issued_cards.campaign_name as cardCampaignName',
      'issued_cards.stamps as stamps',
      'issued_cards.status as status',
      'issued_cards.template_snapshot as snapshot',
      'profiles.slug as slug',
      'profiles.business_name as businessName',
      'customers.name as customerName',
      'campaigns.name as campaignName',
      'campaigns.reward_name as campaignReward',
      'campaigns.total_stamps as campaignTotal',
      'campaigns.colors as campaignColors',
      'campaigns.social as campaignSocial',
      'campaigns.background_image as campaignBackground',
    ])
    // Visits across all of the client's cards with this business (level) and
    // this card's game bonus stamps.
    .select([
      sql<string>`(
        select count(*) from loyalty.transactions t
        join loyalty.issued_cards c on c.id = t.card_id
        where c.customer_id = issued_cards.customer_id and c.owner_id = issued_cards.owner_id
          and t.type = 'stamp_add'
      )`.as('visits'),
      sql<string>`(
        select coalesce(sum(t.amount), 0) from loyalty.transactions t
        where t.card_id = issued_cards.id and t.type = 'bonus'
      )`.as('lucky'),
    ])
    .where('profiles.role', '=', 'owner');

type CardPassRow = NonNullable<Awaited<ReturnType<ReturnType<typeof cardPassQuery>['executeTakeFirst']>>>;

const colorOf = (colors: unknown) =>
  colors && typeof colors === 'object' ? firstHex((colors as Record<string, unknown>)['background']) : null;

const str = (value: unknown) => (typeof value === 'string' ? value : '');

export const toCardPassData = (row: CardPassRow): CardPassData => {
  // The card's own snapshot is what the customer sees, so it wins.
  const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
  const snapshotTotal = Number(snapshot['totalStamps']);
  const totalStamps = Number.isFinite(snapshotTotal) && snapshotTotal > 0 ? snapshotTotal : (row.campaignTotal ?? 10);
  const visits = Number(row.visits ?? 0);
  return {
    cardId: row.cardId,
    uniqueId: row.uniqueId,
    slug: row.slug ?? '',
    campaignKey: row.campaignId ?? `owner_${row.ownerId}`,
    programName: row.campaignName ?? (row.cardCampaignName || str(snapshot['name'])),
    businessName: row.businessName ?? '',
    customerName: row.customerName,
    stamps: row.stamps,
    totalStamps,
    status: row.status === 'Redeemed' ? 'Redeemed' : 'Active',
    // The class is shared by every card of the campaign, so its color and
    // contact info must come from the live campaign; per-card snapshots would
    // make passes flip.
    background: colorOf(row.campaignColors) ?? colorOf(snapshot['colors']) ?? DEFAULT_BG,
    rewardName: row.campaignReward ?? str(snapshot['rewardName']),
    contact: contactFrom(row.campaignId ? row.campaignSocial : snapshot['social']),
    heroRef: row.campaignBackground || null,
    visits,
    level: levelFor(visits),
    luckyStamps: Number(row.lucky ?? 0),
  };
};

const loadByPublicId = async (slug: string, uniqueId: string) => {
  const row = await cardPassQuery()
    .where('profiles.slug', '=', normalizeSlug(slug))
    .where('issued_cards.unique_id', '=', uniqueId)
    .executeTakeFirst();
  return row && row.slug ? toCardPassData(row) : null;
};

export const loadCardPassData = async (cardId: string) => {
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
  const synced = { last_synced_at: new Date(), synced_stamps: data.stamps, synced_level: data.level };
  await db
    .insertInto('wallet_passes')
    .values({ card_id: data.cardId, provider: 'google', object_id: object.id, ...synced })
    .onConflict((oc) => oc.columns(['card_id', 'provider']).doUpdateSet({ object_id: object.id, ...synced }))
    .execute();
  return client.saveUrl(object.id);
};

/** Messages we keep on a pass when adding a new one (Google caps objects at 10). */
const KEEP_MESSAGES = 4;
const MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sends a message to an object. Before adding, the object's message list is
 * reset to our last few (as plain TEXT, so nothing re-notifies) — Google
 * keeps every message and rejects objects with too many.
 */
const sendMessage = async (
  client: GoogleWalletClient,
  params: { cardId: string; objectId: string; claimId: string; message: ReturnType<typeof buildMessage> },
): Promise<boolean> => {
  const previous = await db
    .selectFrom('wallet_notifications')
    .select('message')
    .where('card_id', '=', params.cardId)
    .where('provider', '=', 'google')
    .where('message', 'is not', null)
    .where('id', '!=', params.claimId)
    .orderBy('id', 'desc')
    .limit(KEEP_MESSAGES)
    .execute();
  const kept = previous
    .map((r) => r.message as ReturnType<typeof buildMessage>)
    .reverse()
    .map((m) => ({ ...m, messageType: 'TEXT' }));
  if (kept.length >= KEEP_MESSAGES) {
    if (!(await client.patchObject(params.objectId, { messages: kept }))) return false;
  }
  return client.addMessage(params.objectId, params.message);
};

/**
 * Pushes the card's current state to its Google pass, with at most one
 * notification (see planNotifications). No-op when Google Wallet is off or
 * the card has no pass. Returns whether it patched.
 */
export const syncGooglePass = async (cardId: string, changes: CardChanges = noChanges()): Promise<boolean> => {
  const client = getGoogleWalletClient();
  if (!client) return false;
  const pass = await db
    .selectFrom('wallet_passes')
    .select(['object_id', 'synced_stamps', 'synced_level'])
    .where('card_id', '=', cardId)
    .where('provider', '=', 'google')
    .executeTakeFirst();
  if (!pass) return false;
  const data = await loadCardPassData(cardId);
  if (!data) return false;

  // Campaign edits (contact info, hero, colors) reach existing passes here;
  // unchanged classes are skipped by the client's cache. A class failure must
  // not hold back the client's own pass: report it after the object.
  let classError: unknown = null;
  await client.upsertClass(buildLoyaltyClass(client.config, data)).catch((err: unknown) => {
    classError = err;
  });

  const [top] = planNotifications(
    { stamps: pass.synced_stamps, level: pass.synced_level },
    { stamps: data.stamps, totalStamps: data.totalStamps, status: data.status, level: data.level },
    changes,
  );
  const message = top ? messageFor(top, { rewardName: data.rewardName, businessName: data.businessName }) : null;
  const claim = top ? await claimNotification({ cardId, provider: 'google', kind: top.kind }) : null;
  const notify = claim?.outcome === 'notify';
  const claimId = claim && claim.outcome !== 'duplicate' ? claim.id : null;

  try {
    const patched = await client.patchObject(pass.object_id, {
      ...buildObjectState(client.config, data),
      // Google only rings for allow-listed fields (loyaltyPoints.balance) and
      // only when asked on that very request.
      ...(notify && top?.kind === 'stamp' ? { notifyPreference: 'NOTIFY_ON_UPDATE' } : {}),
    });
    if (!patched) {
      if (claimId) await releaseNotification(claimId);
      return false;
    }
    if (message && claimId) {
      const payload = buildMessage(`${top!.kind}-${claimId}`, message, notify, new Date(Date.now() + MESSAGE_TTL_MS));
      await db.updateTable('wallet_notifications').set({ message: payload }).where('id', '=', claimId).execute();
      await sendMessage(client, { cardId, objectId: pass.object_id, claimId, message: payload });
    }
  } catch (err) {
    if (claimId) await releaseNotification(claimId);
    throw err;
  }

  await db
    .updateTable('wallet_passes')
    .set({ last_synced_at: new Date(), synced_stamps: data.stamps, synced_level: data.level })
    .where('card_id', '=', cardId)
    .where('provider', '=', 'google')
    .execute();
  if (classError) throw classError;
  return true;
};

/**
 * Weekly game reminder for one Google pass (scheduler). Idempotent per
 * `dedupeKey`. Returns whether a message went out.
 */
export const sendGoogleWeeklyGame = async (
  cardId: string,
  objectId: string,
  dedupeKey: string,
  endsAt: Date,
): Promise<'sent' | 'silent' | 'duplicate' | 'gone'> => {
  const client = getGoogleWalletClient();
  if (!client) return 'gone';
  const claim = await claimNotification({ cardId, provider: 'google', kind: 'weekly_game', dedupeKey });
  if (claim.outcome === 'duplicate') return 'duplicate';
  const notify = claim.outcome === 'notify';
  const message = messageFor({ kind: 'weekly_game' }, { rewardName: '', businessName: '' })!;
  const payload = buildMessage(`weekly_game-${claim.id}`, message, notify, endsAt);
  try {
    await db.updateTable('wallet_notifications').set({ message: payload }).where('id', '=', claim.id).execute();
    const ok = await sendMessage(client, { cardId, objectId, claimId: claim.id, message: payload });
    if (!ok) return 'gone';
  } catch (err) {
    // Keep the dedupe row so a retry can't double-send; just stop counting it.
    await db.updateTable('wallet_notifications').set({ notified: false }).where('id', '=', claim.id).execute();
    throw err;
  }
  return notify ? 'sent' : 'silent';
};
