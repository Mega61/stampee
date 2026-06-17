import { randomBytes } from 'node:crypto';
import { hashToken } from './tokens.js';

// API keys are bearer secrets handed to external systems. We mint
// `stmp_<48 hex>` — the prefix aids humans + log greps, and is deliberately
// distinct from other providers' secret-key prefixes so it doesn't trip secret
// scanners. We store only the sha256 hash, and surface the full secret to the
// caller exactly once.

const PREFIX = 'stmp_';

export interface GeneratedApiKey {
  full: string; // shown once, never stored
  prefix: string; // display-only, e.g. stmp_a1b2c3d4
  hash: string; // sha256, stored in api_keys.token_hash
}

export const generateApiKey = (): GeneratedApiKey => {
  const secret = randomBytes(24).toString('hex'); // 48 hex chars
  const full = `${PREFIX}${secret}`;
  return {
    full,
    prefix: full.slice(0, PREFIX.length + 8), // e.g. stmp_a1b2c3d4
    hash: hashToken(full),
  };
};
