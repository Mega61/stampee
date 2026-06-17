import type { FastifyRequest } from 'fastify';
import { verifyAccessToken, type AccessClaims } from '../lib/jwt.js';
import { authenticateApiKey } from './apiKeyAuth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessClaims;
  }
}

// Optional auth: attach claims from either a bearer API key (header) or the
// access cookie. The API-key header takes precedence over the cookie. Missing/
// expired/invalid leave req.user undefined — protected routes raise via
// requireUser.
export const authPreHandler = async (req: FastifyRequest) => {
  const apiClaims = await authenticateApiKey(req);
  if (apiClaims) {
    req.user = apiClaims;
    return;
  }

  const token = req.cookies['access'];
  if (!token) return;
  try {
    req.user = await verifyAccessToken(token);
  } catch {
    // ignore — req.user stays undefined
  }
};
