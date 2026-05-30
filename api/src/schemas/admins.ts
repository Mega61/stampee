import { z } from 'zod';

const emailSchema = z.string().email().max(254).transform((v) => v.trim().toLowerCase());

export const CreateAdminBody = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: emailSchema,
});

export const UpdateAdminAccessBody = z.object({
  access: z.enum(['active', 'disabled']),
});
