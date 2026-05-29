import type { ColumnType, Generated } from 'kysely';

// pg connection has `set search_path = loyalty, public` per connection,
// so unqualified table names resolve into the loyalty schema.

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  email_verified_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProfilesTable {
  id: string;
  business_name: string;
  email: string;
  slug: string | null;
  role: 'owner' | 'staff';
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
  social: Record<string, unknown> | null;
  created_at: Generated<Date>;
}

export interface CustomersTable {
  id: ColumnType<string, string | undefined, string>;
  owner_id: string;
  name: string;
  email: string;
  mobile: string | null;
  status: ColumnType<'Active' | 'Inactive', 'Active' | 'Inactive' | undefined, 'Active' | 'Inactive'>;
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
  type: 'stamp_add' | 'stamp_remove' | 'redeem' | 'issued';
  amount: ColumnType<number, number | undefined, number>;
  date: string;
  timestamp: number;
  title: string;
  remarks: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
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
}
