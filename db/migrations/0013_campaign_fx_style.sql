-- ============================================================
-- 0013_campaign_fx_style.sql
-- Animation energy of the customer-facing card ("card fx"), per
-- campaign. Read by the public card from the LIVE campaign (not
-- the issue-time snapshot), so owners can change it for cards
-- already issued. See docs/CARD_ENGAGEMENT_PLAN.md §5.0.
--   elegant  soft shine, subtle particles (default)
--   playful  bouncier, confetti, more energy
--   minimal  no tilt/particles; best for busy background photos
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.campaigns
  add column if not exists fx_style text not null default 'elegant';

alter table loyalty.campaigns
  drop constraint if exists campaigns_fx_style_check;
alter table loyalty.campaigns
  add constraint campaigns_fx_style_check
  check (fx_style in ('elegant', 'playful', 'minimal'));
