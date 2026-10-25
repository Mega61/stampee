-- ============================================================
-- 0011_gift_transactions.sql
-- Win-back gifts: the owner can add stamps to existing cards
-- (e.g. inactive clients with progress) to bring them back.
-- Those stamps get their own transaction type so they are never
-- counted as visits ('stamp_add') in analytics.
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.transactions
  drop constraint if exists transactions_type_check;
alter table loyalty.transactions
  add constraint transactions_type_check
  check (type in ('stamp_add', 'stamp_remove', 'redeem', 'issued', 'gift'));
