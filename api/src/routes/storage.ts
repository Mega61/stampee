import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { parseBody } from '../lib/dto.js';
import { requireRole } from '../middleware/requireRole.js';
import { presignUpload, deleteAsset, isValidPath } from '../storage/gcs.js';
import { buildAssetPath, validateAsset } from '../storage/paths.js';
import { PresignBody, DeleteAssetBody } from '../schemas/storage.js';

export const storageRoutes: FastifyPluginAsync = async (app) => {
  // POST /storage/campaign-assets/presign — owner only.
  // Returns uploadUrl + path. The SPA PUTs the file to uploadUrl with the
  // exact headers we returned, then saves `path` into the campaign row.
  app.post('/storage/campaign-assets/presign', async (req) => {
    const claims = await requireRole(req, 'owner');
    const body = parseBody(PresignBody, req.body);

    const check = validateAsset({
      kind: body.kind,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
    if ('error' in check) {
      throw new AppError(400, 'INVALID_ASSET', check.error);
    }

    const path = buildAssetPath({
      ownerId: claims.sub,
      kind: body.kind,
      uuid: randomUUID(),
      ext: check.ext,
    });
    const result = await presignUpload({ path, contentType: body.contentType });
    return { ok: true, data: result };
  });

  // DELETE /storage/campaign-assets { path } — owner only.
  // Refuses paths that don't start with the caller's owner id.
  app.delete('/storage/campaign-assets', async (req) => {
    const claims = await requireRole(req, 'owner');
    const body = parseBody(DeleteAssetBody, req.body);

    if (!isValidPath(body.path)) {
      throw new AppError(400, 'INVALID_PATH', 'Path is not in the expected shape.');
    }
    if (!body.path.startsWith(`${claims.sub}/`)) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot delete assets that belong to another owner.');
    }

    const deleted = await deleteAsset(body.path);
    return { ok: true, data: { deleted } };
  });
};
