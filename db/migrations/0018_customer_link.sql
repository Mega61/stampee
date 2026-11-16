-- ============================================================
-- 0018_customer_link.sql
-- One permanent public link per customer: /:slug/<customers.public_id>.
--
-- Until now the public link was the card's unique_id, so every new card
-- (a win-back campaign, the card after a redeemed one) meant a new link
-- to send. The link now belongs to the customer and never changes; the
-- page shows her current card, and anything that belongs to her (the
-- seasonal calendar, gifts) hangs off the customer, not a campaign.
--
-- Backfill: public_id = the unique_id of the customer's OLDEST card, so
-- the link most clients already have becomes their permanent one and
-- nobody needs a new message. Customers without cards get a fresh uuid.
-- Old card links keep working: the API resolves a card unique_id to its
-- customer and answers with the canonical id.
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.customers add column if not exists public_id uuid;

update loyalty.customers c
   set public_id = (
     select ic.unique_id
       from loyalty.issued_cards ic
      where ic.customer_id = c.id
      order by ic.created_at asc, ic.id asc
      limit 1)
 where c.public_id is null;

update loyalty.customers set public_id = gen_random_uuid() where public_id is null;

alter table loyalty.customers
  alter column public_id set default gen_random_uuid(),
  alter column public_id set not null;

create unique index if not exists customers_public_id_idx on loyalty.customers(public_id);
