// OWNER: agent E (moments). Statically imported by PublicCardView, so it stays
// tiny: it only lazy-loads the director (moments/MomentDirector) once there is
// something to play, and keeps it mounted after that (toasts outlive the
// acknowledge, later live events reuse it).
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useCardFx } from './CardFxContext';

/** Chunk failed to load (offline, stale deploy): show the stamps, don't ack. */
const Fallback: React.FC<{ openedAt: number; initialIds: string[] }> = () => {
  const { newStampEvents, setSlotState } = useCardFx();
  useEffect(() => {
    newStampEvents.forEach((e) => e.slots.forEach((i) => setSlotState(i, null)));
  }, [newStampEvents, setSlotState]);
  return null;
};

const MomentDirector = lazy(() => import('./moments/MomentDirector').catch(() => ({ default: Fallback })));

export const MomentsLayer: React.FC = () => {
  const { newStampEvents } = useCardFx();
  // What the client saw on open: those events play after the grid settles;
  // anything newer arrived live.
  const [opened] = useState(() => ({ at: Date.now(), ids: newStampEvents.map((e) => e.id) }));
  const [load, setLoad] = useState(false);
  if (!load && newStampEvents.length > 0) setLoad(true);
  if (!load) return null;
  return (
    <Suspense fallback={null}>
      <MomentDirector openedAt={opened.at} initialIds={opened.ids} />
    </Suspense>
  );
};
