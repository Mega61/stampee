import { api, ApiError } from '../api';

export type CampaignAssetKind = 'logo' | 'background';

type UploadCampaignAssetInput = {
  file: File;
  ownerId: string;
  kind: CampaignAssetKind;
};

type UploadedCampaignAsset = {
  // `publicUrl` is what gets stored in the DB. With the private-bucket setup
  // it's actually the *path* the API returned from presign; the API resolves
  // it back into a short-lived signed-GET URL on every read.
  publicUrl: string;
  path: string;
};

type DeleteCampaignAssetResult = {
  managed: boolean;
  deleted: boolean;
  error?: string;
};

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BACKGROUND_MAX_BYTES = 6 * 1024 * 1024;
const LOGO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg']);
const BACKGROUND_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const LOGO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
]);
const BACKGROUND_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const resolveAllowedRules = (kind: CampaignAssetKind) => {
  if (kind === 'logo') {
    return {
      maxBytes: LOGO_MAX_BYTES,
      allowedExtensions: LOGO_EXTENSIONS,
      allowedMimeTypes: LOGO_MIME_TYPES,
      typeError: 'Logo must be a JPG, PNG, WebP, or SVG file.',
      sizeError: 'Logo must be 2MB or smaller.',
    };
  }
  return {
    maxBytes: BACKGROUND_MAX_BYTES,
    allowedExtensions: BACKGROUND_EXTENSIONS,
    allowedMimeTypes: BACKGROUND_MIME_TYPES,
    typeError: 'Background must be a JPG, PNG, or WebP file.',
    sizeError: 'Background must be 6MB or smaller.',
  };
};

const getExtensionFromName = (filename: string) => {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1];
};

const validateUploadFile = (kind: CampaignAssetKind, file: File) => {
  const rules = resolveAllowedRules(kind);
  if (file.size > rules.maxBytes) throw new Error(rules.sizeError);

  const extension = getExtensionFromName(file.name);
  const extensionAllowed = Boolean(extension) && rules.allowedExtensions.has(extension);
  const mimeAllowed = Boolean(file.type) && rules.allowedMimeTypes.has(file.type);
  if (!extensionAllowed && !mimeAllowed) throw new Error(rules.typeError);
};

interface PresignResponse {
  uploadUrl: string;
  path: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export async function uploadCampaignAsset({
  file,
  ownerId: _ownerId,
  kind,
}: UploadCampaignAssetInput): Promise<UploadedCampaignAsset> {
  validateUploadFile(kind, file);

  // Server-side validation overlap is intentional — server is the source of
  // truth, client-side just gives faster feedback.
  let presign: PresignResponse;
  try {
    presign = await api.post<PresignResponse>('/storage/campaign-assets/presign', {
      kind,
      contentType: file.type,
      sizeBytes: file.size,
    });
  } catch (err) {
    if (err instanceof ApiError) throw new Error(err.message);
    throw new Error('Unable to prepare upload right now. Please try again.');
  }

  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: presign.headers,
    body: file,
  });
  if (!putRes.ok) {
    throw new Error('Image upload failed. Please try again.');
  }

  // Store the path in the DB. The API converts it back to a signed-GET URL
  // on read; the SPA only ever renders signed URLs.
  return { publicUrl: presign.path, path: presign.path };
}

export async function deleteCampaignAssetByUrl(url: string): Promise<DeleteCampaignAssetResult> {
  if (!url) return { managed: false, deleted: false };

  // After the migration we store the path, not a full URL. Tolerate either:
  // if it looks like a signed URL we just refuse (no path extraction); if it
  // looks like a path, send it as-is.
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // Currently-rendered signed URLs are not the canonical reference — they
    // expire. Anything that needs to delete should have the path already.
    return {
      managed: false,
      deleted: false,
      error: 'Cannot delete a signed URL — pass the storage path instead.',
    };
  }

  try {
    const data = await api.delete<{ deleted: boolean }>('/storage/campaign-assets', { path: url });
    return { managed: true, deleted: Boolean(data?.deleted) };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to remove previous image from storage.';
    return { managed: true, deleted: false, error: message };
  }
}
