-- ============================================================
-- 0008_admin_role.sql
-- Adds the business-scoped `admin` co-owner role.
--   * An admin shares the primary owner's data scope
--     (profiles.owner_id = <primary owner>, slug null).
--   * Authorization lives in the API; this migration only
--     widens the role check constraint to permit 'admin'.
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.profiles drop constraint if exists profiles_role_check;

alter table loyalty.profiles
  add constraint profiles_role_check check (role in ('owner', 'staff', 'admin'));
