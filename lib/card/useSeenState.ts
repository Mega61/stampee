// OWNER: agent D (data hooks). "Since your last visit" (plan §6.2).
// The diff itself is pure (diffCard.ts); this hook keeps the per-card seen
// state in memory + localStorage and recomputes events whenever the card
// changes, so stamps that land during a live refresh become events too.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IssuedCard, Template } from '../../types';
import type { NewStampEvent } from './types';
import { acknowledgeSeen, baselineSeen, diffCard, syncRewardRevealed, type SeenState } from './diffCard';
import { browserSeenStorage, loadSeen, saveSeen, type SeenStorage } from './seenStorage';

const NO_EVENTS: NewStampEvent[] = [];

export const useSeenState = (
  card: IssuedCard | null,
  template: Template | null,
  storage: SeenStorage | null = browserSeenStorage(),
) => {
  const uniqueId = card?.uniqueId ?? null;
  const [entry, setEntry] = useState<{ uniqueId: string; seen: SeenState } | null>(null);
  const storageRef = useRef(storage);
  storageRef.current = storage;

  // Load (or create the first-visit baseline) synchronously on the first
  // render that has a card, so the card view mounts with its events already
  // known and slots start hidden/wrapped instead of flashing filled.
  let seen = entry && entry.uniqueId === uniqueId ? entry.seen : null;
  if (card && uniqueId && !seen) {
    seen = loadSeen(storage, uniqueId) ?? baselineSeen(card);
    setEntry({ uniqueId, seen });
  }

  // Persist whatever is in memory (covers the new baseline too).
  useEffect(() => {
    if (entry) saveSeen(storageRef.current, entry.uniqueId, entry.seen);
  }, [entry]);

  // New reward cycle → the reveal may play again.
  useEffect(() => {
    if (!card || !template || !entry || entry.uniqueId !== card.uniqueId) return;
    const synced = syncRewardRevealed(entry.seen, card, template.totalStamps);
    if (synced !== entry.seen) setEntry({ uniqueId: entry.uniqueId, seen: synced });
  }, [card, template, entry]);

  const newStampEvents = useMemo(
    () => (card && seen ? diffCard(card, seen) : NO_EVENTS),
    [card, seen],
  );

  const [sawNewStamps, setSawNewStamps] = useState(false);
  if (newStampEvents.length > 0 && !sawNewStamps) setSawNewStamps(true);

  const cardRef = useRef(card);
  cardRef.current = card;

  const acknowledge = useCallback((ids: string[]) => {
    const current = cardRef.current;
    if (!current || ids.length === 0) return;
    setEntry((prev) =>
      prev && prev.uniqueId === current.uniqueId
        ? { uniqueId: prev.uniqueId, seen: acknowledgeSeen(prev.seen, current, ids) }
        : prev,
    );
  }, []);

  const markRewardRevealed = useCallback(() => {
    setEntry((prev) => (prev && !prev.seen.revealedReward ? { ...prev, seen: { ...prev.seen, revealedReward: true } } : prev));
  }, []);

  return {
    newStampEvents,
    acknowledge,
    rewardRevealed: !!(seen && card && template && syncRewardRevealed(seen, card, template.totalStamps).revealedReward),
    markRewardRevealed,
    sawNewStamps,
  };
};
