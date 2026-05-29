import { z } from 'zod';

const emailSchema = z.string().email().max(254).transform((v) => v.trim().toLowerCase());
const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits.');

export const CreateStaffBody = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: emailSchema,
  pin: pinSchema,
});

export const UpdateStaffPinBody = z.object({
  pin: pinSchema,
});

export const UpdateStaffAccessBody = z.object({
  access: z.enum(['active', 'disabled']),
});
