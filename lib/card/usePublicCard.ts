// OWNER: agent D (data hooks). Public card data + live refresh (plan §6.1).
// The client is often in the salon with the card open while staff stamps it,
// so we poll while the page is visible and the card is Active, and the
// "since your last visit" diff turns whatever lands into a live moment.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fromStoredTemplate } from '../templateSerialization';
import type { GameState, IssuedCard, StoredTemplate, Template } from '../../types';

export interface PublicCardData {
  card: IssuedCard;
  customer: { id: string; name: string };
  template: Template;
  game: GameState | null;
}

type PublicCardResponse = {
  card: IssuedCard;
  customer: { id: string; name: string };
  campaign: Record<string, unknown> | null;
  game?: GameState | null;
};

export const POLL_MS = 15_000;
export const SLOW_POLL_MS = 60_000;
/** Unchanged polls before backing off to SLOW_POLL_MS. */
export const BACKOFF_AFTER = 5;

/** Snapshot is the design at issue time; fx/game settings come from the live campaign. */
export const toPublicCardData = (data: PublicCardResponse): PublicCardData | null => {
  const card: IssuedCard = { ...data.card, history: data.card.history ?? [] };
  const campaign = data.campaign as (StoredTemplate & Record<string, unknown>) | null;
  let template: Template | undefined;
  if (card.templateSnapshot) template = fromStoredTemplate(card.templateSnapshot);
  else if (campaign) template = fromStoredTemplate(campaign);
  if (!template) return null;
  if (campaign) {
    template = {
      ...template,
      fxStyle: campaign.fxStyle ?? template.fxStyle,
      gameEnabled: campaign.gameEnabled,
      gameWinPct: campaign.gameWinPct,
      gameMonthlyCap: campaign.gameMonthlyCap,
    };
  }
  return { card, customer: data.customer, template, game: data.game ?? null };
};

/**
 * Cheap change detector. Deliberately ignores the template/campaign: signed
 * image URLs change on every response and would look like a change each poll.
 */
export const cardFingerprint = (data: PublicCardData | null) => {
  if (!data) return '';
  const { card, game } = data;
  const history = card.history ?? [];
  const last = history.reduce<IssuedCard['history'][number] | null>(
    (latest, tx) => (!latest || tx.timestamp >= latest.timestamp ? tx : latest),
    null,
  );
  return [
    card.stamps,
    card.status,
    history.length,
    last?.id ?? '',
    game?.state ?? '',
    game?.lastResult?.playedAt ?? '',
    game?.nextPlayAt ?? '',
  ].join('|');
};

/** Delay before the next poll, or null when polling should stop. */
export const nextPollDelay = (status: IssuedCard['status'] | undefined, unchangedPolls: number) =>
  status === 'Active' ? (unchangedPolls >= BACKOFF_AFTER ? SLOW_POLL_MS : POLL_MS) : null;

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

export const usePublicCard = (slug: string | undefined, uniqueId: string | undefined) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PublicCardData | null>(null);

  const dataRef = useRef<PublicCardData | null>(null);
  const fingerprint = useRef('');
  const unchanged = useRef(0);
  const inFlight = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const fetchCard = useCallback(
    (force: boolean): Promise<void> => {
      if (!slug || !uniqueId) return Promise.resolve();
      if (inFlight.current) {
        // Polls never overlap; an explicit refresh replaces a stale poll.
        if (!force) return inFlight.current.promise;
        inFlight.current.controller.abort();
      }
      const controller = new AbortController();
      const promise = (async () => {
        try {
          const res = await api.get<PublicCardResponse>(`/public/cards/${slug}/${uniqueId}`, undefined, controller.signal);
          if (controller.signal.aborted || !alive.current) return;
          const next = toPublicCardData(res);
          if (!next) return;
          const fp = cardFingerprint(next);
          if (fp === fingerprint.current && dataRef.current) {
            unchanged.current += 1;
            return;
          }
          unchanged.current = 0;
          fingerprint.current = fp;
          dataRef.current = next;
          setData(next);
        } catch {
          // Keep the last good data; "Card not found" only when nothing ever loaded.
        } finally {
          if (inFlight.current?.controller === controller) inFlight.current = null;
        }
      })();
      inFlight.current = { controller, promise };
      return promise;
    },
    [slug, uniqueId],
  );

  const schedule = useCallback(() => {
    clearTimer();
    if (!alive.current || !isVisible()) return;
    const delay = nextPollDelay(dataRef.current?.card.status, unchanged.current);
    if (delay === null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void fetchCard(false).then(schedule);
    }, delay);
  }, [fetchCard]);

  // Initial load + polling lifecycle, per card.
  useEffect(() => {
    let active = true;
    alive.current = true;
    dataRef.current = null;
    fingerprint.current = '';
    unchanged.current = 0;
    setData(null);
    if (!slug || !uniqueId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchCard(true).finally(() => {
      if (!active) return;
      setLoading(false);
      schedule();
    });

    const wake = () => {
      if (!isVisible()) {
        clearTimer();
        return;
      }
      // Redeemed cards are closed: nothing left to watch.
      if (dataRef.current && dataRef.current.card.status !== 'Active') return;
      clearTimer();
      void fetchCard(false).then(schedule);
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      active = false;
      alive.current = false;
      clearTimer();
      inFlight.current?.controller.abort();
      inFlight.current = null;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [slug, uniqueId, fetchCard, schedule]);

  const refresh = useCallback(async () => {
    await fetchCard(true);
    schedule();
  }, [fetchCard, schedule]);

  const applyCardUpdate = useCallback((patch: Partial<IssuedCard>) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, card: { ...prev.card, ...patch } };
      dataRef.current = next;
      return next;
    });
  }, []);

  return { loading, data, refresh, applyCardUpdate };
};
