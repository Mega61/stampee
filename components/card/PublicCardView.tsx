// Composition of the animated public card. FROZEN after Wave 0: agents
// change their own components (stubs below), not this file. Everything here
// is in the lazy "card-fx" chunk.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { LazyMotion, MotionConfig, domAnimation, useReducedMotion } from 'motion/react';
import { LoyaltyCard } from '../LoyaltyCard';
import { PublicCardShell } from '../PublicCardShell';
import { buildStaffScanEntryUrl } from '../../lib/links';
import { createFxBus } from '../../lib/card/fxBus';
import { useFxTheme } from '../../lib/card/useFxTheme';
import { recolorLottie } from '../../lib/card/lottieRecolor';
import { getAlmostThereSubtitle } from '../../lib/card/subtitle';
import type { CardFxContextValue, NewStampEvent, SlotFxState } from '../../lib/card/types';
import type { CardVariant, GameState, IssuedCard, Template } from '../../types';
import { CardFxContext } from './CardFxContext';
import { PublicStampGrid } from './PublicStampGrid';
import { TiltFront, TiltSurface } from './TiltSurface';
import { MomentsLayer } from './MomentsLayer';
import { InstallPrompt } from './InstallPrompt';
import { WeeklyTicket } from './WeeklyTicket';
import { WalletButtons } from './WalletButtons';

export interface PublicCardViewProps {
  slug: string;
  card: IssuedCard;
  customerName: string;
  template: Template;
  variant: CardVariant;
  trackInteraction: (kind?: string) => void;
  newStampEvents: NewStampEvent[];
  acknowledge: (eventIds: string[]) => void;
  rewardRevealed: boolean;
  markRewardRevealed: () => void;
  game: GameState | null;
  refresh: () => Promise<void>;
  applyCardUpdate: (patch: Partial<IssuedCard>) => void;
}

/** Slots that must start hidden/wrapped until their moment plays. */
const initialSlotStates = (events: NewStampEvent[]) => {
  const states: Record<number, SlotFxState> = {};
  for (const event of events) {
    for (const slot of event.slots) {
      states[slot] = event.kind === 'gift' || event.kind === 'welcome' ? 'wrapped' : 'pending';
    }
  }
  return states;
};

export const PublicCardView: React.FC<PublicCardViewProps> = (props) => {
  const { slug, card, customerName, template } = props;
  const theme = useFxTheme(template);
  const reducedMotion = useReducedMotion() ?? false;
  const bus = useMemo(() => createFxBus(), []);
  const slotEls = useRef(new Map<number, HTMLElement>());

  // Slot states are seeded from the events present at first render and then
  // driven by the moments layer. New events that arrive later (live refresh)
  // are added on top.
  const [slotStates, setSlotStates] = useState(() => initialSlotStates(props.newStampEvents));
  const seededEventIds = useRef(new Set(props.newStampEvents.map((e) => e.id)));
  const lateEvents = props.newStampEvents.filter((e) => !seededEventIds.current.has(e.id));
  if (lateEvents.length > 0) {
    lateEvents.forEach((e) => seededEventIds.current.add(e.id));
    setSlotStates((prev) => ({ ...prev, ...initialSlotStates(lateEvents) }));
  }

  const setSlotState = useCallback((index: number, state: SlotFxState | null) => {
    setSlotStates((prev) => {
      const next = { ...prev };
      if (state) next[index] = state;
      else delete next[index];
      return next;
    });
  }, []);

  const registerSlot = useCallback((index: number, el: HTMLElement | null) => {
    if (el) slotEls.current.set(index, el);
    else slotEls.current.delete(index);
  }, []);

  const getSlotRect = useCallback((index: number) => slotEls.current.get(index)?.getBoundingClientRect() ?? null, []);

  const value: CardFxContextValue = {
    slug,
    card,
    customerName,
    template,
    theme,
    reducedMotion,
    variant: props.variant,
    trackInteraction: props.trackInteraction,
    newStampEvents: props.newStampEvents,
    acknowledge: props.acknowledge,
    rewardRevealed: props.rewardRevealed,
    markRewardRevealed: props.markRewardRevealed,
    slotStates,
    setSlotState,
    registerSlot,
    getSlotRect,
    bus,
    game: props.game,
    refresh: props.refresh,
    applyCardUpdate: props.applyCardUpdate,
  };

  const isRedeemed = card.status === 'Redeemed';
  const subtitle = isRedeemed ? undefined : getAlmostThereSubtitle(card.stamps, template.totalStamps, template.rewardName);
  const transformGiftAnimation = useCallback((data: object) => recolorLottie(data, theme), [theme]);

  return (
    <CardFxContext.Provider value={value}>
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">
          <PublicCardShell
            template={template}
            uniqueId={card.uniqueId}
            isRedeemed={isRedeemed}
            overlay={<MomentsLayer />}
          >
            <TiltSurface className="h-full w-full">
              <LoyaltyCard
                template={template}
                mode="public"
                readOnly={true}
                currentStamps={card.stamps}
                customerName={customerName}
                cardId={card.uniqueId}
                qrValue={buildStaffScanEntryUrl(slug, card.uniqueId)}
                className="h-full w-full"
                history={card.history}
                isRedeemed={isRedeemed}
                rewardRevealMode="external"
                renderStampGrid={(ctx) => <PublicStampGrid ctx={ctx} />}
                wrapFront={(node) => <TiltFront>{node}</TiltFront>}
                subtitle={subtitle}
                transformGiftAnimation={transformGiftAnimation}
                footerSlot={
                  isRedeemed ? null : (
                    <div className="mt-5 flex w-full flex-col items-center gap-3">
                      <WeeklyTicket />
                      <WalletButtons />
                      <InstallPrompt />
                    </div>
                  )
                }
              />
            </TiltSurface>
          </PublicCardShell>
        </MotionConfig>
      </LazyMotion>
    </CardFxContext.Provider>
  );
};

export default PublicCardView;
