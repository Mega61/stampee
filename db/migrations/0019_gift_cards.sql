-- ============================================================
-- 0019_gift_cards.sql
-- Gift cards ("tarjetas regalo"): fixed-amount cards sold by the
-- studio (or issued as promotions), delivered as a public link and
-- redeemed in one visit.
--
-- gift_card_tiers  the amounts on sale (Detalle, Consentida, …).
-- gift_cards       one row per card. 'expired' is never stored: it
--                  is derived (status = 'active' and valid_to before
--                  today in America/Bogota).
-- gift_card_events audit trail + stats (views, payments, redemptions).
--
-- Codes look like TR-XXXX-XXXX (Crockford base32 without I/L/O/U)
-- and are unique per owner. external_ref makes issuing idempotent
-- for integrations (e.g. a promotion that issues one card per client).
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.gift_card_tiers (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  name text not null,
  amount_cop int not null check (amount_cop > 0),
  description text not null default '',
  validity_days int not null default 365 check (validity_days > 0),
  is_enabled boolean not null default true,
  sort int not null default 0,
  design jsonb,
  created_at timestamptz not null default now()
);
create index if not exists gift_card_tiers_owner_idx on loyalty.gift_card_tiers(owner_id, sort);

create table if not exists loyalty.gift_cards (
  id text primary key default gen_random_uuid()::text,
  unique_id uuid not null default gen_random_uuid() unique,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  code citext not null,
  tier_id text references loyalty.gift_card_tiers(id) on delete set null,
  tier_name text not null default '',
  amount_cop int not null check (amount_cop > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'redeemed', 'void')),
  funded boolean not null,
  source text not null check (source in ('sale', 'advent', 'manual')),
  buyer_customer_id text references loyalty.customers(id) on delete set null,
  buyer_name text not null default '',
  buyer_phone text not null default '',
  recipient_name text,
  recipient_phone text,
  recipient_customer_id text references loyalty.customers(id) on delete set null,
  message text not null default '',
  valid_from date,
  valid_to date,
  min_ticket_cop int check (min_ticket_cop is null or min_ticket_cop >= 0),
  transferable boolean not null default true,
  rules jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  paid_method text,
  paid_amount_cop int,
  paid_ref text,
  redeemed_at timestamptz,
  redeemed_ref text,
  redeemed_amount_cop int,
  voided_at timestamptz,
  void_reason text,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, code),
  unique (owner_id, external_ref)
);
create index if not exists gift_cards_owner_status_idx on loyalty.gift_cards(owner_id, status, created_at desc);
create index if not exists gift_cards_buyer_idx on loyalty.gift_cards(buyer_customer_id) where buyer_customer_id is not null;
create index if not exists gift_cards_recipient_idx on loyalty.gift_cards(recipient_customer_id) where recipient_customer_id is not null;

drop trigger if exists gift_cards_touch_updated_at on loyalty.gift_cards;
create trigger gift_cards_touch_updated_at
  before update on loyalty.gift_cards
  for each row execute function loyalty.touch_updated_at();

create table if not exists loyalty.gift_card_events (
  id bigserial primary key,
  gift_card_id text not null references loyalty.gift_cards(id) on delete cascade,
  type text not null check (type in ('created', 'paid', 'recipient_set', 'redeemed', 'unredeemed', 'voided', 'updated', 'viewed')),
  data jsonb not null default '{}'::jsonb,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists gift_card_events_card_idx on loyalty.gift_card_events(gift_card_id, created_at);
