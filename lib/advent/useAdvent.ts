// Advent calendar data for the public card (docs/ADVENT_CONTRACT.md).
// GET /public/cards/:slug/:id/advent once, again on focus and whenever a
// countdown hits zero (a door unlocks, a flash door closes). The server's
// clock decides: we keep an offset from `serverNow` and never trust the phone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { nextBoundary } from './viewModel';
import { AdventOpenError, type AdventController, type AdventOpenFailure, type AdventOpenResult, type AdventState } from './types';

/** Refetch a moment after a boundary, so the server agrees the door is open. */
const BOUNDARY_SLACK_MS = 1500;
/** setTimeout can't wait longer than ~24.8 days; re-arm instead. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const path = (slug: string, id: string) => `/public/cards/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/advent`;

const OPEN_FAILURES = new Set<AdventOpenFailure>(['NOT_YET', 'CLOSED', 'NOT_ELIGIBLE', 'NOT_FOUND']);

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * `enabled: false` skips the network (holdout, redeemed card, or /dev/advent
 * passing its own controller).
 */
export const useAdvent = (slug: string | undefined, id: string | undefined, enabled = true): AdventController => {
  const [state, setState] = useState<AdventState | null>(null);
  const [loading, setLoading] = useState(enabled);
  const offset = useRef(0);
  const alive = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const adopt = useCallback((next: AdventState) => {
    const server = new Date(next.serverNow).getTime();
    if (Number.isFinite(server)) offset.current = server - Date.now();
    setState(next);
  }, []);

  const now = useCallback(() => Date.now() + offset.current, []);

  const fetchState = useCallback((): Promise<void> => {
    if (!enabled || !slug || !id) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const promise = (async () => {
      try {
        const next = await api.get<AdventState>(path(slug, id));
        if (alive.current) adopt(next);
      } catch (err) {
        // 404 ADVENT_OFF: no calendar, so no back face. Anything else keeps
        // the last good state.
        if (err instanceof ApiError && err.status === 404 && alive.current) setState(null);
      } finally {
        inFlight.current = null;
        if (alive.current) setLoading(false);
      }
    })();
    inFlight.current = promise;
    return promise;
  }, [enabled, slug, id, adopt]);

  useEffect(() => {
    alive.current = true;
    setState(null);
    setLoading(enabled && !!slug && !!id);
    void fetchState();
    const wake = () => {
      if (isVisible()) void fetchState();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [fetchState, enabled, slug, id]);

  // Refetch when the next countdown hits zero.
  useEffect(() => {
    if (!state) return;
    const at = nextBoundary(state, now());
    if (at === null) return;
    const delay = Math.min(MAX_TIMER_MS, at - now() + BOUNDARY_SLACK_MS);
    const timer = setTimeout(() => void fetchState(), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [state, now, fetchState]);

  const openDoor = useCallback(
    async (no: number): Promise<AdventOpenResult> => {
      if (!slug || !id) throw new AdventOpenError('NOT_FOUND', 'Sin tarjeta');
      try {
        const result = await api.post<AdventOpenResult>(`${path(slug, id)}/doors/${no}/open`);
        const server = new Date(result.state.serverNow).getTime();
        if (Number.isFinite(server)) offset.current = server - Date.now();
        return result;
      } catch (err) {
        if (err instanceof ApiError) {
          const reason = (err.code as AdventOpenFailure) ?? 'NETWORK';
          throw new AdventOpenError(OPEN_FAILURES.has(reason) ? reason : 'NETWORK', err.message);
        }
        throw new AdventOpenError('NETWORK', err instanceof Error ? err.message : 'Network error');
      }
    },
    [slug, id],
  );

  const refresh = useCallback(() => fetchState(), [fetchState]);

  return useMemo(
    () => ({ state, loading, now, openDoor, apply: adopt, refresh }),
    [state, loading, now, openDoor, adopt, refresh],
  );
};
