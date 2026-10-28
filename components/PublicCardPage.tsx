// Public loyalty card route (/:slug/:uniqueId). Data + experiment arm live
// here; the animated card is a lazy chunk (components/card/PublicCardView).
// OWNER after Wave 0: agent D (data hooks).
import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { LoyaltyCard } from './LoyaltyCard';
import { PublicCardShell } from './PublicCardShell';
import { buildStaffScanEntryUrl } from '../lib/links';
import { isFxHoldout } from '../lib/card/holdout';
import { usePublicCard } from '../lib/card/usePublicCard';
import { useSeenState } from '../lib/card/useSeenState';
import { useEngagementBeacon } from '../lib/card/useEngagementBeacon';
import type { CardVariant } from '../types';

const PublicCardView = lazy(() => import('./card/PublicCardView'));

const fxDisabled = () => import.meta.env.VITE_CARD_FX === 'off';

const Spinner = () => (
  <div className="h-screen flex items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export const PublicCardPage: React.FC = () => {
  const { slug, uniqueId } = useParams<{ slug: string; uniqueId: string }>();
  const { loading, data, refresh, applyCardUpdate } = usePublicCard(slug, uniqueId);
  // The experiment arm comes from the card id only. The kill switch also
  // renders the classic card, but those views must not be counted as
  // holdout, so the beacon is off while it's active.
  const killSwitch = fxDisabled();
  const variant: CardVariant = useMemo(
    () => (killSwitch || (uniqueId && isFxHoldout(uniqueId)) ? 'holdout' : 'fx'),
    [killSwitch, uniqueId],
  );
  // Holdout arm: classic card, no "since your last visit" moments — but it
  // still reports views (variant 'holdout') so the experiment can compare.
  const seen = useSeenState(variant === 'fx' ? data?.card ?? null : null, data?.template ?? null);
  const { trackInteraction, sessionId } = useEngagementBeacon({
    slug,
    uniqueId,
    variant,
    sawNewStamps: seen.sawNewStamps,
    enabled: !!data && !killSwitch,
  });

  // DEV-only handle for integration checks (stripped from production builds).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __stampeeCard?: unknown }).__stampeeCard = {
      variant,
      sessionId,
      card: data?.card ?? null,
      events: seen.newStampEvents,
      sawNewStamps: seen.sawNewStamps,
      acknowledge: seen.acknowledge,
      refresh,
    };
  }, [variant, sessionId, data, seen.newStampEvents, seen.sawNewStamps, seen.acknowledge, refresh]);

  if (loading && !data) return <Spinner />;

  if (!data || !slug) {
    return (
      <div className="h-screen flex items-center justify-center px-6 text-center text-muted-foreground">
        Tarjeta no encontrada.
      </div>
    );
  }

  const { card, customer, template } = data;

  if (variant === 'holdout') {
    return (
      <PublicCardShell template={template} uniqueId={card.uniqueId} isRedeemed={card.status === 'Redeemed'}>
        <LoyaltyCard
          template={template}
          mode="public"
          readOnly={true}
          currentStamps={card.stamps}
          customerName={customer.name}
          cardId={card.uniqueId}
          qrValue={buildStaffScanEntryUrl(slug, card.uniqueId)}
          className="h-full w-full"
          history={card.history}
          isRedeemed={card.status === 'Redeemed'}
        />
      </PublicCardShell>
    );
  }

  return (
    <Suspense fallback={<Spinner />}>
      <PublicCardView
        slug={slug}
        card={card}
        customerName={customer.name}
        template={template}
        variant={variant}
        trackInteraction={trackInteraction}
        newStampEvents={seen.newStampEvents}
        acknowledge={seen.acknowledge}
        rewardRevealed={seen.rewardRevealed}
        markRewardRevealed={seen.markRewardRevealed}
        game={data.game}
        refresh={refresh}
        applyCardUpdate={applyCardUpdate}
      />
    </Suspense>
  );
};

export default PublicCardPage;
