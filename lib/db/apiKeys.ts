import { api, ApiError } from '../api';
import type { ApiKey, ApiKeyWithSecret } from '../../types';

// API-key management client calls. These target the owner/admin-only
// /api-keys endpoints (cookie-authed, like /admins and /staff). The plaintext
// secret is only ever returned by createApiKey, once.

export async function fetchApiKeys(): Promise<ApiKey[]> {
  try {
    const data = await api.get<ApiKey[]>('/api-keys');
    return data ?? [];
  } catch {
    return [];
  }
}

export async function createApiKey(payload: {
  name: string;
  expiresInDays?: number;
}): Promise<ApiKeyWithSecret> {
  const body: Record<string, unknown> = { name: payload.name.trim() };
  if (payload.expiresInDays) body.expiresInDays = payload.expiresInDays;
  return api.post<ApiKeyWithSecret>('/api-keys', body);
}

export async function revokeApiKey(id: string): Promise<void> {
  await api.delete(`/api-keys/${id}`);
}

export { ApiError };
