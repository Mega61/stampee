import type { ComponentType, SVGProps } from 'react';

export type IconComponent = ComponentType<
  SVGProps<SVGSVGElement> & {
    size?: number | string;
    color?: string;
    strokeWidth?: number | string;
    className?: string;
  }
>;

export interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  muted: string;
  stampActive: string;
  stampInactive: string;
  iconActive: string;
  iconInactive: string;
  button: string;
  buttonText: string;
  border: string;
}

export interface Template {
  id: string;
  name: string;
  isEnabled?: boolean;
  description: string;
  rewardName: string;
  tagline?: string; // Custom instruction text e.g. "Buy 10 get 1 free"
  backgroundImage?: string; // URL for background
  backgroundOpacity?: number; // 0-100
  logoImage?: string; // URL for custom brand logo
  showLogo?: boolean; // Toggle for main logo visibility
  titleSize?: string; // Optional custom font size class for the title
  icon: IconComponent;
  colors: ThemeColors;
  totalStamps: number;
  social?: SocialLinks;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  x?: string;
  youtube?: string;
  website?: string;
}

export type StoredTemplate = Omit<Template, 'icon'> & {
  iconKey: string;
};

export interface Transaction {
  id: string;
  type: 'stamp_add' | 'stamp_remove' | 'redeem' | 'issued';
  amount: number;
  date: string; // Formatted string for display
  timestamp: number; // For sorting
  title: string;
  remarks?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
}

export interface IssuedCard {
  id: string; // Internal ID
  uniqueId: string; // Public UUID for link
  campaignId: string | null;
  campaignName: string;
  stamps: number;
  lastVisit: string;
  status: 'Active' | 'Redeemed'; // New status field
  completedDate?: string; // Date when redeemed
  history: Transaction[]; // Log of all actions
  templateSnapshot?: StoredTemplate; // Campaign design at issue time
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  mobile?: string;
  status: 'Active' | 'Inactive';
  cards: IssuedCard[];
}

// Internal account state. Email confirmation runs through the self-hosted API.
export type AccountStatus = 'unverified' | 'verified';
export type UserRole = 'owner' | 'staff' | 'admin';
export type AccessStatus = 'active' | 'disabled';
// `tier` is dropped in the self-host fork (no monetization). The type alias
// stays for legacy consumers; everyone is treated as fully unlocked.
export type SubscriptionTier = 'free' | 'pro';

// Bearer API key for external/system integrations. The plaintext secret
// (`key`) is only ever present on the create response — see ApiKeyWithSecret.
export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  capabilities: string[];
  status: ApiKeyStatus;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt?: string;
}

export interface ApiKeyWithSecret extends ApiKey {
  /** Full plaintext secret — returned exactly once, on creation. */
  key: string;
}

export interface User {
  id: string;
  businessName: string;
  email: string;
  slug?: string | null;
  role: UserRole;
  ownerId?: string | null;
  status: AccountStatus;
  access: AccessStatus;
  // `tier` is optional and unused — kept here so legacy reads compile.
  tier?: SubscriptionTier;
  tierExpiresAt?: string;
  createdAt: string;
}
