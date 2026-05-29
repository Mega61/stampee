import { z } from 'zod';

export const PresignBody = z.object({
  kind: z.enum(['logo', 'background']),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
});

// SPA sends the storage path (returned from presign), not a URL. The path is
// what we stored in the DB.
export const DeleteAssetBody = z.object({
  path: z.string().min(1).max(500),
});
