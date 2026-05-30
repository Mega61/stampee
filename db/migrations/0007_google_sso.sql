-- ============================================================
-- 0007_google_sso.sql
-- Adds support for Google Workspace SSO (passwordless sign-in).
--   * password_hash becomes nullable — Google-provisioned users
--     never set a password and can't use the password login path.
--   * google_sub stores the Google subject (stable account id),
--     uniquely indexed so a Google account maps to one user.
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.users alter column password_hash drop not null;

alter table loyalty.users add column if not exists google_sub text;

create unique index if not exists users_google_sub_key
  on loyalty.users(google_sub);
