import { randomBytes, createHash } from 'node:crypto';

// 32 bytes → 64 hex chars. Plenty of entropy for verify/reset/refresh tokens.
export const generateToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

// sha256 hex — stored in DB; the plaintext token lives only in the email link / cookie.
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
