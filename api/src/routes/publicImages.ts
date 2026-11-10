// Campaign images (logo, background) for the public card, resized to WebP:
//   GET /public/img/:ownerId/:kind/:file — same path as the bucket object
//
// Owners upload full-size photos (2000×2000 PNGs of several MB), and the
// bucket is private, so the card used to get a freshly signed GCS URL per
// request: a different URL every visit, so nothing was ever served from the
// browser cache. This route serves a copy sized for the card at a stable URL.
// Uploads always get a new uuid path, so the response is immutable.
import type { FastifyPluginAsync } from 'fastify';
import sharp from 'sharp';
import { env } from '../config.js';
import { AppError } from '../lib/errors.js';
import { isValidPath, ownAssetPath, signedReadUrl } from '../storage/gcs.js';
import { cachedImage } from './publicPwa.js';

// Images are immutable, so a browser asks at most once per card.
const IMAGE_GET = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

/** Longest side: the logo is a 96px circle, the background fills a phone. */
export const IMAGE_MAX_SIDE = { logo: 320, background: 1200 } as const;

const RENDER_CACHE_MAX = 32;
const renderCache = new Map<string, Buffer>();

/**
 * Public URL for a stored logo/background reference: our bucket objects go
 * through this route, external URLs the owner pasted come back untouched.
 */
export const publicImageUrl = async (ref: string | null | undefined): Promise<string | undefined> => {
  const path = ownAssetPath(ref);
  if (!path) return signedReadUrl(ref);
  return `${env.API_PUBLIC_URL.replace(/\/+$/, '')}/public/img/${path}`;
};

export const renderCardImage = async (source: Buffer, kind: keyof typeof IMAGE_MAX_SIDE) => {
  const side = IMAGE_MAX_SIDE[kind];
  return sharp(source, { density: 300, limitInputPixels: 40_000_000 })
    .rotate()
    .resize(side, side, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: kind === 'logo' ? 85 : 78 })
    .toBuffer();
};

export const publicImageRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ownerId: string; kind: string; file: string } }>(
    '/public/img/:ownerId/:kind/:file',
    IMAGE_GET,
    async (req, reply) => {
      const { ownerId, kind, file } = req.params;
      const path = `${ownerId}/${kind}/${file}`;
      if (!isValidPath(path)) throw new AppError(404, 'NOT_FOUND', 'Image not found.');
      const k = kind.toLowerCase() as keyof typeof IMAGE_MAX_SIDE;

      let webp = renderCache.get(path);
      if (!webp) {
        const source = await cachedImage(ownerId, path);
        if (!source) throw new AppError(404, 'NOT_FOUND', 'Image not found.');
        try {
          webp = await renderCardImage(source, k);
        } catch {
          throw new AppError(404, 'NOT_FOUND', 'Image not found.');
        }
        renderCache.set(path, webp);
        if (renderCache.size > RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value!);
      }

      return reply
        .header('Content-Type', 'image/webp')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        // helmet defaults CORP to same-origin, which would block the SPA origin.
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(webp);
    },
  );
};
