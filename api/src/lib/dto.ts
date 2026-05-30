// Snake_case row → camelCase DTO mappers, matching the shapes the SPA
// already consumes (see lib/db/*.ts in the SPA).

export type CampaignRow = {
  id: string;
  owner_id: string;
  name: string;
  is_enabled: boolean;
  description: string;
  reward_name: string;
  tagline: string | null;
  background_image: string | null;
  background_opacity: number | null;
  logo_image: string | null;
  show_logo: boolean | null;
  title_size: string | null;
  icon_key: string;
  colors: Record<string, string>;
  total_stamps: number;
  social: Record<string, unknown> | null;
  created_at: Date | string;
};

export const toCampaignDto = (r: CampaignRow) => ({
  id: r.id,
  name: r.name,
  isEnabled: r.is_enabled,
  description: r.description,
  rewardName: r.reward_name,
  tagline: r.tagline ?? undefined,
  backgroundImage: r.background_image ?? undefined,
  backgroundOpacity: r.background_opacity ?? 100,
  logoImage: r.logo_image ?? undefined,
  showLogo: r.show_logo ?? true,
  titleSize: r.title_size ?? undefined,
  iconKey: r.icon_key,
  colors: r.colors,
  totalStamps: r.total_stamps,
  social: r.social ?? undefined,
});

// Same shape as toCampaignDto, but converts logo_image / background_image
// from stored GCS paths into short-lived signed-GET URLs. The signer is
// passed in (rather than imported here) so unit tests can stub it.
type Signer = (path: string | null | undefined) => Promise<string | undefined>;
export const toCampaignDtoSigned = async (r: CampaignRow, sign: Signer) => {
  const dto = toCampaignDto(r);
  const [logoImage, backgroundImage] = await Promise.all([
    sign(r.logo_image),
    sign(r.background_image),
  ]);
  return { ...dto, logoImage, backgroundImage };
};

// Sign image fields embedded in a stored template_snapshot JSON. The snapshot
// uses camelCase keys (matching the SPA's StoredTemplate shape) because it
// was built by the loyalty.register_public_campaign_signup function.
export const signTemplateSnapshot = async (
  snapshot: Record<string, unknown> | null | undefined,
  sign: Signer,
): Promise<Record<string, unknown> | undefined> => {
  if (!snapshot) return undefined;
  const out = { ...snapshot };
  const logo = typeof out['logoImage'] === 'string' ? (out['logoImage'] as string) : null;
  const bg = typeof out['backgroundImage'] === 'string' ? (out['backgroundImage'] as string) : null;
  const [logoSigned, bgSigned] = await Promise.all([sign(logo), sign(bg)]);
  out['logoImage'] = logoSigned ?? null;
  out['backgroundImage'] = bgSigned ?? null;
  return out;
};

export type CustomerRow = {
  id: string;
  owner_id: string;
  name: string;
  email: string;
  mobile: string | null;
  status: 'Active' | 'Inactive';
  created_at: Date | string;
};

export const toCustomerDto = (r: CustomerRow) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  mobile: r.mobile ?? undefined,
  status: r.status,
});

export type IssuedCardRow = {
  id: string;
  unique_id: string;
  customer_id: string;
  campaign_id: string | null;
  owner_id: string;
  campaign_name: string;
  stamps: number;
  last_visit: string;
  status: 'Active' | 'Redeemed';
  completed_date: string | null;
  template_snapshot: Record<string, unknown> | null;
  created_at: Date | string;
};

export const toIssuedCardDto = (r: IssuedCardRow) => ({
  id: r.id,
  uniqueId: r.unique_id,
  customerId: r.customer_id,
  campaignId: r.campaign_id,
  campaignName: r.campaign_name,
  stamps: r.stamps,
  lastVisit: r.last_visit,
  status: r.status,
  completedDate: r.completed_date ?? undefined,
  templateSnapshot: r.template_snapshot ?? undefined,
});

export type TransactionRow = {
  id: string;
  card_id: string;
  type: 'stamp_add' | 'stamp_remove' | 'redeem' | 'issued';
  amount: number;
  date: string;
  timestamp: number;
  title: string;
  remarks: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
};

export const toTransactionDto = (r: TransactionRow) => ({
  id: r.id,
  type: r.type,
  amount: r.amount,
  date: r.date,
  timestamp: r.timestamp,
  title: r.title,
  remarks: r.remarks ?? undefined,
  actorId: r.actor_id ?? undefined,
  actorName: r.actor_name ?? undefined,
  actorRole: r.actor_role ?? undefined,
});

// Parse a zod schema and convert ZodError into AppError(400) — moved here so
// every route module doesn't duplicate the helper.
import { ZodError } from 'zod';
import { AppError } from './errors.js';

export const parseBody = <T>(schema: { parse: (input: unknown) => T }, input: unknown): T => {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.errors[0];
      // Include the field path so 400s are diagnosable from the response/logs
      // instead of a bare "Invalid url".
      const path = first?.path?.join('.') ?? '';
      const detail = first?.message ?? 'Invalid request.';
      throw new AppError(400, 'VALIDATION', path ? `${path}: ${detail}` : detail);
    }
    throw err;
  }
};
