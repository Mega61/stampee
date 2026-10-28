// Apple Wallet (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
//   GET /public/cards/:slug/:uniqueId/wallet/apple — the signed .pkpass
// plus Apple's PassKit web service under `${API_PUBLIC_URL}/wallet/apple`
// (the pass's webServiceURL), which Wallet calls on its own:
//   POST   /wallet/apple/v1/devices/:device/registrations/:passType/:serial
//   DELETE /wallet/apple/v1/devices/:device/registrations/:passType/:serial
//   GET    /wallet/apple/v1/devices/:device/registrations/:passType?passesUpdatedSince=
//   GET    /wallet/apple/v1/passes/:passType/:serial
//   POST   /wallet/apple/v1/log
// Pass-scoped calls carry `Authorization: ApplePass <authenticationToken>`.
// With no APPLE_* env every route here 404s.
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import {
  appleWalletConfig,
  findApplePass,
  isAuthorized,
  issueApplePass,
  registerDevice,
  renderStoredPass,
  unregisterDevice,
  updatedSerials,
  type AppleWalletConfig,
} from '../lib/wallet/apple.js';
import { rejectMalformedUniqueId, UUID_RE } from '../lib/uniqueId.js';
import { recordPassEvent } from '../lib/wallet/passEvents.js';

const PKPASS_TYPE = 'application/vnd.apple.pkpass';
// Each download renders images and signs a bundle: keep it tight.
const PUBLIC_SAVE = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
// Wallet itself calls these, a handful of times per pass change.
const PASSKIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const PASSKIT_LOG = { bodyLimit: 64 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

// Device library ids and push tokens are opaque Apple strings (hex in
// practice). Push tokens end up in the APNs URL path, so keep them strict.
const DEVICE_RE = /^[A-Za-z0-9._-]{1,128}$/;
const PUSH_TOKEN_RE = /^[0-9a-f]{16,200}$/i;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found.');
const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Unauthorized.');

type DeviceParams = { deviceLibraryIdentifier: string; passTypeIdentifier: string };
type SerialParams = { passTypeIdentifier: string; serialNumber: string };

/** Feature on + this deployment's pass type, else 404. */
const configFor = (passTypeIdentifier: string): AppleWalletConfig => {
  const config = appleWalletConfig();
  if (!config || passTypeIdentifier !== config.passTypeId) throw notFound();
  return config;
};

/** The pass the request is authorized for, else 401. */
const authorizedPass = async (req: FastifyRequest, serial: string) => {
  const pass = UUID_RE.test(serial) ? await findApplePass(serial) : null;
  if (!pass || !isAuthorized(req.headers.authorization, pass.authToken)) throw unauthorized();
  return pass;
};

const sendPkpass = (reply: FastifyReply, pkpass: Buffer) =>
  reply.header('Content-Type', PKPASS_TYPE).header('Cache-Control', 'no-store').send(pkpass);

export const appleWalletRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', rejectMalformedUniqueId);

  app.get<{ Params: { slug: string; uniqueId: string } }>(
    '/public/cards/:slug/:uniqueId/wallet/apple',
    PUBLIC_SAVE,
    async (req, reply) => {
      if (!appleWalletConfig()) throw notFound();
      let pkpass: Buffer | null;
      try {
        pkpass = await issueApplePass(req.params.slug, req.params.uniqueId);
      } catch (err) {
        req.log.error({ err }, 'apple wallet pass failed');
        throw new AppError(502, 'WALLET_UNAVAILABLE', 'Apple Wallet is unavailable right now.');
      }
      if (!pkpass) throw new AppError(404, 'NOT_FOUND', 'Card not found.');
      reply.header('Content-Disposition', 'attachment; filename="tarjeta.pkpass"');
      return sendPkpass(reply, pkpass);
    },
  );

  // ---- PassKit web service ------------------------------------------------

  app.post<{ Params: DeviceParams & SerialParams; Body: { pushToken?: unknown } | undefined }>(
    '/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
    PASSKIT,
    async (req, reply) => {
      const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
      const config = configFor(passTypeIdentifier);
      const pass = await authorizedPass(req, serialNumber);
      const pushToken = req.body?.pushToken;
      if (!DEVICE_RE.test(deviceLibraryIdentifier) || typeof pushToken !== 'string' || !PUSH_TOKEN_RE.test(pushToken)) {
        throw new AppError(400, 'VALIDATION', 'Invalid registration.');
      }
      const created = await registerDevice({
        deviceLibraryId: deviceLibraryIdentifier,
        passTypeId: config.passTypeId,
        serial: pass.serial,
        pushToken,
      });
      // Registering = the pass was added to a wallet (analytics, like
      // Google's save callback). Re-registrations aren't new saves.
      if (created) await recordPassEvent({ cardId: pass.cardId, provider: 'apple', event: 'save' });
      return reply.code(created ? 201 : 200).send();
    },
  );

  app.delete<{ Params: DeviceParams & SerialParams }>(
    '/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
    PASSKIT,
    async (req, reply) => {
      const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
      const config = configFor(passTypeIdentifier);
      const pass = await authorizedPass(req, serialNumber);
      if (DEVICE_RE.test(deviceLibraryIdentifier)) {
        const removed = await unregisterDevice({
          deviceLibraryId: deviceLibraryIdentifier,
          passTypeId: config.passTypeId,
          serial: pass.serial,
        });
        if (removed) await recordPassEvent({ cardId: pass.cardId, provider: 'apple', event: 'delete' });
      }
      return reply.code(200).send();
    },
  );

  app.get<{ Params: DeviceParams; Querystring: { passesUpdatedSince?: string } }>(
    '/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier',
    PASSKIT,
    async (req, reply) => {
      const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
      const config = configFor(passTypeIdentifier);
      const since = typeof req.query.passesUpdatedSince === 'string' ? req.query.passesUpdatedSince : null;
      const result = DEVICE_RE.test(deviceLibraryIdentifier)
        ? await updatedSerials(deviceLibraryIdentifier, config.passTypeId, since)
        : null;
      if (!result) return reply.code(204).send();
      reply.header('Cache-Control', 'no-store');
      return result;
    },
  );

  app.get<{ Params: SerialParams }>(
    '/wallet/apple/v1/passes/:passTypeIdentifier/:serialNumber',
    PASSKIT,
    async (req, reply) => {
      const { passTypeIdentifier, serialNumber } = req.params;
      configFor(passTypeIdentifier);
      const pass = await authorizedPass(req, serialNumber);

      // HTTP dates have 1 s resolution; notifyApplePass always moves
      // updated_at to a later second, so flooring here is exact.
      const modifiedSec = Math.floor(pass.updatedAt.getTime() / 1000);
      const since = Date.parse(req.headers['if-modified-since'] ?? '');
      if (Number.isFinite(since) && modifiedSec <= Math.floor(since / 1000)) {
        return reply.code(304).send();
      }

      let pkpass: Buffer | null;
      try {
        pkpass = await renderStoredPass(pass);
      } catch (err) {
        req.log.error({ err }, 'apple wallet pass update failed');
        throw new AppError(502, 'WALLET_UNAVAILABLE', 'Apple Wallet is unavailable right now.');
      }
      if (!pkpass) throw notFound();
      reply.header('Last-Modified', new Date(modifiedSec * 1000).toUTCString());
      return sendPkpass(reply, pkpass);
    },
  );

  // Wallet reports web-service problems here (bad JSON, signature errors…).
  app.post<{ Body: { logs?: unknown } | undefined }>('/wallet/apple/v1/log', PASSKIT_LOG, async (req, reply) => {
    if (!appleWalletConfig()) throw notFound();
    const logs = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 20) : [];
    if (logs.length) req.log.debug({ logs }, 'apple wallet device log');
    return reply.code(200).send();
  });
};
