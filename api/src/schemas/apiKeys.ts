import { z } from 'zod';

export const CreateApiKeyBody = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  // Optional expiry; omit for a non-expiring key. Capped at ~10 years.
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBody>;
