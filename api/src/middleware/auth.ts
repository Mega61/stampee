import type { FastifyRequest } from 'fastify';
import { verifyAccessToken, type AccessClaims } from '../lib/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessClaims;
  }
}

// Optional auth: if a valid access cookie is present, attach claims.
// Missing/expired/invalid leave req.user undefined — protected routes
// raise via requireUser.
export const authPreHandler = async (req: FastifyRequest) => {
  const token = req.cookies['access'];
  if (!token) return;
  try {
    req.user = await verifyAccessToken(token);
  } catch {
    // ignore — req.user stays undefined
  }
};
