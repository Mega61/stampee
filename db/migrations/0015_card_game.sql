-- ============================================================
-- 0015_card_game.sql
-- Weekly scratch game "Raspa y gana" (docs/CARD_ENGAGEMENT_PLAN.md §8).
-- Settings live on the campaign (read live, so turning the game off
-- stops every existing card). One play per card per ISO week in
-- America/Bogota, enforced by the unique key. Wins are recorded as
-- their own transaction type ('bonus') so neither visit analytics
-- ('stamp_add') nor win-back analytics ('gift') are polluted.
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.campaigns
  add column if not exists game_enabled boolean not null default false,
  add column if not exists game_win_pct int not null default 15 check (game_win_pct between 0 and 100),
  add column if not exists game_monthly_cap int not null default 30 check (game_monthly_cap >= 0);

create table if not exists loyalty.card_plays (
  id text primary key default gen_random_uuid()::text,
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  period_key text not null,              -- e.g. '2026-W44' (America/Bogota)
  played_at timestamptz not null default now(),
  won boolean not null,
  stamps_awarded int not null default 0,
  unique (card_id, period_key)
);
create index if not exists card_plays_owner_played_idx on loyalty.card_plays(owner_id, played_at);

alter table loyalty.transactions drop constraint if exists transactions_type_check;
alter table loyalty.transactions add constraint transactions_type_check
  check (type in ('stamp_add','stamp_remove','redeem','issued','gift','bonus'));
