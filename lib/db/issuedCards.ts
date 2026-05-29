import { api, ApiError } from '../api';
import type { IssuedCard, Transaction, StoredTemplate } from '../../types';

export type ScannedCardStatus = 'owned' | 'foreign' | 'missing';

export interface PublicScanEntryContext {
  owner: {
    id: string;
    slug: string;
    businessName: string;
  };
  card: {
    uniqueId: string;
  };
}

export async function insertIssuedCard(
  card: {
    id: string;
    uniqueId: string;
    customerId: string;
    campaignId: string;
    campaignName: string;
    templateSnapshot?: StoredTemplate;
  },
  _ownerId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.post('/cards', card);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CAMPAIGN_DISABLED') {
      return { ok: false, error: 'This campaign is disabled and cannot issue new cards.' };
    }
    const message =
      err instanceof ApiError ? err.message : 'Unable to issue this card right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function updateIssuedCard(
  cardId: string,
  updates: Partial<Pick<IssuedCard, 'stamps' | 'status' | 'completedDate' | 'lastVisit'>>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.patch(`/cards/${cardId}`, updates);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to update this card right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function deleteIssuedCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.delete(`/cards/${cardId}`);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to revoke this card right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function insertTransaction(
  cardId: string,
  tx: Transaction,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.post(`/cards/${cardId}/transactions`, {
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      date: tx.date,
      timestamp: tx.timestamp,
      title: tx.title,
      remarks: tx.remarks ?? null,
    });
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to save this activity right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function countIssuedCards(_ownerId: string): Promise<number> {
  try {
    const data = await api.get<{ count: number }>('/cards/count');
    return data?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function inspectScannedCard(
  uniqueId: string,
): Promise<{ status: ScannedCardStatus; error?: string }> {
  try {
    const data = await api.get<{ status: ScannedCardStatus }>(`/scan/inspect/${uniqueId}`);
    if (data.status === 'owned' || data.status === 'foreign' || data.status === 'missing') {
      return { status: data.status };
    }
    return { status: 'missing' };
  } catch {
    return { status: 'missing', error: 'Unable to validate this card right now. Please try again.' };
  }
}

export async function fetchPublicScanEntryContext(
  slug: string,
  uniqueId: string,
): Promise<PublicScanEntryContext | null> {
  try {
    return await api.get<PublicScanEntryContext>(`/public/scan/${slug}/${uniqueId}`);
  } catch {
    return null;
  }
}
