-- ============================================================
-- 0003_profiles.sql
-- Port of public.profiles from supabase/migration.sql.
-- Changes vs upstream:
--   * id FK now points at loyalty.users (not auth.users)
--   * tier + tier_expires_at columns dropped (no Pro tier)
--   * email + slug are citext (case-insensitive by type)
--   * no RLS — authorization lives in the API
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.profiles (
  id uuid primary key references loyalty.users(id) on delete cascade,
  business_name text not null,
  email citext not null,
  slug citext unique,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  owner_id uuid references loyalty.profiles(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  access text not null default 'active' check (access in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create index if not exists profiles_owner_id_idx
  on loyalty.profiles(owner_id)
  where owner_id is not null;

create index if not exists profiles_slug_owner_idx
  on loyalty.profiles(slug)
  where role = 'owner';
