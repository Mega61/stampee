import { api, ApiError } from '../api';
import type { User } from '../../types';

// Co-owner ("admin") management client calls. These mirror the staff CRUD
// (some of which live inline in AuthProvider, some in lib/db/profiles.ts) but
// target the owner-only /admins endpoints and carry no PIN.

export async function fetchAdmins(): Promise<User[]> {
  try {
    const data = await api.get<User[]>('/admins');
    return data ?? [];
  } catch {
    return [];
  }
}

export async function createAdmin(payload: { name: string; email: string }): Promise<User> {
  return api.post<User>('/admins', {
    name: payload.name.trim(),
    email: payload.email.trim().toLowerCase(),
  });
}

export async function setAdminAccess(id: string, access: 'active' | 'disabled'): Promise<User> {
  return api.patch<User>(`/admins/${id}/access`, { access });
}

export async function deleteAdmin(id: string): Promise<void> {
  await api.delete(`/admins/${id}`);
}

// Re-exported so callers that want the typed error class don't need a second
// import path (mirrors how profiles.ts surfaces ApiError handling).
export { ApiError };
