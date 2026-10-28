// OWNER: agent H. Mount point for the scratch experiences, rendered under the
// reward line. Kept tiny (it's in the PublicCardView chunk): the weekly game
// ticket and the reward scratch reveal are separate lazy chunks, loaded only
// when there is something to show.
import React, { Suspense, lazy, useState } from 'react';
import { useCardFx } from './CardFxContext';

// A chunk that fails to load (offline, stale deploy) renders nothing.
const NONE: { default: React.ComponentType<{ onClose?: () => void }> } = { default: () => null };
const TicketExperience = lazy(() => import('./game/TicketExperience').catch(() => NONE));
const RewardReveal = lazy(() => import('./reward/RewardReveal').catch(() => NONE));

const PLAYABLE = new Set(['available', 'played', 'locked']);

export const WeeklyTicket: React.FC = () => {
  const { game, card, template, rewardRevealed, newStampEvents } = useCardFx();
  const complete = card.stamps >= template.totalStamps;
  // §6.4: once the last stamp has landed and the reward hasn't been revealed.
  const wantsReveal = complete && card.status === 'Active' && !rewardRevealed && newStampEvents.length === 0;
  // Latched so the overlay can finish after markRewardRevealed().
  const [revealing, setRevealing] = useState(false);
  if (wantsReveal && !revealing) setRevealing(true);

  return (
    <Suspense fallback={null}>
      {game && !complete && PLAYABLE.has(game.state) && <TicketExperience />}
      {revealing && <RewardReveal onClose={() => setRevealing(false)} />}
    </Suspense>
  );
};
