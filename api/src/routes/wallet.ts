// Save the card to Google Wallet (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
//   GET /public/wallet/config                       — which wallets are on
//                                                     (Apple: routes/appleWallet.ts)
//   GET /public/cards/:slug/:uniqueId/wallet/google — signed save link
//   POST /wallet/google/callback                    — Google's save/delete
//                                                     callbacks (signed, see
//                                                     lib/wallet/googleCallback.ts)
// Both are anonymous. With no GOOGLE_WALLET_* env the config says false and
// the save route 404s, so the SPA never shows the button.
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors.js';
import { db } from '../db/kysely.js';
import { createGoogleSaveUrl, googleWalletConfig, isGoogleWalletEnabled } from '../lib/wallet/google.js';
import { verifyGoogleCallback } from '../lib/wallet/googleCallback.js';
import { recordPassEvent } from '../lib/wallet/passEvents.js';
import { isAppleWalletEnabled } from '../lib/wallet/apple.js';
import { rejectMalformedUniqueId } from '../lib/uniqueId.js';

const PUBLIC_GET = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
// Each save call upserts class + object at Google: keep it tighter.
const PUBLIC_SAVE = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
// Google calls this once per save/delete (plus retries).
const CALLBACK = { bodyLimit: 16 * 1024, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

export const walletRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', rejectMalformedUniqueId);

  app.get('/public/wallet/config', PUBLIC_GET, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { ok: true, data: { google: isGoogleWalletEnabled(), apple: isAppleWalletEnabled() } };
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

  app.post('/wallet/google/callback', CALLBACK, async (req, reply) => {
    const config = googleWalletConfig();
    if (!config) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    let result;
    try {
      result = await verifyGoogleCallback(req.body, config.issuerId);
    } catch (err) {
      // Couldn't fetch Google's keys: 503 so Google retries later.
      req.log.error({ err }, 'google wallet callback keys unavailable');
      throw new AppError(503, 'UNAVAILABLE', 'Try again later.');
    }
    if (!result.ok) {
      req.log.warn({ reason: result.reason }, 'google wallet callback rejected');
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid callback.');
    }

    // Only passes this deployment issued: our issuer + class prefix, and an
    // object we recorded in wallet_passes.
    const { objectId, classId, eventType, nonce } = result.message;
    const prefix = `${config.issuerId}.${config.classPrefix}_`;
    const pass =
      objectId.startsWith(prefix) && classId.startsWith(prefix)
        ? await db
            .selectFrom('wallet_passes')
            .select('card_id')
            .where('provider', '=', 'google')
            .where('object_id', '=', objectId)
            .executeTakeFirst()
        : undefined;
    if (!pass) throw new AppError(404, 'NOT_FOUND', 'Unknown pass.');

    await recordPassEvent({
      cardId: pass.card_id,
      provider: 'google',
      event: eventType === 'save' ? 'save' : 'delete',
      nonce,
    });
    return reply.code(200).send({ ok: true });
  });
};
