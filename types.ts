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
  // Stamps pre-filled on every newly issued card ("gift" stamps). The customer
  // still sees `totalStamps` slots but only needs totalStamps - bonusStamps visits.
  bonusStamps?: number;
  social?: SocialLinks;
  // Animation energy on the customer-facing card. Read from the live campaign
  // (falls back to the snapshot) so owners can change it for issued cards.
  fxStyle?: FxStyle;
  // Weekly scratch game ("Raspa y gana"). Live-campaign settings, see
  // docs/CARD_ENGAGEMENT_PLAN.md §8.
  gameEnabled?: boolean;
  gameWinPct?: number;
  gameMonthlyCap?: number;
}

export type FxStyle = 'elegant' | 'playful' | 'minimal';

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  x?: string;
  youtube?: string;
  website?: string;
  // Business contact. WhatsApp shows as a social icon on the card ("book by
  // WhatsApp"); all four also go to the wallet passes (links + hours).
  /** WhatsApp number, e.g. "+57 301 464 8943" (10-digit Colombian numbers get +57). */
  whatsapp?: string;
  /** Phone for "Llamar" on the wallet passes (falls back to the WhatsApp number). */
  phone?: string;
  /** Google Maps link for "Cómo llegar". */
  mapsUrl?: string;
  /** Opening hours, free text. */
  hours?: string;
}

export type StoredTemplate = Omit<Template, 'icon'> & {
  iconKey: string;
};

export interface Transaction {
  id: string;
  // 'gift'  = win-back stamps from the owner (never a visit).
  // 'bonus' = stamps won in the weekly scratch game (never a visit).
  type: 'stamp_add' | 'stamp_remove' | 'redeem' | 'issued' | 'gift' | 'bonus';
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
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Customer card engagement (docs/CARD_ENGAGEMENT_PLAN.md)
// ---------------------------------------------------------------------------

/** Where a card-open session came from. */
export type CardViewSource = 'link' | 'pwa' | 'wallet' | 'whatsapp';

/** A/B arm: 'holdout' cards keep the classic card for the experiment window. */
export type CardVariant = 'fx' | 'holdout';

/** Body of POST /public/cards/:slug/:uniqueId/views (sent as JSON or text/plain). */
export interface CardViewEvent {
  sessionId: string;
  source: CardViewSource;
  variant: CardVariant;
  durationMs: number;
  interactions: number;
  sawNewStamps: boolean;
}

export type GameStateKind = 'available' | 'played' | 'locked' | 'disabled' | 'holdout';

/** GET /public/cards/:slug/:uniqueId/game, also embedded as `game` in the public card response. */
export interface GameState {
  state: GameStateKind;
  /** ISO timestamp of the next Monday 00:00 America/Bogota. */
  nextPlayAt: string;
  /** Only for 'locked': why the card can't play. */
  reason?: 'NO_RECENT_VISIT' | 'NOT_ACTIVE';
  /** Only for 'played': this week's result. */
  lastResult?: { won: boolean; stampsAwarded: number; playedAt: string };
}

/** POST /public/cards/:slug/:uniqueId/game/play */
export interface PlayResult {
  won: boolean;
  stampsAwarded: number;
  /** Card stamps after the play. */
  stamps: number;
  nextPlayAt: string;
  periodKey: string;
  /** On a win: the bonus transaction it created (also on idempotent replays). */
  transaction?: Transaction;
}
