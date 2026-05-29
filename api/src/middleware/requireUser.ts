import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import type { AccessClaims } from '../lib/jwt.js';

export const requireUser = async (req: FastifyRequest): Promise<AccessClaims> => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Not signed in.');
  }
  return req.user;
};
