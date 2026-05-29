-- ============================================================
-- 0002_users_and_tokens.sql
-- Replaces auth.users from Supabase with a plain loyalty.users
-- table, plus the tables backing email verification, password
-- reset, and refresh-token rotation.
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists loyalty.email_verification_tokens (
  token_hash text primary key,
  user_id uuid not null references loyalty.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_tokens_user_id_idx
  on loyalty.email_verification_tokens(user_id);

create table if not exists loyalty.password_reset_tokens (
  token_hash text primary key,
  user_id uuid not null references loyalty.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx
  on loyalty.password_reset_tokens(user_id);

-- Refresh-token rotation: each issuance creates a row; rotation marks the
-- old row revoked and sets its replaced_by to the new id. Compromise of
-- any token in a family revokes the whole family_id.
create table if not exists loyalty.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references loyalty.users(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  user_agent text,
  ip inet,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references loyalty.refresh_tokens(id) on delete set null
);

create index if not exists refresh_tokens_user_id_idx
  on loyalty.refresh_tokens(user_id);

create index if not exists refresh_tokens_family_id_idx
  on loyalty.refresh_tokens(family_id);

-- Keep updated_at fresh on user mutations.
create or replace function loyalty.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists users_touch_updated_at on loyalty.users;
create trigger users_touch_updated_at
  before update on loyalty.users
  for each row execute function loyalty.touch_updated_at();
