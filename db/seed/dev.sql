-- ============================================================
-- db/seed/dev.sql
-- Development seed for a freshly-migrated database.
--   * One owner: admin@stampee.local / Admin1234 (slug: demo)
--   * One staff: staff@stampee.local / PIN 1234
--   * Two campaigns: 'Coffee Loyalty' (enabled), 'Old Promo' (disabled)
--   * Three customers, plus issued cards in three states.
--
-- Not safe to run twice — `on conflict do nothing` is best-effort
-- and intermediate inserts have new UUIDs. Run only against a
-- fresh DB.
-- ============================================================

set search_path = loyalty, public;

-- ----- Users ------------------------------------------------
-- Bcrypt cost 10 in dev. Production API uses BCRYPT_COST from env.
with new_owner as (
  insert into loyalty.users (id, email, password_hash, email_verified_at)
  values (
    '00000000-0000-0000-0000-000000000001',
    'admin@stampee.local',
    crypt('Admin1234', gen_salt('bf', 10)),
    now()
  )
  returning id
),
new_staff as (
  insert into loyalty.users (id, email, password_hash, email_verified_at)
  values (
    '00000000-0000-0000-0000-000000000002',
    'staff@stampee.local',
    crypt('1234', gen_salt('bf', 10)),
    now()
  )
  returning id
)
select 1;

-- ----- Profiles ---------------------------------------------
insert into loyalty.profiles (id, business_name, email, slug, role, owner_id, status, access)
values (
  '00000000-0000-0000-0000-000000000001',
  'Demo Business',
  'admin@stampee.local',
  'demo',
  'owner',
  null,
  'verified',
  'active'
);

insert into loyalty.profiles (id, business_name, email, slug, role, owner_id, status, access)
values (
  '00000000-0000-0000-0000-000000000002',
  'Demo Staff',
  'staff@stampee.local',
  null,
  'staff',
  '00000000-0000-0000-0000-000000000001',
  'verified',
  'active'
);

-- ----- Campaigns --------------------------------------------
insert into loyalty.campaigns (
  id, owner_id, name, is_enabled, description, reward_name, tagline,
  background_opacity, show_logo, icon_key, colors, total_stamps, social
)
values (
  'campaign-coffee',
  '00000000-0000-0000-0000-000000000001',
  'Coffee Loyalty',
  true,
  'Buy 10 coffees, get the 11th free.',
  'Free Coffee',
  'Stamp & sip.',
  100,
  true,
  'Coffee',
  '{"primary":"#7c5e3c","secondary":"#f5e6d3","text":"#2b1d0e","accent":"#c79b6b"}'::jsonb,
  10,
  null
);

insert into loyalty.campaigns (
  id, owner_id, name, is_enabled, description, reward_name, tagline,
  background_opacity, show_logo, icon_key, colors, total_stamps, social
)
values (
  'campaign-old-promo',
  '00000000-0000-0000-0000-000000000001',
  'Old Promo',
  false,
  'Discontinued seasonal promo.',
  'Free Pastry',
  'No longer running.',
  100,
  true,
  'Gift',
  '{"primary":"#444","secondary":"#eee","text":"#111","accent":"#888"}'::jsonb,
  8,
  null
);

-- ----- Customers --------------------------------------------
insert into loyalty.customers (id, owner_id, name, email, mobile, status) values
  ('customer-alice', '00000000-0000-0000-0000-000000000001', 'Alice Anderson', 'alice@example.com', '+15550000001', 'Active'),
  ('customer-bob',   '00000000-0000-0000-0000-000000000001', 'Bob Brown',      'bob@example.com',   '+15550000002', 'Active'),
  ('customer-carol', '00000000-0000-0000-0000-000000000001', 'Carol Carter',   'carol@example.com', '+15550000003', 'Active');

-- ----- Issued cards (three states) --------------------------
-- Alice: Active, mid-stamp (3/10)
insert into loyalty.issued_cards (
  id, unique_id, customer_id, campaign_id, owner_id, campaign_name,
  stamps, last_visit, status, completed_date, template_snapshot
)
values (
  'card-alice',
  '11111111-1111-1111-1111-111111111111',
  'customer-alice',
  'campaign-coffee',
  '00000000-0000-0000-0000-000000000001',
  'Coffee Loyalty',
  3,
  current_date,
  'Active',
  null,
  null
);

-- Bob: Active, fully stamped but not redeemed yet (10/10)
insert into loyalty.issued_cards (
  id, unique_id, customer_id, campaign_id, owner_id, campaign_name,
  stamps, last_visit, status, completed_date, template_snapshot
)
values (
  'card-bob',
  '22222222-2222-2222-2222-222222222222',
  'customer-bob',
  'campaign-coffee',
  '00000000-0000-0000-0000-000000000001',
  'Coffee Loyalty',
  10,
  current_date,
  'Active',
  current_date,
  null
);

-- Carol: Redeemed already
insert into loyalty.issued_cards (
  id, unique_id, customer_id, campaign_id, owner_id, campaign_name,
  stamps, last_visit, status, completed_date, template_snapshot
)
values (
  'card-carol',
  '33333333-3333-3333-3333-333333333333',
  'customer-carol',
  'campaign-coffee',
  '00000000-0000-0000-0000-000000000001',
  'Coffee Loyalty',
  10,
  current_date - interval '1 day',
  'Redeemed',
  current_date - interval '1 day',
  null
);

-- ----- Transactions (just enough to drive the UI) -----------
insert into loyalty.transactions (id, card_id, type, amount, date, "timestamp", title) values
  ('tx-alice-1', 'card-alice', 'issued',    0, to_char(now() - interval '7 days',  'Mon FMDD, YYYY FMHH12:MI AM'), floor(extract(epoch from now() - interval '7 days') * 1000)::bigint, 'Card Issued'),
  ('tx-alice-2', 'card-alice', 'stamp_add', 1, to_char(now() - interval '5 days',  'Mon FMDD, YYYY FMHH12:MI AM'), floor(extract(epoch from now() - interval '5 days') * 1000)::bigint, 'Stamp added'),
  ('tx-alice-3', 'card-alice', 'stamp_add', 1, to_char(now() - interval '3 days',  'Mon FMDD, YYYY FMHH12:MI AM'), floor(extract(epoch from now() - interval '3 days') * 1000)::bigint, 'Stamp added'),
  ('tx-alice-4', 'card-alice', 'stamp_add', 1, to_char(now() - interval '1 day',   'Mon FMDD, YYYY FMHH12:MI AM'), floor(extract(epoch from now() - interval '1 day')  * 1000)::bigint, 'Stamp added'),
  ('tx-bob-1',   'card-bob',   'issued',    0, to_char(now() - interval '14 days', 'Mon FMDD, YYYY FMHH12:MI AM'), floor(extract(epoch from now() - interval '14 days') * 1000)::bigint, 'Card Issued'),
  ('tx-carol-1', 'card-carol', 'issued',    0, to_char(now() - interval '30 days', 'Mon FMDD, YYYY FMHH12:MI AM'), floor(extract(epoch from now() - interval '30 days') * 1000)::bigint, 'Card Issued'),
  ('tx-carol-2', 'card-carol', 'redeem',    0, to_char(now() - interval '1 day',   'Mon FMDD, YYYY FMHH12:MI AM'), floor(extract(epoch from now() - interval '1 day')   * 1000)::bigint, 'Reward redeemed');
