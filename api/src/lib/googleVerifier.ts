import { OAuth2Client } from 'google-auth-library';
import { env } from '../config.js';
import { AppError } from './errors.js';

// Verified identity extracted from a Google ID token. `hd` is the hosted-domain
// claim (only present for Google Workspace accounts); consumer Gmail accounts
// omit it, which is how we block them from owner/staff sign-in.
export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  hd: string | undefined;
  name: string | undefined;
}

const client = new OAuth2Client();

// Test injection seam. Production paths call the real google-auth-library
// verifier; tests install a fake via setGoogleVerifierOverride() to avoid
// talking to Google. Mirrors setStorageOverrides() in storage/gcs.ts.
let override: ((credential: string) => Promise<GoogleIdentity>) | null = null;
export const setGoogleVerifierOverride = (
  fn: ((credential: string) => Promise<GoogleIdentity>) | null,
): void => {
  override = fn;
};

export const verifyGoogleIdToken = async (credential: string): Promise<GoogleIdentity> => {
  if (override) return override(credential);
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token.');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      hd: payload.hd,
      name: payload.name,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token.');
  }
};

// True only if `hd` is a non-empty hosted domain present in the configured
// GOOGLE_WORKSPACE_DOMAIN comma-separated allow-list (case-insensitive).
export const domainAllowed = (hd: string | undefined): boolean => {
  if (!hd) return false;
  const allowed = env.GOOGLE_WORKSPACE_DOMAIN.split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
  if (allowed.length === 0) return false;
  return allowed.includes(hd.trim().toLowerCase());
};
