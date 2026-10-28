// Save the card to Google Wallet (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
//   GET /public/wallet/config                       — which wallets are on
//   GET /public/cards/:slug/:uniqueId/wallet/google — signed save link
// Both are anonymous. With no GOOGLE_WALLET_* env the config says false and
// the save route 404s, so the SPA never shows the button.
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors.js';
import { createGoogleSaveUrl, isGoogleWalletEnabled } from '../lib/wallet/google.js';
import { rejectMalformedUniqueId } from '../lib/uniqueId.js';

const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
// Each save call upserts class + object at Google: keep it tighter.
const PUBLIC_SAVE = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export const walletRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', rejectMalformedUniqueId);

  app.get('/public/wallet/config', PUBLIC_GET, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { ok: true, data: { google: isGoogleWalletEnabled() } };
  });

  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/wallet/google',
    PUBLIC_SAVE,
    async (req, reply) => {
      if (!isGoogleWalletEnabled()) throw new AppError(404, 'NOT_FOUND', 'Not found.');
      let saveUrl: string | null;
      try {
        saveUrl = await createGoogleSaveUrl(req.params.slug, req.params.uniqueId);
      } catch (err) {
        req.log.error({ err }, 'google wallet save link failed');
        throw new AppError(502, 'WALLET_UNAVAILABLE', 'Google Wallet is unavailable right now.');
      }
      if (!saveUrl) throw new AppError(404, 'NOT_FOUND', 'Card not found.');
      reply.header('Cache-Control', 'no-store');
      return { ok: true, data: { saveUrl } };
    },
  );
};
