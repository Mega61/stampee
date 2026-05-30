import { z } from 'zod';

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters.').max(200);
const emailSchema = z.string().email().max(254).transform((v) => v.trim().toLowerCase());

export const SignupBody = z.object({
  businessName: z.string().trim().min(1, 'Business name is required.').max(120),
  email: emailSchema,
  password: passwordSchema,
  slug: z.string().trim().min(3).max(30),
});
export type SignupBody = z.infer<typeof SignupBody>;

export const VerifyEmailQuery = z.object({
  token: z.string().min(16),
});

export const ResendVerificationBody = z.object({
  email: emailSchema.optional(),
});

export const LoginBody = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const StaffLoginBody = z.object({
  email: emailSchema,
  pin: z.string().min(4).max(6),
  orgId: z.string().trim().min(1).max(120),
});

export const GoogleAuthBody = z.object({
  credential: z.string().min(1),
});

export const GoogleStaffAuthBody = z.object({
  credential: z.string().min(1),
  orgId: z.string().trim().min(1).max(120),
});

export const ForgotPasswordBody = z.object({
  email: emailSchema,
});

export const ResetPasswordBody = z.object({
  token: z.string().min(16),
  newPassword: passwordSchema,
});

export const ChangePasswordBody = z.object({
  newPassword: passwordSchema,
});
