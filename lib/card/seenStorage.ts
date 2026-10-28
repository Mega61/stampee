// Persistence for the "since your last visit" state. Every access is guarded:
// Safari private mode, disabled storage and quota errors must never break the
// card — worst case the client sees nothing as new.
import { parseSeenState, type SeenState } from './diffCard';

export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const seenKey = (uniqueId: string) => `stampee:seen:${uniqueId}`;

/** window.localStorage, or null when it isn't reachable. */
export const browserSeenStorage = (): SeenStorage | null => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const loadSeen = (storage: SeenStorage | null, uniqueId: string): SeenState | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(seenKey(uniqueId));
    return raw ? parseSeenState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

export const saveSeen = (storage: SeenStorage | null, uniqueId: string, seen: SeenState) => {
  if (!storage) return;
  try {
    storage.setItem(seenKey(uniqueId), JSON.stringify(seen));
  } catch {
    // quota / private mode: the moment just replays next time
  }
};
