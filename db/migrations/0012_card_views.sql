-- ============================================================
-- 0012_card_views.sql
-- Engagement beacon: one row per public-card open session
-- (docs/CARD_ENGAGEMENT_PLAN.md §4.1). The client sends a start
-- ping and a final ping for the same session_id; the API upserts
-- on (card_id, session_id) keeping the max duration/interactions.
-- No PII: card_id comes from the URL, session_id is random.
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.card_views (
  id text primary key default gen_random_uuid()::text,
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  owner_id uuid not null references loyalty.profiles(id) on delete cascade,
  session_id text not null,          -- random per page load, client-generated
  source text not null default 'link' check (source in ('link','pwa','wallet','whatsapp')),
  started_at timestamptz not null default now(),
  duration_ms int not null default 0,
  interactions int not null default 0,  -- stamp taps, tilts, reveals
  saw_new_stamps boolean not null default false,
  -- Experiment arm the client rendered (fx = new card effects, holdout = classic card).
  variant text not null default 'fx' check (variant in ('fx','holdout')),
  unique (card_id, session_id)
);

create index if not exists card_views_owner_started_idx
  on loyalty.card_views(owner_id, started_at);

create index if not exists card_views_card_idx
  on loyalty.card_views(card_id);
