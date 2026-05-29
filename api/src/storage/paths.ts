// Path layout matches the original Supabase storage layout so URLs stay
// consistent: `{ownerId}/{kind}/{uuid}.{ext}`.
export type AssetKind = 'logo' | 'background';

const LOGO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
const BACKGROUND_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BACKGROUND_MAX_BYTES = 6 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export const validateAsset = (params: {
  kind: AssetKind;
  contentType: string;
  sizeBytes: number;
}): { ext: string } | { error: string } => {
  const allowed = params.kind === 'logo' ? LOGO_MIME : BACKGROUND_MIME;
  if (!allowed.has(params.contentType)) {
    return { error: `Unsupported content type for ${params.kind}.` };
  }
  const max = params.kind === 'logo' ? LOGO_MAX_BYTES : BACKGROUND_MAX_BYTES;
  if (params.sizeBytes <= 0 || params.sizeBytes > max) {
    const mb = Math.round(max / (1024 * 1024));
    return { error: `${params.kind} must be ≤ ${mb} MB.` };
  }
  const ext = MIME_TO_EXT[params.contentType];
  if (!ext) return { error: 'Unsupported content type.' };
  return { ext };
};

export const buildAssetPath = (params: {
  ownerId: string;
  kind: AssetKind;
  uuid: string;
  ext: string;
}): string => `${params.ownerId}/${params.kind}/${params.uuid}.${params.ext}`;
