import type { ColumnType, Generated } from 'kysely';

// pg connection has `set search_path = loyalty, public` per connection,
// so unqualified table names resolve into the loyalty schema.

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: ColumnType<string | null, string | null | undefined, string | null>;
  google_sub: ColumnType<string | null, string | null | undefined, string | null>;
  email_verified_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProfilesTable {
  id: string;
  business_name: string;
  email: string;
  slug: string | null;
  role: 'owner' | 'staff' | 'admin';
  owner_id: string | null;
  status: 'unverified' | 'verified';
  access: 'active' | 'disabled';
  created_at: Generated<Date>;
}

export interface EmailVerificationTokensTable {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  created_at: Generated<Date>;
}

export interface PasswordResetTokensTable {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Generated<Date>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: string;
  user_agent: string | null;
  ip: string | null;
  issued_at: Generated<Date>;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

export interface CampaignsTable {
  id: ColumnType<string, string | undefined, string>;
  owner_id: string;
  name: string;
  is_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  description: ColumnType<string, string | undefined, string>;
  reward_name: ColumnType<string, string | undefined, string>;
  tagline: string | null;
  background_image: string | null;
  background_opacity: ColumnType<number | null, number | null | undefined, number | null>;
  logo_image: string | null;
  show_logo: ColumnType<boolean | null, boolean | null | undefined, boolean | null>;
  title_size: string | null;
  icon_key: ColumnType<string, string | undefined, string>;
  colors: Record<string, string>;
  total_stamps: ColumnType<number, number | undefined, number>;
  bonus_stamps: ColumnType<number, number | undefined, number>;
  social: Record<string, unknown> | null;
  // 0013_campaign_fx_style.sql
  fx_style: ColumnType<'elegant' | 'playful' | 'minimal', 'elegant' | 'playful' | 'minimal' | undefined, 'elegant' | 'playful' | 'minimal'>;
  // 0015_card_game.sql
  game_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  game_win_pct: ColumnType<number, number | undefined, number>;
  game_monthly_cap: ColumnType<number, number | undefined, number>;
  created_at: Generated<Date>;
}

export interface CustomersTable {
  id: ColumnType<string, string | undefined, string>;
  owner_id: string;
  name: string;
  email: string;
  mobile: string | null;
  status: ColumnType<'Active' | 'Inactive', 'Active' | 'Inactive' | undefined, 'Active' | 'Inactive'>;
  /** Permanent public link id (0018): /:slug/<public_id>. */
  public_id: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface IssuedCardsTable {
  id: ColumnType<string, string | undefined, string>;
  unique_id: ColumnType<string, string | undefined, string>;
  customer_id: string;
  campaign_id: string | null;
  owner_id: string;
  campaign_name: string;
  stamps: ColumnType<number, number | undefined, number>;
  last_visit: ColumnType<string, string | undefined, string>;
  status: ColumnType<'Active' | 'Redeemed', 'Active' | 'Redeemed' | undefined, 'Active' | 'Redeemed'>;
  completed_date: string | null;
  template_snapshot: Record<string, unknown> | null;
  created_at: Generated<Date>;
}

export interface TransactionsTable {
  id: ColumnType<string, string | undefined, string>;
  card_id: string;
  type: 'stamp_add' | 'stamp_remove' | 'redeem' | 'issued' | 'gift' | 'bonus';
  amount: ColumnType<number, number | undefined, number>;
  date: string;
  timestamp: number;
  title: string;
  remarks: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
}

export interface ApiKeysTable {
  id: Generated<string>;
  owner_id: string;
  created_by: string | null;
  name: string;
  key_prefix: string;
  token_hash: string;
  capabilities: ColumnType<string[], string[] | undefined, string[]>;
  last_used_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  expires_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  revoked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
}

// 0012_card_views.sql — one row per card-open session (engagement beacon).
export interface CardViewsTable {
  id: ColumnType<string, string | undefined, string>;
  card_id: string;
  owner_id: string;
  session_id: string;
  source: 'link' | 'pwa' | 'wallet' | 'whatsapp';
  variant: 'fx' | 'holdout';
  started_at: Generated<Date>;
  duration_ms: ColumnType<number, number | undefined, number>;
  interactions: ColumnType<number, number | undefined, number>;
  saw_new_stamps: ColumnType<boolean, boolean | undefined, boolean>;
}

// 0014_wallet_passes.sql
export interface WalletPassesTable {
  card_id: string;
  provider: 'google' | 'apple';
  object_id: string;
  created_at: Generated<Date>;
  last_synced_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  // 0016_apple_wallet.sql — Apple only: PassKit web-service secret and the
  // time the pass content last changed (passesUpdatedSince / Last-Modified).
  auth_token: ColumnType<string | null, string | null | undefined, string | null>;
  updated_at: Generated<Date>;
  // 0017_wallet_extras.sql — what the last sync pushed (change detection),
  // and Apple-only rendering flags / "Novedades" message.
  synced_stamps: ColumnType<number | null, number | null | undefined, number | null>;
  synced_level: ColumnType<ClientLevel | null, ClientLevel | null | undefined, ClientLevel | null>;
  stamps_notify: ColumnType<boolean, boolean | undefined, boolean>;
  news: ColumnType<string | null, string | null | undefined, string | null>;
  news_notify: ColumnType<boolean, boolean | undefined, boolean>;
}

export type ClientLevel = 'bronce' | 'plata' | 'oro';
export type WalletNotificationKind = 'reward_ready' | 'stamp' | 'gift' | 'level_up' | 'weekly_game';

// 0017_wallet_extras.sql — notification log / per-pass daily budget.
export interface WalletNotificationsTable {
  id: Generated<string>;
  card_id: string;
  provider: 'google' | 'apple';
  kind: WalletNotificationKind;
  notified: boolean;
  dedupe_key: string | null;
  message: Record<string, unknown> | null;
  created_at: Generated<Date>;
}

// 0017_wallet_extras.sql — finished scheduler runs (idempotency).
export interface WalletJobRunsTable {
  job: string;
  period_key: string;
  finished_at: Generated<Date>;
  sent: ColumnType<number, number | undefined, number>;
}

// 0017_wallet_extras.sql — pass saved to / removed from a wallet.
export interface WalletPassEventsTable {
  id: Generated<string>;
  card_id: string;
  provider: 'google' | 'apple';
  event: 'save' | 'delete';
  nonce: string | null;
  at: Generated<Date>;
}

// 0016_apple_wallet.sql — devices registered for Apple pass updates.
export interface WalletDevicesTable {
  device_library_id: string;
  push_token: string;
  pass_type_id: string;
  /** The card's unique_id (= the pass serial number). */
  serial: string;
  registered_at: Generated<Date>;
}

// 0015_card_game.sql — one row per card per ISO week (America/Bogota).
export interface CardPlaysTable {
  id: ColumnType<string, string | undefined, string>;
  card_id: string;
  owner_id: string;
  period_key: string;
  played_at: Generated<Date>;
  won: boolean;
  stamps_awarded: ColumnType<number, number | undefined, number>;
}

// 0019_gift_cards.sql — gift cards ("tarjetas regalo").
export type GiftCardStatus = 'pending_payment' | 'active' | 'redeemed' | 'void';
export type GiftCardSource = 'sale' | 'advent' | 'manual';
export type GiftCardEventType =
  | 'created' | 'paid' | 'recipient_set' | 'redeemed' | 'unredeemed' | 'voided' | 'updated' | 'viewed';

export interface GiftCardTiersTable {
  id: ColumnType<string, string | undefined, string>;
  owner_id: string;
  name: string;
  amount_cop: number;
  description: ColumnType<string, string | undefined, string>;
  validity_days: ColumnType<number, number | undefined, number>;
  is_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  sort: ColumnType<number, number | undefined, number>;
  design: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null | undefined, Record<string, unknown> | null>;
  created_at: Generated<Date>;
}

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface GiftCardsTable {
  id: ColumnType<string, string | undefined, string>;
  unique_id: ColumnType<string, string | undefined, string>;
  owner_id: string;
  code: string;
  tier_id: Nullable<string>;
  tier_name: ColumnType<string, string | undefined, string>;
  amount_cop: number;
  status: ColumnType<GiftCardStatus, GiftCardStatus | undefined, GiftCardStatus>;
  funded: boolean;
  source: GiftCardSource;
  buyer_customer_id: Nullable<string>;
  buyer_name: ColumnType<string, string | undefined, string>;
  buyer_phone: ColumnType<string, string | undefined, string>;
  recipient_name: Nullable<string>;
  recipient_phone: Nullable<string>;
  recipient_customer_id: Nullable<string>;
  message: ColumnType<string, string | undefined, string>;
  valid_from: Nullable<string>;
  valid_to: Nullable<string>;
  min_ticket_cop: Nullable<number>;
  transferable: ColumnType<boolean, boolean | undefined, boolean>;
  rules: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  paid_at: Nullable<Date>;
  paid_method: Nullable<string>;
  paid_amount_cop: Nullable<number>;
  paid_ref: Nullable<string>;
  redeemed_at: Nullable<Date>;
  redeemed_ref: Nullable<string>;
  redeemed_amount_cop: Nullable<number>;
  voided_at: Nullable<Date>;
  void_reason: Nullable<string>;
  external_ref: Nullable<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GiftCardEventsTable {
  id: Generated<number>;
  gift_card_id: string;
  type: GiftCardEventType;
  data: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  actor_name: Nullable<string>;
  created_at: Generated<Date>;
}

// ---------------- Advent calendar (0020) ----------------

export type AdventRewardKind = 'coupon' | 'bonus_stamps' | 'double_stamps' | 'link' | 'gift_card';

export interface AdventCalendarsTable {
  id: ColumnType<string, string | undefined, string>;
  owner_id: string;
  year: number;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  opens_until: ColumnType<Date, Date | string, Date | string>;
  common_terms: ColumnType<string[], string | undefined, string>;
  created_at: Generated<Date>;
}

export interface AdventDoorsTable {
  id: ColumnType<string, string | undefined, string>;
  calendar_id: string;
  door_no: number;
  day_label: number;
  unlock_at: ColumnType<Date, Date | string, Date | string>;
  flash_until: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  kind: AdventRewardKind;
  title: string;
  subtitle: ColumnType<string, string | undefined, string>;
  terms: ColumnType<string[], string | undefined, string>;
  value_cop: ColumnType<number | null, number | null | undefined, number | null>;
  stamps: ColumnType<number | null, number | null | undefined, number | null>;
  url: ColumnType<string | null, string | null | undefined, string | null>;
  valid_from: ColumnType<string | null, string | null | undefined, string | null>;
  valid_to: ColumnType<string | null, string | null | undefined, string | null>;
  config: ColumnType<Record<string, unknown>, string | undefined, string>;
}

export interface AdventRewardsTable {
  id: ColumnType<string, string | undefined, string>;
  owner_id: string;
  door_id: string;
  customer_id: string;
  card_id: ColumnType<string | null, string | null | undefined, string | null>;
  opened_at: Generated<Date>;
  code: ColumnType<string | null, string | null | undefined, string | null>;
  status: ColumnType<'available' | 'redeemed' | 'transferred', 'available' | 'redeemed' | 'transferred' | undefined, 'available' | 'redeemed' | 'transferred'>;
  valid_from: ColumnType<string | null, string | null | undefined, string | null>;
  valid_to: ColumnType<string | null, string | null | undefined, string | null>;
  stamps: ColumnType<number | null, number | null | undefined, number | null>;
  redeemed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  redeemed_by: ColumnType<string | null, string | null | undefined, string | null>;
  ticket_ref: ColumnType<string | null, string | null | undefined, string | null>;
  external_ref: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface AdventDoubleStampsTable {
  reward_id: string;
  visit_ref: string;
  card_id: ColumnType<string | null, string | null | undefined, string | null>;
  visit_date: string;
  created_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  profiles: ProfilesTable;
  email_verification_tokens: EmailVerificationTokensTable;
  password_reset_tokens: PasswordResetTokensTable;
  refresh_tokens: RefreshTokensTable;
  campaigns: CampaignsTable;
  customers: CustomersTable;
  issued_cards: IssuedCardsTable;
  transactions: TransactionsTable;
  api_keys: ApiKeysTable;
  card_views: CardViewsTable;
  wallet_passes: WalletPassesTable;
  wallet_devices: WalletDevicesTable;
  card_plays: CardPlaysTable;
  wallet_notifications: WalletNotificationsTable;
  wallet_job_runs: WalletJobRunsTable;
  wallet_pass_events: WalletPassEventsTable;
  gift_card_tiers: GiftCardTiersTable;
  gift_cards: GiftCardsTable;
  gift_card_events: GiftCardEventsTable;
  advent_calendars: AdventCalendarsTable;
  advent_doors: AdventDoorsTable;
  advent_rewards: AdventRewardsTable;
  advent_double_stamps: AdventDoubleStampsTable;
}
