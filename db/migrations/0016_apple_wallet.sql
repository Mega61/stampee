-- ============================================================
-- 0016_apple_wallet.sql
-- Apple Wallet passes (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
--
-- wallet_passes gains, for provider 'apple' (object_id = serial
-- number = the card's unique_id):
--   auth_token  per-pass secret Wallet sends back in
--               `Authorization: ApplePass <token>` to the PassKit
--               web service.
--   updated_at  when the pass content last changed. Drives
--               passesUpdatedSince tags and Last-Modified.
--
-- wallet_devices: one row per device per pass, written when Wallet
-- registers for push updates. serial references the card's
-- unique_id so devices go away with the card.
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.wallet_passes
  add column if not exists auth_token text,
  add column if not exists updated_at timestamptz not null default now();

-- The web service looks passes up by serial number.
create unique index if not exists wallet_passes_apple_serial_idx
  on loyalty.wallet_passes(object_id) where provider = 'apple';

create table if not exists loyalty.wallet_devices (
  device_library_id text not null,
  push_token text not null,
  pass_type_id text not null,
  serial uuid not null references loyalty.issued_cards(unique_id) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (device_library_id, pass_type_id, serial)
);
-- onCardChanged: every device registered for one pass.
create index if not exists wallet_devices_pass_idx on loyalty.wallet_devices(pass_type_id, serial);
