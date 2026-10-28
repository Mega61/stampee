// Client for the weekly scratch game (docs/CARD_ENGAGEMENT_PLAN.md §8.3).
// The server decides the result; the ticket only animates it.
import { api, ApiError } from '../api';
import type { PlayResult } from '../../types';

export type PlayFailure = 'unavailable' | 'network';

export class PlayError extends Error {
  readonly kind: PlayFailure;
  /** Server reason for 'unavailable' (DISABLED, HOLDOUT, NOT_ACTIVE, NO_RECENT_VISIT). */
  readonly reason?: string;
  constructor(kind: PlayFailure, message: string, reason?: string) {
    super(message);
    this.kind = kind;
    this.reason = reason;
    this.name = 'PlayError';
  }
}

type PlayFn = (slug: string, uniqueId: string) => Promise<PlayResult>;

// Dev playground hook (/dev/ticket): replaces the network call with a mock.
let override: PlayFn | null = null;
export const setPlayOverride = (fn: PlayFn | null) => {
  override = fn;
};

/** POST /public/cards/:slug/:uniqueId/game/play. Idempotent per card and week. */
export const playWeeklyGame = async (slug: string, uniqueId: string): Promise<PlayResult> => {
  if (override) return override(slug, uniqueId);
  try {
    return await api.post<PlayResult>(
      `/public/cards/${encodeURIComponent(slug)}/${encodeURIComponent(uniqueId)}/game/play`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      throw new PlayError('unavailable', err.message, err.code);
    }
    throw new PlayError('network', err instanceof Error ? err.message : 'Network error');
  }
};
