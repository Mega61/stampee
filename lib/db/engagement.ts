import { api, ApiError } from '../api';
import type { CardViewSource } from '../../types';

// Card engagement report (owner/admin): GET /analytics/engagement.
// Rates are 0..1 and null when there is nothing to divide by.

export interface EngagementKpis {
  /** Share of cards with a visit in range that had another visit within 45 days. */
  comebackRate: number | null;
  /** Median days between consecutive visits (later visit in range). */
  medianDaysBetweenVisits: number | null;
  opensPerCardPerWeek: number | null;
  medianSessionSeconds: number | null;
}

export interface EngagementArm {
  cards: number;
  cardsWithVisit: number;
  comebackRate: number | null;
  medianDaysBetweenVisits: number | null;
}

export interface EngagementReport {
  range: { from: string; to: string };
  funnel: {
    activeCards: number;
    openedCards: number;
    reopenedCards: number;
    visitedAfterOpenCards: number;
  };
  kpis: EngagementKpis;
  previous: EngagementKpis;
  experiment: { fx: EngagementArm; holdout: EngagementArm; enoughData: boolean };
  sources: Record<CardViewSource, number>;
  /** Passes in Wallet. Optional: absent from APIs older than migration 0017. */
  walletPasses?: Record<'google' | 'apple', WalletPassStats>;
}

export interface WalletPassStats {
  /** Passes in clients' wallets now (Google: since save callbacks went live). */
  current: number;
  /** Saved in range (Apple: per device). */
  added: number;
  /** Removed in range. */
  removed: number;
}

/** `from`/`to` are inclusive YYYY-MM-DD dates (America/Bogota on the server). */
export async function fetchEngagement(
  range: { from: string; to: string },
  signal?: AbortSignal,
): Promise<EngagementReport> {
  return api.get<EngagementReport>('/analytics/engagement', range, signal);
}

export { ApiError };
