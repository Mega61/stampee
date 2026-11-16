-- ============================================================
-- 0020_advent.sql
-- Seasonal advent calendar on the back of the card (docs/ADVENT_PLAN.md).
--
-- advent_calendars       one per owner and year; doors unlock on a schedule.
-- advent_doors           what each door gives. The contents are seeded at
--                        deploy time (PUT /advent/calendars/:year) and never
--                        leave the API before the customer opens the door.
-- advent_rewards         one row per (door, customer): the opening and the
--                        gift are the same row ("Mis regalos").
-- advent_double_stamps   one row per visit that got the January double stamp,
--                        so the nightly CRM sync can call it again safely.
--
-- The calendar belongs to the CUSTOMER (0018), not to a card or campaign.
-- 'expired' is never stored: it is derived from valid_to (America/Bogota).
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.advent_calendars (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  year int not null,
  enabled boolean not null default false,
  opens_until timestamptz not null,
  common_terms jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (owner_id, year)
);

create table if not exists loyalty.advent_doors (
  id text primary key default gen_random_uuid()::text,
  calendar_id text not null references loyalty.advent_calendars(id) on delete cascade,
  door_no int not null check (door_no between 1 and 31),
  day_label int not null,
  unlock_at timestamptz not null,
  flash_until timestamptz,
  kind text not null check (kind in ('coupon','bonus_stamps','double_stamps','link','gift_card')),
  title text not null,
  subtitle text not null default '',
  terms jsonb not null default '[]',
  value_cop int,
  stamps int,
  url text,
  valid_from date,
  valid_to date,
  config jsonb not null default '{}',
  unique (calendar_id, door_no)
);

create table if not exists loyalty.advent_rewards (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  door_id text not null references loyalty.advent_doors(id) on delete cascade,
  customer_id text not null references loyalty.customers(id) on delete cascade,
  card_id text references loyalty.issued_cards(id) on delete set null,
  opened_at timestamptz not null default now(),
  code text,
  status text not null default 'available'
    check (status in ('available','redeemed','transferred')),
  valid_from date,
  valid_to date,
  stamps int,
  redeemed_at timestamptz,
  redeemed_by text,
  ticket_ref text,
  external_ref text,
  unique (door_id, customer_id),
  unique (owner_id, code)
);
create index if not exists advent_rewards_customer_idx on loyalty.advent_rewards(customer_id);

create table if not exists loyalty.advent_double_stamps (
  reward_id text not null references loyalty.advent_rewards(id) on delete cascade,
  visit_ref text not null,
  card_id text references loyalty.issued_cards(id) on delete set null,
  visit_date date not null,
  created_at timestamptz not null default now(),
  primary key (reward_id, visit_ref)
);
