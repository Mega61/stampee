-- ============================================================
-- 0009_api_keys.sql
-- Bearer API keys for external/system integrations.
--   * Owner-scoped: a key authenticates as the owner's data scope.
--   * Secret stored hashed (sha256); plaintext shown once on create.
--   * Soft revocation via revoked_at; optional expiry.
-- ============================================================

set search_path = loyalty, public;

create table if not exists loyalty.api_keys (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references loyalty.profiles(id) on delete cascade,
  created_by   uuid references loyalty.profiles(id) on delete set null,
  name         text not null,
  key_prefix   text not null,                 -- e.g. 'stmp_a1b2c3d4' (display only)
  token_hash   text not null unique,          -- sha256 of the full key
  capabilities text[] not null default '{read,write}',
  last_used_at timestamptz,
  expires_at   timestamptz,                    -- null = no expiry
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists api_keys_owner_id_idx on loyalty.api_keys(owner_id);
create index if not exists api_keys_token_hash_idx on loyalty.api_keys(token_hash);
