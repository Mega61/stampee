import { useMemo } from 'react';
import { Customer, Template, SubscriptionTier } from '../types';
import { useAuth } from '../components/AuthProvider';

interface SubscriptionInfo {
  tier: SubscriptionTier;
  isProTier: boolean;
  campaignCount: number;
  issuedCardCount: number;
  staffCount: number;
  campaignLimit: number;
  cardLimit: number;
  staffLimit: number;
  canCreateCampaign: boolean;
  canIssueCard: boolean;
  canCreateStaff: boolean;
}

// Self-host fork: there's no Pro tier and nothing gated. This shim keeps the
// hook export stable so existing consumers don't have to change.
export function useSubscription(campaigns: Template[], customers: Customer[]): SubscriptionInfo {
  const { staffAccounts } = useAuth();

  return useMemo(() => ({
    tier: 'free' as SubscriptionTier,
    isProTier: true,
    campaignCount: campaigns.length,
    issuedCardCount: customers.reduce((sum, c) => sum + c.cards.length, 0),
    staffCount: staffAccounts.length,
    campaignLimit: Infinity,
    cardLimit: Infinity,
    staffLimit: Infinity,
    canCreateCampaign: true,
    canIssueCard: true,
    canCreateStaff: true,
  }), [campaigns, customers, staffAccounts]);
}
