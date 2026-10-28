// Apple Wallet loyalty passes (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
//
//   - One signed `.pkpass` (storeCard) per issued card; serial number = the
//     card's unique_id. Built on demand: the public download and the PassKit
//     web service both render the card's current state.
//   - Wallet registers each device for updates through the PassKit web service
//     (routes/appleWallet.ts). When a card changes, onCardChanged bumps the
//     pass's `updated_at` and sends an empty APNs push to every registered
//     device; Wallet then asks which passes changed and downloads them again.
//
// Env-gated: with no APPLE_* credentials `appleWalletConfig()` is null and
// nothing here signs or touches the network. Tests install a config and a fake
// APNs layer with `setAppleWalletOverrides()` (cf. setGoogleWalletOverrides).
import { connect, constants as h2 } from 'node:http2';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { PKPass } from 'passkit-generator';
import { env } from '../../config.js';
import { db } from '../../db/kysely.js';
import { normalizeSlug } from '../slug.js';
import { generateToken } from '../tokens.js';
import { UUID_RE } from '../uniqueId.js';
import { cachedLogo, renderIcon } from '../../routes/publicPwa.js';
import { firstHex, firstName } from './google.js';

const APNS_TIMEOUT_MS = 10_000;
const DEFAULT_BG = '#ffffff';

export interface AppleWalletConfig {
  /** e.g. pass.com.goldenbeauty.loyalty — also the APNs topic. */
  passTypeId: string;
  teamId: string;
  /** PEM: the Pass Type ID certificate (signs passes, authenticates APNs). */
  signerCert: string;
  /** PEM: its private key (optionally encrypted with `signerKeyPassphrase`). */
  signerKey: string;
  signerKeyPassphrase?: string;
  /** PEM: Apple WWDR intermediate (G4). */
  wwdr: string;
  apnsHost: string;
  appPublicUrl: string;
  apiPublicUrl: string;
}

export interface ApnsResult {
  pushToken: string;
  /** HTTP status from APNs; 0 when the request never got an answer. */
  status: number;
  reason?: string;
}
/** Sends an empty `{}` pass-update push to each token. Must never throw. */
export type ApnsPush = (config: AppleWalletConfig, pushTokens: string[]) => Promise<ApnsResult[]>;

// ---------------------------------------------------------------------------
// Config + test seam
// ---------------------------------------------------------------------------

interface AppleWalletOverrides {
  /** Replaces the env-derived config (null forces the feature off). */
  config?: AppleWalletConfig | null;
  /** Replaces the HTTP/2 APNs sender. */
  push?: ApnsPush;
}

let overrides: AppleWalletOverrides | null = null;

export const setAppleWalletOverrides = (next: AppleWalletOverrides | null): void => {
  overrides = next;
  imageCache.clear();
};

const trimSlash = (url: string) => url.replace(/\/+$/, '');

const envConfig = (): AppleWalletConfig | null => {
  if (!env.APPLE_PASS_TYPE_ID || !env.APPLE_TEAM_ID || !env.APPLE_PASS_CERT || !env.APPLE_PASS_KEY || !env.APPLE_WWDR_CERT) {
    return null;
  }
  return {
    passTypeId: env.APPLE_PASS_TYPE_ID,
    teamId: env.APPLE_TEAM_ID,
    signerCert: env.APPLE_PASS_CERT,
    signerKey: env.APPLE_PASS_KEY,
    signerKeyPassphrase: env.APPLE_PASS_KEY_PASSPHRASE || undefined,
    wwdr: env.APPLE_WWDR_CERT,
    apnsHost: env.APPLE_APNS_HOST,
    appPublicUrl: env.APP_PUBLIC_URL,
    apiPublicUrl: env.API_PUBLIC_URL,
  };
};

export const appleWalletConfig = (): AppleWalletConfig | null =>
  overrides && 'config' in overrides ? (overrides.config ?? null) : envConfig();

export const isAppleWalletEnabled = (): boolean => appleWalletConfig() !== null;

/** PassKit web service root (pass.json `webServiceURL`). */
export const webServiceUrl = (config: AppleWalletConfig) => `${trimSlash(config.apiPublicUrl)}/wallet/apple`;

// ---------------------------------------------------------------------------
// Pass content (pure)
// ---------------------------------------------------------------------------

/** Everything a pass shows, resolved from the card, its campaign and owner. */
export interface ApplePassData {
  cardId: string;
  ownerId: string;
  uniqueId: string;
  slug: string;
  programName: string;
  businessName: string;
  customerName: string;
  rewardName: string;
  stamps: number;
  totalStamps: number;
  status: 'Active' | 'Redeemed';
  /** #rrggbb */
  background: string;
  foreground: string;
  label: string;
  /** Campaign logo reference (bucket path or URL), if any. */
  logoRef: string | null;
}

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

/** `#rrggbb` → `rgb(r, g, b)`, the only color format pass.json accepts. */
export const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

export const buildPassJson = (config: AppleWalletConfig, data: ApplePassData, authToken: string) => {
  const app = trimSlash(config.appPublicUrl);
  const slug = encodeURIComponent(data.slug);
  const uid = encodeURIComponent(data.uniqueId);
  const business = data.businessName.trim() || data.programName || 'Tarjeta de sellos';
  const cardUrl = `${app}/${slug}/${uid}?src=wallet`;
  const customer = firstName(data.customerName) || data.customerName.trim();
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    teamIdentifier: config.teamId,
    serialNumber: data.uniqueId,
    authenticationToken: authToken,
    webServiceURL: webServiceUrl(config),
    organizationName: business,
    description: `Tarjeta de sellos de ${business}`,
    logoText: data.programName || business,
    foregroundColor: rgb(data.foreground),
    labelColor: rgb(data.label),
    backgroundColor: rgb(data.background),
    // Same QR as the card: staff scan it to open the card in the kiosk
    // (buildStaffScanEntryUrl in lib/links.ts).
    barcodes: [{ format: 'PKBarcodeFormatQR', message: `${app}/${slug}/scan/${uid}`, messageEncoding: 'iso-8859-1' }],
    ...(data.status === 'Redeemed' ? { voided: true } : {}),
    storeCard: {
      primaryFields: [
        {
          key: 'stamps',
          label: 'Sellos',
          value: `${Math.max(0, data.stamps)}/${data.totalStamps}`,
          // Shown as a lock-screen notification when the value changes.
          changeMessage: 'Ahora tienes %@ sellos',
        },
      ],
      secondaryFields: [
        ...(data.rewardName.trim() ? [{ key: 'reward', label: 'Recompensa', value: data.rewardName.trim() }] : []),
        ...(customer ? [{ key: 'customer', label: 'Cliente', value: customer }] : []),
      ],
      backFields: [
        {
          key: 'card',
          label: 'Tu tarjeta',
          value: cardUrl,
          attributedValue: `<a href="${cardUrl}">Ver mi tarjeta</a>`,
        },
        { key: 'business', label: 'Negocio', value: business },
      ],
    },
  };
};

// ---------------------------------------------------------------------------
// Images: brand icon renderer from publicPwa.ts, on the pass background
// ---------------------------------------------------------------------------

// icon.png shows in notifications and Mail; logo.png top-left on the pass
// (max 160×50 pt — a square mark at 50 pt sits next to logoText).
const IMAGE_SIZES: Record<string, number> = {
  'icon.png': 29,
  'icon@2x.png': 58,
  'icon@3x.png': 87,
  'logo.png': 50,
  'logo@2x.png': 100,
};
const IMAGE_CACHE_MAX = 32;
const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const imageCache = new Map<string, { at: number; files: Record<string, Buffer> }>();

const passImages = async (data: ApplePassData): Promise<Record<string, Buffer>> => {
  const key = [data.ownerId, data.background, data.logoRef ?? '', data.businessName].join('|');
  const hit = imageCache.get(key);
  if (hit && Date.now() - hit.at < IMAGE_CACHE_TTL_MS) return hit.files;

  const logo = data.logoRef ? await cachedLogo(data.ownerId, data.logoRef) : null;
  const entries = await Promise.all(
    Object.entries(IMAGE_SIZES).map(async ([name, size]) => {
      const png = await renderIcon({ size, maskable: false, background: data.background, businessName: data.businessName, logo });
      return [name, png] as const;
    }),
  );
  const files = Object.fromEntries(entries);
  // Don't pin a transient logo-fetch failure in the cache.
  if (!data.logoRef || logo) {
    imageCache.delete(key);
    imageCache.set(key, { at: Date.now(), files });
    if (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
  }
  return files;
};

/** The signed `.pkpass` (zip: pass.json, images, manifest.json, signature). */
export const buildPkpass = async (config: AppleWalletConfig, data: ApplePassData, authToken: string): Promise<Buffer> => {
  const images = await passImages(data);
  const pass = new PKPass(
    { 'pass.json': Buffer.from(JSON.stringify(buildPassJson(config, data, authToken))), ...images },
    {
      wwdr: config.wwdr,
      signerCert: config.signerCert,
      signerKey: config.signerKey,
      signerKeyPassphrase: config.signerKeyPassphrase,
    },
  );
  return pass.getAsBuffer();
};

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
      'campaigns.logo_image as campaignLogo',
    ])
    .where('profiles.role', '=', 'owner');

type CardPassRow = NonNullable<Awaited<ReturnType<ReturnType<typeof cardPassQuery>['executeTakeFirst']>>>;

const colorField = (colors: unknown, field: string) =>
  colors && typeof colors === 'object' ? firstHex((colors as Record<string, unknown>)[field]) : null;

const str = (value: unknown) => (typeof value === 'string' ? value : '');

export const toApplePassData = (row: CardPassRow): ApplePassData => {
  const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
  const snapshotTotal = Number(snapshot['totalStamps']);
  const totalStamps = Number.isFinite(snapshotTotal) && snapshotTotal > 0 ? snapshotTotal : (row.campaignTotal ?? 10);
  // Live campaign colors first, so owners can restyle issued passes; the card
  // snapshot covers deleted campaigns.
  const color = (field: string) => colorField(row.campaignColors, field) ?? colorField(snapshot['colors'], field);
  const background = color('background') ?? DEFAULT_BG;
  const foreground = color('text') ?? (luminance(background) > 0.45 ? '#1d1d1f' : '#ffffff');
  return {
    cardId: row.cardId,
    ownerId: row.ownerId,
    uniqueId: row.uniqueId,
    slug: row.slug ?? '',
    programName: row.campaignName ?? (row.cardCampaignName || str(snapshot['name'])),
    businessName: row.businessName ?? '',
    customerName: row.customerName,
    rewardName: row.campaignReward ?? str(snapshot['rewardName']),
    stamps: row.stamps,
    totalStamps,
    status: row.status === 'Redeemed' ? 'Redeemed' : 'Active',
    background,
    foreground,
    label: color('muted') ?? foreground,
    logoRef: row.campaignLogo ?? (str(snapshot['logoImage']) || null),
  };
};

const loadByPublicId = async (slug: string, uniqueId: string) => {
  const row = await cardPassQuery()
    .where('profiles.slug', '=', normalizeSlug(slug))
    .where('issued_cards.unique_id', '=', uniqueId)
    .executeTakeFirst();
  return row && row.slug ? toApplePassData(row) : null;
};

const loadByUniqueId = async (uniqueId: string) => {
  const row = await cardPassQuery().where('issued_cards.unique_id', '=', uniqueId).executeTakeFirst();
  return row && row.slug ? toApplePassData(row) : null;
};

// ---------------------------------------------------------------------------
// Pass records + auth
// ---------------------------------------------------------------------------

/**
 * Creates (or reuses) the card's Apple pass row and returns its auth token.
 *
 * The token is stored in plaintext, unlike our session/reset tokens: every
 * regenerated pass must embed the same value (Wallet keeps using the one it
 * got first), so it has to be recoverable. It only authorizes the PassKit web
 * service for this one pass — re-downloading it and (un)registering devices
 * for its pushes — and the card's own unique_id already grants more than that.
 */
const ensurePassRow = async (cardId: string, serial: string) => {
  const row = await db
    .insertInto('wallet_passes')
    .values({ card_id: cardId, provider: 'apple', object_id: serial, auth_token: generateToken(32) })
    .onConflict((oc) =>
      oc.columns(['card_id', 'provider']).doUpdateSet({
        object_id: serial,
        auth_token: sql<string>`coalesce(wallet_passes.auth_token, excluded.auth_token)`,
      }),
    )
    .returning(['auth_token', 'updated_at'])
    .executeTakeFirstOrThrow();
  return { authToken: row.auth_token!, updatedAt: row.updated_at };
};

/** Constant-time check of an `Authorization: ApplePass <token>` header. */
export const isAuthorized = (header: string | undefined, token: string | null | undefined): boolean => {
  const match = /^ApplePass\s+(\S+)\s*$/.exec(header ?? '');
  if (!match || !token) return false;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(match[1]!), digest(token));
};

export interface StoredApplePass {
  cardId: string;
  serial: string;
  authToken: string | null;
  updatedAt: Date;
}

/** The Apple pass row for a serial number, or null. */
export const findApplePass = async (serial: string): Promise<StoredApplePass | null> => {
  if (!UUID_RE.test(serial)) return null;
  const row = await db
    .selectFrom('wallet_passes')
    .select(['card_id', 'object_id', 'auth_token', 'updated_at'])
    .where('provider', '=', 'apple')
    .where('object_id', '=', serial)
    .executeTakeFirst();
  return row ? { cardId: row.card_id, serial: row.object_id, authToken: row.auth_token, updatedAt: row.updated_at } : null;
};

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

/**
 * The client's "Agregar a Apple Wallet" download: records the pass and returns
 * the signed bundle. Null when Apple Wallet is off or the card is unknown.
 * Signing errors propagate (the route turns them into a 502).
 */
export const issueApplePass = async (slug: string, uniqueId: string): Promise<Buffer | null> => {
  const config = appleWalletConfig();
  if (!config) return null;
  const data = await loadByPublicId(slug, uniqueId);
  if (!data) return null;
  const { authToken } = await ensurePassRow(data.cardId, data.uniqueId);
  return buildPkpass(config, data, authToken);
};

/** The latest bundle for an existing pass (PassKit web service). */
export const renderStoredPass = async (pass: StoredApplePass): Promise<Buffer | null> => {
  const config = appleWalletConfig();
  if (!config || !pass.authToken) return null;
  const data = await loadByUniqueId(pass.serial);
  if (!data) return null;
  return buildPkpass(config, data, pass.authToken);
};

/** `passesUpdatedSince` tags: microseconds since epoch of updated_at, as text. */
const updateTag = sql<string>`floor(extract(epoch from p.updated_at) * 1000000)::bigint::text`;

/**
 * Serial numbers of this device's passes changed after `since` (a tag we
 * returned earlier; absent = all), plus the newest tag among them.
 */
export const updatedSerials = async (
  deviceLibraryId: string,
  passTypeId: string,
  since: string | null,
): Promise<{ serialNumbers: string[]; lastUpdated: string } | null> => {
  const sinceTag = since && /^\d{1,20}$/.test(since) ? since : null;
  const { rows } = await sql<{ serial: string; tag: string }>`
    select p.object_id as serial, ${updateTag} as tag
    from wallet_devices d
    join wallet_passes p on p.provider = 'apple' and p.object_id = d.serial::text
    where d.device_library_id = ${deviceLibraryId}
      and d.pass_type_id = ${passTypeId}
      ${sinceTag ? sql`and floor(extract(epoch from p.updated_at) * 1000000)::bigint > ${sinceTag}::bigint` : sql``}
    order by p.object_id
  `.execute(db);
  if (!rows.length) return null;
  const lastUpdated = rows.reduce((max, r) => (BigInt(r.tag) > BigInt(max) ? r.tag : max), rows[0]!.tag);
  return { serialNumbers: rows.map((r) => r.serial), lastUpdated };
};

/** Registers a device for a pass's pushes. True when the row is new. */
export const registerDevice = async (params: {
  deviceLibraryId: string;
  passTypeId: string;
  serial: string;
  pushToken: string;
}): Promise<boolean> => {
  const { rows } = await sql<{ inserted: boolean }>`
    insert into wallet_devices (device_library_id, push_token, pass_type_id, serial)
    values (${params.deviceLibraryId}, ${params.pushToken}, ${params.passTypeId}, ${params.serial}::uuid)
    on conflict (device_library_id, pass_type_id, serial)
      do update set push_token = excluded.push_token
    returning (xmax = 0) as inserted
  `.execute(db);
  return rows[0]?.inserted === true;
};

export const unregisterDevice = async (params: { deviceLibraryId: string; passTypeId: string; serial: string }) => {
  await db
    .deleteFrom('wallet_devices')
    .where('device_library_id', '=', params.deviceLibraryId)
    .where('pass_type_id', '=', params.passTypeId)
    .where('serial', '=', params.serial)
    .execute();
};

// ---------------------------------------------------------------------------
// APNs
// ---------------------------------------------------------------------------

/**
 * HTTP/2 to APNs with the Pass Type ID certificate as the TLS client cert.
 * Wallet pass updates: topic = pass type id, empty `{}` payload. One session
 * per batch; every failure becomes a result, never an exception.
 */
export const http2Push: ApnsPush = (config, pushTokens) =>
  new Promise((resolve) => {
    const results: ApnsResult[] = [];
    if (!pushTokens.length) {
      resolve(results);
      return;
    }
    let session: ReturnType<typeof connect>;
    try {
      session = connect(`https://${config.apnsHost}`, {
        cert: config.signerCert,
        key: config.signerKey,
        passphrase: config.signerKeyPassphrase,
      });
    } catch (err) {
      resolve(pushTokens.map((pushToken) => ({ pushToken, status: 0, reason: String(err) })));
      return;
    }
    let pending = pushTokens.length;
    const done = (result: ApnsResult) => {
      results.push(result);
      if (--pending === 0) {
        session.close();
        resolve(results);
      }
    };
    // Connection-level failures surface on each stream as well.
    session.on('error', () => {});
    session.setTimeout(APNS_TIMEOUT_MS, () => session.destroy(new Error('APNs session timeout')));

    for (const pushToken of pushTokens) {
      let settled = false;
      const settle = (result: ApnsResult) => {
        if (settled) return;
        settled = true;
        done(result);
      };
      try {
        const req = session.request({
          [h2.HTTP2_HEADER_METHOD]: 'POST',
          [h2.HTTP2_HEADER_PATH]: `/3/device/${pushToken}`,
          'apns-topic': config.passTypeId,
          'apns-push-type': 'background',
          'apns-priority': '5',
          'content-type': 'application/json',
        });
        let status = 0;
        let body = '';
        req.setEncoding('utf8');
        req.setTimeout(APNS_TIMEOUT_MS, () => req.close(h2.NGHTTP2_CANCEL));
        req.on('response', (headers) => {
          status = Number(headers[h2.HTTP2_HEADER_STATUS] ?? 0);
        });
        req.on('data', (chunk: string) => {
          if (body.length < 2048) body += chunk;
        });
        req.on('end', () => {
          let reason: string | undefined;
          try {
            reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
          } catch {
            reason = body.slice(0, 200);
          }
          settle({ pushToken, status, reason });
        });
        req.on('close', () => settle({ pushToken, status, reason: status ? undefined : 'stream closed' }));
        req.on('error', (err) => settle({ pushToken, status: 0, reason: err.message }));
        req.end('{}');
      } catch (err) {
        settle({ pushToken, status: 0, reason: String(err) });
      }
    }
  });

export interface NotifyResult {
  /** Push results, one per registered device. */
  pushed: ApnsResult[];
  /** Device registrations dropped because APNs said 410 Unregistered. */
  unregistered: number;
}

/**
 * Marks the card's Apple pass as changed and pushes every registered device.
 * Null when Apple Wallet is off or the card has no Apple pass.
 */
export const notifyApplePass = async (cardId: string): Promise<NotifyResult | null> => {
  const config = appleWalletConfig();
  if (!config) return null;
  // Last-Modified has 1 s resolution: always move to a later second, so two
  // changes within one second never look unmodified to If-Modified-Since.
  const pass = await db
    .updateTable('wallet_passes')
    .set({ updated_at: sql<Date>`greatest(now(), date_trunc('second', updated_at) + interval '1 second')` })
    .where('card_id', '=', cardId)
    .where('provider', '=', 'apple')
    .returning('object_id')
    .executeTakeFirst();
  if (!pass) return null;

  const devices = await db
    .selectFrom('wallet_devices')
    .select(['device_library_id', 'push_token'])
    .where('pass_type_id', '=', config.passTypeId)
    .where('serial', '=', pass.object_id)
    .execute();
  if (!devices.length) return { pushed: [], unregistered: 0 };

  const tokens = Array.from(new Set(devices.map((d) => d.push_token)));
  const push = overrides?.push ?? http2Push;
  const pushed = await push(config, tokens).catch((err: unknown) =>
    tokens.map((pushToken) => ({ pushToken, status: 0, reason: String(err) })),
  );

  const gone = pushed.filter((r) => r.status === 410).map((r) => r.pushToken);
  let unregistered = 0;
  if (gone.length) {
    const deleted = await db
      .deleteFrom('wallet_devices')
      .where('pass_type_id', '=', config.passTypeId)
      .where('serial', '=', pass.object_id)
      .where('push_token', 'in', gone)
      .executeTakeFirst();
    unregistered = Number(deleted.numDeletedRows);
  }
  return { pushed, unregistered };
};
