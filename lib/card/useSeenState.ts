// OWNER: agent D (data hooks). Wave 0 stub: nothing is ever "new".
import { useCallback, useState } from 'react';
import type { IssuedCard, Template } from '../../types';
import type { NewStampEvent } from './types';

export const useSeenState = (_card: IssuedCard | null, _template: Template | null) => {
  const [rewardRevealed, setRewardRevealed] = useState(false);
  const newStampEvents: NewStampEvent[] = [];
  const acknowledge = useCallback((_ids: string[]) => {}, []);
  const markRewardRevealed = useCallback(() => setRewardRevealed(true), []);
  return { newStampEvents, acknowledge, rewardRevealed, markRewardRevealed, sawNewStamps: false };
};
