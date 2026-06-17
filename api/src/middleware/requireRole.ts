import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { requireUser } from './requireUser.js';
import type { AccessClaims } from '../lib/jwt.js';

export const requireRole = async (
  req: FastifyRequest,
  ...roles: Array<'owner' | 'staff' | 'admin'>
): Promise<AccessClaims> => {
  const claims = await requireUser(req);

  // 'api' principals have read+write within their own owner scope, so they pass
  // every owner-scoped business gate. Each handler still filters by
  // owner_id = claims.ownerScopeId, so a key cannot reach another tenant's data.
  // Management/auth routes that must stay human-only call requireHuman instead.
  if (claims.role === 'api') return claims;

  if (!roles.includes(claims.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.');
  }
  return claims;
};

// Like requireRole, but rejects API-key principals outright — for management
// and auth surfaces (key/staff/admin CRUD, account self-service) that only
// humans may touch. With no roles given, accepts any signed-in human.
export const requireHuman = async (
  req: FastifyRequest,
  ...roles: Array<'owner' | 'staff' | 'admin'>
): Promise<AccessClaims> => {
  const claims = await requireUser(req);
  if (claims.role === 'api') {
    throw new AppError(403, 'FORBIDDEN', 'API keys cannot access this resource.');
  }
  if (roles.length > 0 && !roles.includes(claims.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.');
  }
  return claims;
};
