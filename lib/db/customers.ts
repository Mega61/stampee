import { api, ApiError } from '../api';
import type { Customer } from '../../types';

// API endpoint returns customers with nested cards + history when
// ?include=cards,transactions is passed. Matches Customer shape directly.
export async function fetchCustomersWithCards(_ownerId: string): Promise<Customer[]> {
  try {
    const data = await api.get<Customer[]>('/customers', { include: 'cards,transactions' });
    return data ?? [];
  } catch {
    return [];
  }
}

export async function upsertCustomer(
  customer: { id: string; name: string; email: string; mobile?: string; status: 'Active' | 'Inactive' },
  _ownerId: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const data = await api.post<{ id: string }>('/customers', customer);
    return { ok: true, id: data?.id ?? customer.id };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to save this customer right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function updateCustomerStatus(
  customerId: string,
  status: 'Active' | 'Inactive',
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.patch(`/customers/${customerId}`, { status });
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : 'Unable to update this customer right now. Please try again.';
    return { ok: false, error: message };
  }
}
