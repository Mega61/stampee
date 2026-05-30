import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { requireUser } from './requireUser.js';
import type { AccessClaims } from '../lib/jwt.js';

export const requireRole = async (
  req: FastifyRequest,
  ...roles: Array<'owner' | 'staff' | 'admin'>
): Promise<AccessClaims> => {
  const claims = await requireUser(req);
  if (!roles.includes(claims.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.');
  }
  return claims;
};
