import { api, ApiError } from '../api';

// Weekly scratch game "Raspa y gana" — owner-side reads
// (docs/CARD_ENGAGEMENT_PLAN.md §8.4, §8.8, §8.10).

export interface GameEstimate {
  /** Active cards of this campaign with a visit in the last 60 days. */
  eligibleCards: number;
  expectedStampsPerMonth: number;
  cappedStampsPerMonth: number;
  expectedRewardsPerMonth: number;
}

/** GET /campaigns/:id/game-estimate — previews unsaved odds / cap. */
export async function fetchGameEstimate(
  campaignId: string,
  params: { winPct: number; cap: number },
  signal?: AbortSignal,
): Promise<GameEstimate> {
  return api.get<GameEstimate>(`/campaigns/${encodeURIComponent(campaignId)}/game-estimate`, params, signal);
}

export interface GameGroup {
  /** Card-weeks in the group (matured 14-day windows only). */
  cardWeeks: number;
  /** Of those, how many had a real visit within 14 days. */
  visited: number;
  rate: number | null;
}

export interface GameReport {
  range: { from: string; to: string };
  /** Some campaign has the game on. */
  enabled: boolean;
  /** Monthly bonus-stamp budget (largest enabled cap), null when off. */
  cap: number | null;
  totals: { plays: number; wins: number; stampsAwarded: number; players: number; winRate: number | null };
  months: Array<{ month: string; plays: number; wins: number; stampsAwarded: number; cap: number | null }>;
  comparison: {
    windowDays: number;
    players: GameGroup;
    nonPlayers: GameGroup;
    holdout: GameGroup;
    enoughData: boolean;
  };
}

/** GET /analytics/game — `from`/`to` are inclusive YYYY-MM-DD (America/Bogota). */
export async function fetchGameReport(range: { from: string; to: string }, signal?: AbortSignal): Promise<GameReport> {
  return api.get<GameReport>('/analytics/game', range, signal);
}

export { ApiError };
