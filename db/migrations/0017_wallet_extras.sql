-- ============================================================
-- 0017_wallet_extras.sql
-- Wallet pass upgrades: notifications, weekly scheduler, save /
-- delete events (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
--
-- wallet_passes gains what the last sync pushed, so the next one
-- can tell what changed (stamp up, card complete, level up):
--   synced_stamps / synced_level  last values sent to the pass.
--   stamps_notify  Apple only: whether the rendered pass carries the
--                  stamps field's changeMessage (game bonus = silent).
--   news / news_notify  Apple only: the "Novedades" field, our
--                  stand-in for Google's addMessage.
--
-- wallet_notifications: one row per notification decision, per pass.
-- `notified` rows in the last 24 h are the budget (Google allows 3
-- notifying updates/messages per pass per day). dedupe_key makes a
-- notification idempotent (weekly game: 'weekly_game:2026-W44').
--
-- wallet_job_runs: in-process scheduler bookkeeping, one row per job
-- per period once that period's run has finished.
--
-- wallet_pass_events: the client saved / removed a pass (Google
-- callbacks, Apple device register / unregister).
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.wallet_passes
  add column if not exists synced_stamps int,
  add column if not exists synced_level text check (synced_level in ('bronce','plata','oro')),
  add column if not exists stamps_notify boolean not null default true,
  add column if not exists news text,
  add column if not exists news_notify boolean not null default false;

create table if not exists loyalty.wallet_notifications (
  id bigserial primary key,
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  provider text not null check (provider in ('google','apple')),
  kind text not null check (kind in ('reward_ready','stamp','gift','level_up','weekly_game')),
  notified boolean not null,
  dedupe_key text,
  -- Google message we sent (id/header/body), so old ones can be pruned.
  message jsonb,
  created_at timestamptz not null default now(),
  unique (card_id, provider, dedupe_key)
);
create index if not exists wallet_notifications_budget_idx
  on loyalty.wallet_notifications(card_id, provider, created_at);

create table if not exists loyalty.wallet_job_runs (
  job text not null,
  period_key text not null,
  finished_at timestamptz not null default now(),
  sent int not null default 0,
  primary key (job, period_key)
);

create table if not exists loyalty.wallet_pass_events (
  id bigserial primary key,
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  provider text not null check (provider in ('google','apple')),
  event text not null check (event in ('save','delete')),
  -- Google callback nonce: duplicate deliveries are dropped.
  nonce text,
  at timestamptz not null default now(),
  unique (provider, nonce)
);
create index if not exists wallet_pass_events_card_idx on loyalty.wallet_pass_events(card_id, provider, at);

-- Google callbacks look passes up by object id.
create index if not exists wallet_passes_object_idx on loyalty.wallet_passes(provider, object_id);
