-- ============================================================
-- 0005_transactions.sql
-- Direct port of public.transactions. Column types unchanged —
-- including `timestamp bigint` (epoch millis) and `date text`
-- (display string formatted by register_public_campaign_signup),
-- because the existing UI depends on both.
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.transactions (
  id text primary key default gen_random_uuid()::text,
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  type text not null check (type in ('stamp_add', 'stamp_remove', 'redeem', 'issued')),
  amount int not null default 0,
  date text not null,
  "timestamp" bigint not null,
  title text not null,
  remarks text,
  actor_id uuid,
  actor_name text,
  actor_role text
);

create index if not exists transactions_card_id_idx
  on loyalty.transactions(card_id);

create index if not exists transactions_timestamp_idx
  on loyalty.transactions("timestamp");
