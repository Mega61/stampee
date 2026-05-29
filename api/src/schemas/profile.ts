import { z } from 'zod';

const emailSchema = z.string().email().max(254).transform((v) => v.trim().toLowerCase());

export const UpdateProfileBody = z
  .object({
    businessName: z.string().trim().min(1).max(120).optional(),
    email: emailSchema.optional(),
    slug: z.string().trim().min(3).max(30).optional(),
  })
  .refine((v) => v.businessName !== undefined || v.email !== undefined || v.slug !== undefined, {
    message: 'At least one field must be provided.',
  });

export const SlugQuery = z.object({
  slug: z.string().trim().min(1).max(120),
});

export const BySlugQuery = z.object({
  slug: z.string().trim().min(1).max(120),
});
