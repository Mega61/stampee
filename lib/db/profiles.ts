import { api, ApiError } from '../api';
import type { User } from '../../types';

export type ProfileFetchResult = {
  user: User | null;
  error: string | null;
  code?: string | null;
};

// Direct passthrough — API already returns camelCase matching the User shape.
const normalizeUser = (raw: unknown): User | null => {
  if (!raw || typeof raw !== 'object') return null;
  return raw as User;
};

export async function fetchProfileDetailed(_userId: string): Promise<ProfileFetchResult> {
  try {
    const data = await api.get<unknown>('/profile');
    return { user: normalizeUser(data), error: null, code: null };
  } catch (err) {
    if (err instanceof ApiError) {
      return { user: null, error: err.message, code: err.code };
    }
    return { user: null, error: 'Network error', code: 'NETWORK' };
  }
}

export async function fetchProfile(userId: string): Promise<User | null> {
  const result = await fetchProfileDetailed(userId);
  return result.user;
}

export async function fetchProfileBySlug(slug: string): Promise<User | null> {
  try {
    const data = await api.get<unknown>('/profile/by-slug', { slug });
    return normalizeUser(data);
  } catch {
    return null;
  }
}

export async function fetchStaffAccounts(_ownerId: string): Promise<User[]> {
  try {
    const data = await api.get<User[]>('/staff');
    return data ?? [];
  } catch {
    return [];
  }
}

export async function updateProfile(
  _userId: string,
  updates: {
    business_name?: string;
    email?: string;
    slug?: string;
    status?: string;
    access?: string;
    tier?: string;
    tier_expires_at?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  // The legacy callers still pass snake_case for staff access toggles.
  // Translate to the API's camelCase contract here so call sites don't change.
  const body: Record<string, unknown> = {};
  if (updates.business_name !== undefined) body['businessName'] = updates.business_name;
  if (updates.email !== undefined) body['email'] = updates.email;
  if (updates.slug !== undefined) body['slug'] = updates.slug;
  // status / access / tier on a staff profile go through different endpoints —
  // AuthProvider routes those through dedicated calls.
  try {
    if ('access' in updates && updates.access !== undefined) {
      // AuthProvider.setStaffAccess passes { access }; route to staff endpoint.
      // The userId is the staff id, not the caller.
      await api.patch(`/staff/${_userId}/access`, { access: updates.access });
      return { ok: true };
    }
    if (Object.keys(body).length === 0) return { ok: true };
    await api.patch('/profile', body);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to update this profile right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  try {
    const data = await api.get<{ available: boolean }>('/slug/available', { slug });
    return data.available === true;
  } catch {
    return false;
  }
}
