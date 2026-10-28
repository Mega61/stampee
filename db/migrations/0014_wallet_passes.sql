-- ============================================================
-- 0014_wallet_passes.sql
-- Digital wallet passes (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
-- One row per card per provider, written when the client first
-- asks for a "save to wallet" link. onCardChanged() only syncs
-- cards that have a row here.
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.wallet_passes (
  card_id text not null references loyalty.issued_cards(id) on delete cascade,
  provider text not null check (provider in ('google','apple')),
  object_id text not null,           -- provider-side id (Google: issuer.object)
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  primary key (card_id, provider)
);
