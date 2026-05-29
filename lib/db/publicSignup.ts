import { api, ApiError } from '../api';

export interface PublicCampaignSignupContext {
  owner: {
    id: string;
    slug: string;
    businessName: string;
  };
  campaign: {
    id: string;
    name: string;
    isEnabled: boolean;
  };
}

export type PublicCampaignSignupOutcome =
  | { outcome: 'issued'; uniqueId: string }
  | { outcome: 'redirect_existing'; uniqueId: string }
  | { outcome: 'campaign_disabled_no_existing' }
  | { outcome: 'error'; error: string };

export async function fetchPublicCampaignSignupContext(
  slug: string,
  campaignId: string,
): Promise<PublicCampaignSignupContext | null> {
  try {
    return await api.get<PublicCampaignSignupContext>(`/public/signup/${slug}/${campaignId}`);
  } catch {
    return null;
  }
}

export async function registerPublicCampaignSignup(input: {
  slug: string;
  campaignId: string;
  name: string;
  email?: string;
  mobile?: string;
}): Promise<PublicCampaignSignupOutcome> {
  try {
    const data = await api.post<PublicCampaignSignupOutcome>(
      `/public/signup/${input.slug}/${input.campaignId}`,
      {
        name: input.name,
        email: input.email ?? null,
        mobile: input.mobile ?? null,
      },
    );
    return data;
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to complete signup right now. Please try again.';
    return { outcome: 'error', error: message };
  }
}
