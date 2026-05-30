import { Storage } from '@google-cloud/storage';
import { env } from '../config.js';

// Authentication uses Application Default Credentials (ADC). The org has
// `iam.disableServiceAccountKeyCreation` enabled, so JSON keys are off-limits.
//
// In production: the VM's attached service account (`media-writer`) is picked
// up via the GCE metadata server. The container inherits the identity — no
// credentials need to be set in env.
//
// In local dev: run `gcloud auth application-default login` (uses a refresh
// token, not a key file). For signing URLs locally, you'll also need to
// impersonate via `gcloud auth application-default login --impersonate-service-account=media-writer@gbs-infra.iam.gserviceaccount.com`
// OR grant your user `roles/iam.serviceAccountTokenCreator` on media-writer.
//
// The Storage library auto-discovers ADC; do NOT pass keyFilename/credentials.
const storage = new Storage({
  projectId: env.GCS_PROJECT_ID || undefined,
});

const bucket = () => {
  if (!env.GCS_BUCKET) {
    throw new Error('GCS_BUCKET is not configured.');
  }
  return storage.bucket(env.GCS_BUCKET);
};

export interface PresignUploadResult {
  uploadUrl: string;
  path: string;
  headers: Record<string, string>;
  expiresAt: string;
}

// Test injection hooks. Production paths call the real GCS client; tests
// install fakes via setStorageOverrides() to avoid talking to the cloud.
interface StorageOverrides {
  presignUpload?: (params: { path: string; contentType: string }) => Promise<PresignUploadResult>;
  presignRead?: (path: string, ttlSeconds?: number) => Promise<string>;
  deleteAsset?: (path: string) => Promise<boolean>;
}
let overrides: StorageOverrides | null = null;
export const setStorageOverrides = (next: StorageOverrides | null): void => {
  overrides = next;
};

// V4 signed PUT URL — 5-minute expiry. The SPA must echo Content-Type and
// Cache-Control headers exactly when PUTting; otherwise GCS rejects with 403.
export const presignUpload = async (params: {
  path: string;
  contentType: string;
}): Promise<PresignUploadResult> => {
  if (overrides?.presignUpload) return overrides.presignUpload(params);
  const cacheControl = 'public, max-age=31536000, immutable';
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const [uploadUrl] = await bucket().file(params.path).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: expiresAt,
    contentType: params.contentType,
    extensionHeaders: { 'cache-control': cacheControl },
  });
  return {
    uploadUrl,
    path: params.path,
    headers: {
      'Content-Type': params.contentType,
      'Cache-Control': cacheControl,
    },
    expiresAt: new Date(expiresAt).toISOString(),
  };
};

// V4 signed GET URL — 1-hour expiry. Used to render images in API responses
// since the bucket is private.
export const presignRead = async (path: string, ttlSeconds = 3600): Promise<string> => {
  if (overrides?.presignRead) return overrides.presignRead(path, ttlSeconds);
  const [url] = await bucket().file(path).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + ttlSeconds * 1000,
  });
  return url;
};

// Nullable wrapper for response mapping.
export const signedReadUrl = async (
  path: string | null | undefined,
): Promise<string | undefined> => {
  if (!path) return undefined;
  // Tolerate accidentally-stored full URLs (shouldn't happen with new code).
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return presignRead(path);
};

export const deleteAsset = async (path: string): Promise<boolean> => {
  if (overrides?.deleteAsset) return overrides.deleteAsset(path);
  try {
    await bucket().file(path).delete({ ignoreNotFound: true });
    return true;
  } catch {
    return false;
  }
};

export const isValidPath = (path: string): boolean => {
  if (!path || path.includes('..') || path.startsWith('/')) return false;
  // Expected shape: {ownerId}/{logo|background}/{uuid}.{ext}
  return /^[0-9a-f-]{36}\/(logo|background)\/[0-9a-f-]{36}\.(jpg|png|webp|svg)$/i.test(path);
};

// Substring form of the path shape above, for pulling the path back out of a
// full signed-GET URL's pathname.
const ASSET_PATH_RE = /[0-9a-f-]{36}\/(?:logo|background)\/[0-9a-f-]{36}\.(?:jpg|png|webp|svg)/i;

// Normalize a logo/background reference coming in on a write request into the
// canonical value to store. The DB must hold either a storage *path* or an
// external URL — never one of our own short-lived signed-GET URLs (those
// expire). Cases:
//   - empty            -> null
//   - our signed URL   -> the embedded storage path (de-signed)
//   - external URL     -> kept as-is (the SPA allows pasting hosted image URLs)
//   - already a path   -> kept as-is
export const toStoredAssetRef = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const pathname = decodeURIComponent(new URL(trimmed).pathname);
      const match = pathname.match(ASSET_PATH_RE);
      if (match) return match[0];
    } catch {
      // Not parseable as a URL — fall through and store the raw string.
    }
    return trimmed;
  }
  return trimmed;
};
