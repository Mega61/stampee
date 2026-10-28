// OWNER: agent D (data hooks). Engagement beacon (plan §4.3).
// One session per mount: a start ping shortly after the card shows, an update
// every 30 s while visible, and a final ping via sendBeacon when the page is
// hidden or unloaded. Only VISIBLE time counts. Never throws, never logs; the
// server keeps the max of duration/interactions per (card, session).
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../api';
import type { CardVariant, CardViewSource } from '../../types';
import { buildViewPayload, createSessionId, detectSource, shouldTrack, viewsUrl } from './beaconSource';

const START_DELAY_MS = 1_000;
const UPDATE_EVERY_MS = 30_000;

const isStandalone = () => {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
};

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

export const useEngagementBeacon = (opts: {
  slug: string | undefined;
  uniqueId: string | undefined;
  variant: CardVariant;
  sawNewStamps: boolean;
  enabled: boolean;
}) => {
  const { slug, uniqueId, variant, sawNewStamps, enabled } = opts;
  const [sessionId] = useState(() => createSessionId());
  const [source] = useState<CardViewSource>(() =>
    typeof window === 'undefined' ? 'link' : detectSource(window.location.search, isStandalone()),
  );

  const interactions = useRef(0);
  const sawRef = useRef(sawNewStamps);
  sawRef.current = sawRef.current || sawNewStamps;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  // Visible-time clock: accumulated ms + the currently running visible stretch.
  const clock = useRef({ total: 0, since: isVisible() ? Date.now() : null as number | null });
  const elapsed = () => clock.current.total + (clock.current.since !== null ? Date.now() - clock.current.since : 0);
  const pause = () => {
    if (clock.current.since !== null) {
      clock.current.total += Date.now() - clock.current.since;
      clock.current.since = null;
    }
  };
  const resume = () => {
    if (clock.current.since === null) clock.current.since = Date.now();
  };

  const trackInteraction = useCallback((_kind?: string) => {
    interactions.current += 1;
  }, []);

  const tracked = typeof window !== 'undefined' && shouldTrack(slug, uniqueId, window.location.pathname);

  // The clock runs from mount (including while the card loads), paused while hidden.
  useEffect(() => {
    const onVisibility = () => (isVisible() ? resume() : pause());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tracked || !enabled || !slug || !uniqueId) return;
    const url = viewsUrl(API_BASE, slug, uniqueId);
    let started = false;
    let lastSent = '';

    const payload = () =>
      JSON.stringify(
        buildViewPayload({
          sessionId,
          source,
          variant: variantRef.current,
          durationMs: elapsed(),
          interactions: interactions.current,
          sawNewStamps: sawRef.current,
        }),
      );

    const send = (final: boolean) => {
      try {
        const body = payload();
        if (body === lastSent) return;
        lastSent = body;
        if (final && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          // text/plain keeps it a "simple" request: no CORS preflight.
          const queued = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
          if (queued) return;
        }
        void fetch(url, {
          method: 'POST',
          body,
          keepalive: true,
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      } catch {
        // analytics must never break the card
      }
    };

    let interval: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      if (interval === null) interval = setInterval(() => send(false), UPDATE_EVERY_MS);
    };
    const stopInterval = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
    };

    const startTimer = setTimeout(() => {
      started = true;
      send(false);
      if (isVisible()) startInterval();
    }, START_DELAY_MS);

    const onVisibility = () => {
      if (isVisible()) {
        resume();
        if (started) startInterval();
      } else {
        pause();
        stopInterval();
        if (started) send(true);
      }
    };
    const onPageHide = () => {
      pause();
      stopInterval();
      // Closing within the first second still counts as a (short) view.
      started = true;
      send(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearTimeout(startTimer);
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // SPA navigation away from the card.
      if (started) send(true);
    };
    // elapsed/pause/resume only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, enabled, slug, uniqueId, sessionId, source]);

  return { trackInteraction, sessionId, source };
};
