-- ============================================================
-- 0004_campaigns_customers_cards.sql
-- Direct ports of public.campaigns, public.customers, and
-- public.issued_cards from supabase/migration.sql, into the
-- loyalty schema. RLS is intentionally NOT enabled.
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.campaigns (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  name text not null,
  is_enabled boolean not null default true,
  description text not null default '',
  reward_name text not null default '',
  tagline text,
  background_image text,
  background_opacity int default 100,
  logo_image text,
  show_logo boolean default true,
  title_size text,
  icon_key text not null default 'Coffee',
  colors jsonb not null,
  total_stamps int not null default 10,
  social jsonb,
  created_at timestamptz not null default now()
);

create index if not exists campaigns_owner_id_idx
  on loyalty.campaigns(owner_id);

create table if not exists loyalty.customers (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  name text not null,
  email text not null,
  mobile text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now()
);

create index if not exists customers_owner_id_idx
  on loyalty.customers(owner_id);

create table if not exists loyalty.issued_cards (
  id text primary key default gen_random_uuid()::text,
  unique_id uuid not null default gen_random_uuid() unique,
  customer_id text not null references loyalty.customers(id) on delete cascade,
  campaign_id text references loyalty.campaigns(id) on delete set null,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  campaign_name text not null,
  stamps int not null default 0,
  last_visit date not null default current_date,
  status text not null default 'Active' check (status in ('Active', 'Redeemed')),
  completed_date date,
  template_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists issued_cards_owner_id_idx
  on loyalty.issued_cards(owner_id);

create index if not exists issued_cards_customer_id_idx
  on loyalty.issued_cards(customer_id);

create index if not exists issued_cards_campaign_id_idx
  on loyalty.issued_cards(campaign_id)
  where campaign_id is not null;
