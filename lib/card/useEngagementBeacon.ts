// OWNER: agent D (data hooks). Wave 0 stub: no-op.
import { useCallback } from 'react';
import type { CardVariant } from '../../types';

export const useEngagementBeacon = (_opts: {
  slug: string | undefined;
  uniqueId: string | undefined;
  variant: CardVariant;
  sawNewStamps: boolean;
  enabled: boolean;
}) => {
  const trackInteraction = useCallback((_kind?: string) => {}, []);
  return { trackInteraction };
};
