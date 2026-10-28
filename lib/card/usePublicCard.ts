// OWNER: agent D (data hooks). Wave 0 stub: fetch once, manual refresh.
import { useCallback, useEffect, useState } from 'react';
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

export const usePublicCard = (slug: string | undefined, uniqueId: string | undefined) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PublicCardData | null>(null);

  const load = useCallback(async () => {
    if (!slug || !uniqueId) return;
    try {
      const res = await api.get<PublicCardResponse>(`/public/cards/${slug}/${uniqueId}`);
      setData(toPublicCardData(res));
    } catch {
      // surfaced as "Card not found" by the page when nothing ever loaded
    }
  }, [slug, uniqueId]);

  useEffect(() => {
    if (!slug || !uniqueId) { setLoading(false); return; }
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load, slug, uniqueId]);

  const applyCardUpdate = useCallback((patch: Partial<IssuedCard>) => {
    setData((prev) => (prev ? { ...prev, card: { ...prev.card, ...patch } } : prev));
  }, []);

  return { loading, data, refresh: load, applyCardUpdate };
};
