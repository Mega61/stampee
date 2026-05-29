import { api, ApiError } from '../api';
import type { StoredTemplate } from '../../types';

// API returns StoredTemplate-compatible camelCase already; passthrough.
export async function fetchCampaigns(_ownerId: string): Promise<StoredTemplate[]> {
  try {
    const data = await api.get<StoredTemplate[]>('/campaigns');
    return data ?? [];
  } catch {
    return [];
  }
}

export async function upsertCampaign(
  template: StoredTemplate,
  _ownerId: string,
): Promise<{ ok: boolean; error?: string }> {
  // The SPA passes the full template; if it already has an id, use PUT to update.
  // Otherwise POST creates a fresh one.
  const hasId = Boolean(template.id);
  try {
    if (hasId) {
      await api.put(`/campaigns/${template.id}`, template);
    } else {
      await api.post('/campaigns', template);
    }
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to save this campaign right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function setCampaignEnabled(
  campaignId: string,
  _ownerId: string,
  isEnabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.patch(`/campaigns/${campaignId}/enabled`, { isEnabled });
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to update this campaign status right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function deleteCampaign(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.delete(`/campaigns/${campaignId}`);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to delete this campaign right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function countCampaigns(_ownerId: string): Promise<number> {
  try {
    const data = await api.get<{ count: number }>('/campaigns/count');
    return data?.count ?? 0;
  } catch {
    return 0;
  }
}
