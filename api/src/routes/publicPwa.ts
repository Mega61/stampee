// "Install the card as an app" (docs/CARD_ENGAGEMENT_PLAN.md §7.2):
//   GET /public/cards/:slug/:uniqueId/manifest.webmanifest — per-card manifest
//   GET /public/brand/:slug/icon-{180|192|512}.png        — home-screen icons
//
// Cross-origin manifest: the SPA and the API live on different origins, and
// the manifest is served from the API. Per the Web App Manifest spec, URL
// members are resolved against the *manifest* URL, and `start_url` is only
// honoured when it is same-origin with the *document*; `scope` and `id` must
// in turn be same-origin with `start_url`. So start_url / scope / id are
// absolute URLs on APP_PUBLIC_URL (the SPA origin), while the icons point back
// at this API (API_PUBLIC_URL). The browser fetches a `<link rel="manifest">`
// in CORS mode without credentials, which the global @fastify/cors plugin
// already answers for SPA_ORIGIN.
import type { FastifyPluginAsync } from 'fastify';
import sharp from 'sharp';
import { env } from '../config.js';
import { db } from '../db/kysely.js';
import { AppError } from '../lib/errors.js';
import { normalizeSlug } from '../lib/slug.js';
import { signedReadUrl } from '../storage/gcs.js';
import { fetchPublicHttps } from '../lib/safeFetch.js';

const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

const ICON_SIZES = new Set([180, 192, 512]);
const ICON_FILE_RE = /^icon-(\d+)\.png$/;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 4000;
const DEFAULT_BG = '#ffffff';

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** First #rgb / #rrggbb in a stored color (they may be Tailwind-ish classes). */
export const firstHex = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i);
  if (!match) return null;
  const hex = match[1]!.toLowerCase();
  return `#${hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex}`;
};

const colorsBackground = (colors: unknown): string | null =>
  colors && typeof colors === 'object' ? firstHex((colors as Record<string, unknown>)['background']) : null;

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

const findOwner = async (rawSlug: string) => {
  const slug = normalizeSlug(rawSlug);
  return db
    .selectFrom('profiles')
    .select(['id', 'slug', 'business_name'])
    .where('slug', '=', slug)
    .where('role', '=', 'owner')
    .executeTakeFirst();
};

/** The owner's brand: newest campaign that has a logo, else the newest one. */
const findBrandCampaign = async (ownerId: string) =>
  db
    .selectFrom('campaigns')
    .select(['logo_image', 'colors'])
    .where('owner_id', '=', ownerId)
    .orderBy((eb) => eb('logo_image', 'is', null), 'asc')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

/** Background colors the owner actually uses — the only accepted `?bg=` values. */
const ownerBackgrounds = async (ownerId: string) => {
  const rows = await db.selectFrom('campaigns').select('colors').where('owner_id', '=', ownerId).execute();
  return new Set(rows.map((r) => colorsBackground(r.colors)?.toLowerCase()).filter((v): v is string => !!v));
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const buildManifest = (params: {
  businessName: string;
  slug: string;
  uniqueId: string;
  background: string;
}) => {
  const app = trimSlash(env.APP_PUBLIC_URL);
  const api = trimSlash(env.API_PUBLIC_URL);
  const scope = `${app}/${params.slug}/${encodeURIComponent(params.uniqueId)}`;
  const iconBase = `${api}/public/brand/${params.slug}`;
  const bg = params.background.slice(1);
  const name = params.businessName.trim() || 'Mi tarjeta';
  return {
    id: scope,
    name,
    short_name: name,
    description: `Tu tarjeta de sellos de ${name}`,
    lang: 'es-CO',
    start_url: `${scope}?src=pwa`,
    scope,
    display: 'standalone',
    orientation: 'portrait',
    background_color: params.background,
    theme_color: params.background,
    icons: [
      { src: `${iconBase}/icon-192.png?bg=${bg}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${iconBase}/icon-512.png?bg=${bg}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${iconBase}/icon-512.png?bg=${bg}&maskable=1`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

// Single-stroke capitals on a 10×14 grid (y down). Rendered as stroked SVG
// paths, so the fallback icon needs no system fonts — the alpine runtime image
// ships none, and librsvg would otherwise draw an empty square.
const GLYPHS: Record<string, string> = {
  A: 'M0 14L5 0L10 14M1.8 9H8.2',
  B: 'M0 0V14M0 0H6A3.5 3.5 0 0 1 6 7H0M6 7A3.5 3.5 0 0 1 6 14H0',
  C: 'M8.5 2.1A5 7 0 1 0 8.5 11.9',
  D: 'M0 0V14H4A6 7 0 0 0 4 0Z',
  E: 'M10 0H0V14H10M0 7H8',
  F: 'M10 0H0V14M0 7H8',
  G: 'M8.5 2.1A5 7 0 1 0 10 7H6',
  H: 'M0 0V14M10 0V14M0 7H10',
  I: 'M5 0V14M2 0H8M2 14H8',
  J: 'M8 0V10A4 4 0 0 1 0 10',
  K: 'M0 0V14M10 0L0 8M3.5 5.5L10 14',
  L: 'M0 0V14H10',
  M: 'M0 14V0L5 8L10 0V14',
  N: 'M0 14V0L10 14V0',
  O: 'M5 0A5 7 0 1 0 5 14A5 7 0 1 0 5 0Z',
  P: 'M0 14V0H6A3.75 3.75 0 0 1 6 7.5H0',
  Q: 'M5 0A5 7 0 1 0 5 14A5 7 0 1 0 5 0ZM6 10L10 14',
  R: 'M0 14V0H6A3.75 3.75 0 0 1 6 7.5H0M5 7.5L10 14',
  S: 'M9.5 2.5C8 0 1 -0.5 1 3.5C1 7 9 6.5 9 10.5C9 14.5 2 14.5 0.5 11.5',
  T: 'M0 0H10M5 0V14',
  U: 'M0 0V9A5 5 0 0 0 10 9V0',
  V: 'M0 0L5 14L10 0',
  W: 'M0 0L2.5 14L5 5L7.5 14L10 0',
  X: 'M0 0L10 14M10 0L0 14',
  Y: 'M0 0L5 7L10 0M5 7V14',
  Z: 'M0 0H10L0 14H10',
};
// Five-point star for names that don't start with A–Z (digits, emoji…).
const STAR = 'M5 0L6.5 5H10L7.2 8.2L8.4 14L5 10.6L1.6 14L2.8 8.2L0 5H3.5Z';

export const initialFor = (name: string) => {
  const first = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().charAt(0).toUpperCase();
  return GLYPHS[first] ? first : null;
};

const fallbackIconSvg = (name: string, size: number, bg: string, maskable: boolean) => {
  const initial = initialFor(name);
  const ink = luminance(bg) > 0.45 ? '#1d1d1f' : '#ffffff';
  // Glyph height as a share of the icon; maskable keeps it in the safe circle.
  const scale = (size * (maskable ? 0.34 : 0.44)) / 14;
  const tx = size / 2 - 5 * scale;
  const ty = size / 2 - 7 * scale;
  const shape = initial
    ? `<path d="${GLYPHS[initial]}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${STAR}" fill="${ink}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="${bg}"/>` +
      `<g transform="translate(${tx} ${ty}) scale(${scale})">${shape}</g>` +
      `</svg>`,
  );
};

/** Logo bytes, or null on any problem (caller falls back to the initial). */
const loadLogo = async (ref: string): Promise<Buffer | null> => {
  try {
    // Our bucket paths/URLs come back freshly signed; anything else is an
    // owner-pasted external URL, only fetched over https from a public host.
    const url = await signedReadUrl(ref);
    if (!url) return null;
    if (url === ref) {
      // Owner-pasted URL: DNS-checked, https only, no redirects (SSRF guard).
      return await fetchPublicHttps(url, { timeoutMs: LOGO_FETCH_TIMEOUT_MS, maxBytes: MAX_LOGO_BYTES });
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_LOGO_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= MAX_LOGO_BYTES ? buf : null;
  } catch {
    return null;
  }
};

export const renderIcon = async (params: {
  size: number;
  maskable: boolean;
  background: string;
  businessName: string;
  logo: Buffer | null;
}): Promise<Buffer> => {
  const { size, maskable, background } = params;
  if (params.logo) {
    try {
      // Maskable: the logo's bounding box must sit inside the 80% safe circle
      // (0.8 / √2 ≈ 0.57 of the side).
      const inner = Math.round(size * (maskable ? 0.56 : 0.76));
      const logo = await sharp(params.logo, { density: 300, limitInputPixels: 40_000_000 })
        .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      return await sharp({ create: { width: size, height: size, channels: 4, background } })
        .composite([{ input: logo, gravity: 'center' }])
        .flatten({ background })
        .png()
        .toBuffer();
    } catch {
      // Unreadable image (corrupt, unsupported format) → initial fallback.
    }
  }
  return sharp(fallbackIconSvg(params.businessName, size, background, maskable)).png().toBuffer();
};

// Tiny in-process cache: the same few icons get requested on every install.
// Keyed by the logo reference so a new logo produces new icons immediately.
const ICON_CACHE_MAX = 64;
const ICON_CACHE_TTL_MS = 10 * 60 * 1000;
const iconCache = new Map<string, { at: number; png: Buffer }>();

// Decoded logos, cached apart from rendered icons so varying sizes/colors
// never re-fetch the logo.
const LOGO_CACHE_MAX = 32;
const logoCache = new Map<string, { at: number; buf: Buffer }>();
const cachedLogo = async (ownerId: string, ref: string) => {
  const key = `${ownerId}|${ref}`;
  const hit = logoCache.get(key);
  if (hit && Date.now() - hit.at < ICON_CACHE_TTL_MS) return hit.buf;
  const buf = await loadLogo(ref);
  if (!buf) return null;
  logoCache.delete(key);
  logoCache.set(key, { at: Date.now(), buf });
  if (logoCache.size > LOGO_CACHE_MAX) logoCache.delete(logoCache.keys().next().value!);
  return buf;
};

const cachedIcon = async (key: string, make: () => Promise<{ png: Buffer; cacheable: boolean }>) => {
  const hit = iconCache.get(key);
  if (hit && Date.now() - hit.at < ICON_CACHE_TTL_MS) return hit.png;
  const { png, cacheable } = await make();
  if (!cacheable) return png;
  iconCache.delete(key);
  iconCache.set(key, { at: Date.now(), png });
  if (iconCache.size > ICON_CACHE_MAX) iconCache.delete(iconCache.keys().next().value!);
  return png;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const publicPwaRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/manifest.webmanifest',
    PUBLIC_GET,
    async (req, reply) => {
      const owner = await findOwner(req.params.slug);
      if (!owner?.slug) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      const card = await db
        .selectFrom('issued_cards')
        .select(['unique_id', 'campaign_id', 'template_snapshot'])
        .where('unique_id', '=', req.params.uniqueId)
        .where('owner_id', '=', owner.id)
        .executeTakeFirst();
      if (!card) throw new AppError(404, 'NOT_FOUND', 'Card not found.');

      let background = colorsBackground((card.template_snapshot as Record<string, unknown> | null)?.['colors']);
      if (!background && card.campaign_id) {
        const campaign = await db
          .selectFrom('campaigns')
          .select('colors')
          .where('id', '=', card.campaign_id)
          .executeTakeFirst();
        background = colorsBackground(campaign?.colors);
      }

      const manifest = buildManifest({
        businessName: owner.business_name ?? '',
        slug: owner.slug,
        uniqueId: card.unique_id,
        background: background ?? DEFAULT_BG,
      });
      return reply
        .header('Content-Type', 'application/manifest+json; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(JSON.stringify(manifest));
    },
  );

  // `icon-:size.png` as one param: find-my-way's mid-segment params are
  // fiddly, so match the file name here instead.
  app.get<{ Params: { slug: string; file: string }; Querystring: { maskable?: string; bg?: string } }>(
    '/public/brand/:slug/:file',
    PUBLIC_GET,
    async (req, reply) => {
      const size = Number(ICON_FILE_RE.exec(req.params.file)?.[1]);
      if (!ICON_SIZES.has(size)) throw new AppError(404, 'NOT_FOUND', 'Icon not found.');
      const maskable = req.query.maskable === '1';
      const bgParam = typeof req.query.bg === 'string' && /^[0-9a-f]{6}$/i.test(req.query.bg)
        ? `#${req.query.bg.toLowerCase()}`
        : null;

      const owner = await findOwner(req.params.slug);
      if (!owner) throw new AppError(404, 'NOT_FOUND', 'Icon not found.');
      const campaign = await findBrandCampaign(owner.id);
      // Only the owner's own colors: arbitrary values would let anyone force
      // a fresh render per request.
      const allowedBg = bgParam && (await ownerBackgrounds(owner.id)).has(bgParam) ? bgParam : null;
      const background = allowedBg ?? colorsBackground(campaign?.colors) ?? DEFAULT_BG;
      const logoRef = campaign?.logo_image ?? null;
      const businessName = owner.business_name ?? '';

      const key = [owner.id, size, maskable ? 1 : 0, background, logoRef ?? '', businessName].join('|');
      const png = await cachedIcon(key, async () => {
        const logo = logoRef ? await cachedLogo(owner.id, logoRef) : null;
        const rendered = await renderIcon({ size, maskable, background, businessName, logo });
        // Don't pin a transient logo-fetch failure in the cache.
        return { png: rendered, cacheable: !logoRef || logo !== null };
      });

      return reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=86400')
        // helmet defaults CORP to same-origin, which would block the
        // apple-touch-icon <link> on the SPA origin.
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(png);
    },
  );
};
