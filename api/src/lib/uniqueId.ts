import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * preHandler hook for public card routes: a malformed :uniqueId is a 404, not
 * a Postgres uuid cast error (500). Routes without the param are untouched.
 */
export const rejectMalformedUniqueId = async (req: FastifyRequest) => {
  const uniqueId = (req.params as { uniqueId?: unknown } | undefined)?.uniqueId;
  if (typeof uniqueId === 'string' && !UUID_RE.test(uniqueId)) {
    throw new AppError(404, 'NOT_FOUND', 'Card not found.');
  }
};
