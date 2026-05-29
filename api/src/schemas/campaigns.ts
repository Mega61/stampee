import { z } from 'zod';

const colorsSchema = z.record(z.string());
const socialSchema = z.record(z.string()).nullable().optional();

// Match the SPA's StoredTemplate camelCase shape exactly.
export const CampaignBody = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  isEnabled: z.boolean().optional(),
  description: z.string().max(2000).default(''),
  rewardName: z.string().max(200).default(''),
  tagline: z.string().max(500).optional().nullable(),
  backgroundImage: z.string().url().optional().nullable(),
  backgroundOpacity: z.number().int().min(0).max(100).optional(),
  logoImage: z.string().url().optional().nullable(),
  showLogo: z.boolean().optional(),
  titleSize: z.string().max(50).optional().nullable(),
  iconKey: z.string().min(1).max(80),
  colors: colorsSchema,
  totalStamps: z.number().int().min(1).max(100),
  social: socialSchema,
});

export type CampaignBody = z.infer<typeof CampaignBody>;

export const UpdateEnabledBody = z.object({
  isEnabled: z.boolean(),
});
