-- ============================================================
-- 0010_campaign_bonus_stamps.sql
-- "Gift" stamps: a campaign can pre-stamp new cards so customers
-- start with progress already on the card (endowed-progress
-- effect). total_stamps stays the number of slots shown on the
-- card; bonus_stamps of them are filled at issue time, so the
-- customer needs total_stamps - bonus_stamps visits.
--
-- Gift stamps are recorded on the 'issued' transaction (amount =
-- bonus_stamps), never as 'stamp_add', so visit analytics stay
-- honest.
-- ============================================================

set search_path = loyalty, public;

alter table loyalty.campaigns
  add column if not exists bonus_stamps int not null default 0;

alter table loyalty.campaigns
  drop constraint if exists campaigns_bonus_stamps_check;
alter table loyalty.campaigns
  add constraint campaigns_bonus_stamps_check
  check (bonus_stamps >= 0 and bonus_stamps < total_stamps);


-- ------------------------------------------------------------
-- RPC: public customer signup — now starts the card at the
-- campaign's bonus_stamps. Otherwise identical to 0006.
-- ------------------------------------------------------------
create or replace function loyalty.register_public_campaign_signup(
  slug_input text,
  campaign_id_input text,
  customer_name_input text,
  customer_email_input text default null,
  customer_mobile_input text default null
)
returns jsonb
language plpgsql
set search_path = loyalty, public
as $$
declare
  owner_row record;
  campaign_row loyalty.campaigns%rowtype;
  customer_row loyalty.customers%rowtype;
  existing_card_row record;
  normalized_name text;
  normalized_email text;
  normalized_mobile text;
  now_ts timestamptz := now();
  new_card_id text;
  new_unique_id uuid;
begin
  normalized_name := trim(coalesce(customer_name_input, ''));
  normalized_email := nullif(lower(trim(coalesce(customer_email_input, ''))), '');
  normalized_mobile := nullif(regexp_replace(coalesce(customer_mobile_input, ''), '[^0-9]+', '', 'g'), '');

  if normalized_name = '' then
    return jsonb_build_object('outcome', 'error', 'error', 'Name is required.');
  end if;

  select id, slug, business_name
  into owner_row
  from loyalty.profiles
  where slug = slug_input and role = 'owner';
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Business not found.');
  end if;

  select *
  into campaign_row
  from loyalty.campaigns
  where id = campaign_id_input
    and owner_id = owner_row.id;
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Campaign not found.');
  end if;

  if normalized_email is not null or normalized_mobile is not null then
    select *
    into customer_row
    from loyalty.customers c
    where c.owner_id = owner_row.id
      and (
        (normalized_email is not null and nullif(lower(trim(c.email)), '') = normalized_email)
        or
        (normalized_mobile is not null and nullif(regexp_replace(coalesce(c.mobile, ''), '[^0-9]+', '', 'g'), '') = normalized_mobile)
      )
    order by c.created_at asc
    limit 1;
  end if;

  if customer_row.id is not null then
    select ic.unique_id
    into existing_card_row
    from loyalty.issued_cards ic
    where ic.owner_id = owner_row.id
      and ic.campaign_id = campaign_row.id
      and ic.customer_id = customer_row.id
      and ic.status = 'Active'
    order by ic.created_at asc
    limit 1;

    if found then
      return jsonb_build_object('outcome', 'redirect_existing', 'uniqueId', existing_card_row.unique_id);
    end if;
  end if;

  if campaign_row.is_enabled = false then
    return jsonb_build_object('outcome', 'campaign_disabled_no_existing');
  end if;

  if customer_row.id is null then
    insert into loyalty.customers (id, owner_id, name, email, mobile, status)
    values (
      gen_random_uuid()::text,
      owner_row.id,
      normalized_name,
      coalesce(normalized_email, ''),
      normalized_mobile,
      'Active'
    )
    returning * into customer_row;
  end if;

  new_card_id := gen_random_uuid()::text;
  new_unique_id := gen_random_uuid();

  insert into loyalty.issued_cards (
    id,
    unique_id,
    customer_id,
    campaign_id,
    owner_id,
    campaign_name,
    stamps,
    last_visit,
    status,
    template_snapshot
  )
  values (
    new_card_id,
    new_unique_id,
    customer_row.id,
    campaign_row.id,
    owner_row.id,
    campaign_row.name,
    campaign_row.bonus_stamps,
    current_date,
    'Active',
    jsonb_build_object(
      'id', campaign_row.id,
      'name', campaign_row.name,
      'description', campaign_row.description,
      'rewardName', campaign_row.reward_name,
      'tagline', campaign_row.tagline,
      'backgroundImage', campaign_row.background_image,
      'backgroundOpacity', campaign_row.background_opacity,
      'logoImage', campaign_row.logo_image,
      'showLogo', campaign_row.show_logo,
      'titleSize', campaign_row.title_size,
      'iconKey', campaign_row.icon_key,
      'colors', campaign_row.colors,
      'totalStamps', campaign_row.total_stamps,
      'bonusStamps', campaign_row.bonus_stamps,
      'social', campaign_row.social
    )
  );

  insert into loyalty.transactions (
    id,
    card_id,
    type,
    amount,
    date,
    "timestamp",
    title,
    remarks
  )
  values (
    gen_random_uuid()::text,
    new_card_id,
    'issued',
    campaign_row.bonus_stamps,
    to_char(now_ts, 'Mon FMDD, YYYY FMHH12:MI AM'),
    floor(extract(epoch from now_ts) * 1000)::bigint,
    'Card Issued',
    case
      when campaign_row.bonus_stamps > 0
        then campaign_row.bonus_stamps || case when campaign_row.bonus_stamps = 1 then ' sello de regalo' else ' sellos de regalo' end
      else null
    end
  );

  return jsonb_build_object('outcome', 'issued', 'uniqueId', new_unique_id);
end;
$$;


-- ------------------------------------------------------------
-- RPC: delete campaign — snapshot now carries bonusStamps.
-- ------------------------------------------------------------
create or replace function loyalty.delete_campaign_preserve_cards(
  campaign_id_input text,
  caller_user_id uuid
)
returns jsonb
language plpgsql
set search_path = loyalty, public
as $$
declare
  campaign_row loyalty.campaigns%rowtype;
  campaign_snapshot jsonb;
begin
  select *
  into campaign_row
  from loyalty.campaigns
  where id = campaign_id_input
    and owner_id = caller_user_id;

  if not found then
    raise exception 'Campaign not found or not owned by current user';
  end if;

  campaign_snapshot := jsonb_build_object(
    'id', campaign_row.id,
    'name', campaign_row.name,
    'description', campaign_row.description,
    'rewardName', campaign_row.reward_name,
    'tagline', campaign_row.tagline,
    'backgroundImage', campaign_row.background_image,
    'backgroundOpacity', campaign_row.background_opacity,
    'logoImage', campaign_row.logo_image,
    'showLogo', campaign_row.show_logo,
    'titleSize', campaign_row.title_size,
    'iconKey', campaign_row.icon_key,
    'colors', campaign_row.colors,
    'totalStamps', campaign_row.total_stamps,
    'bonusStamps', campaign_row.bonus_stamps,
    'social', campaign_row.social
  );

  update loyalty.issued_cards
  set template_snapshot = coalesce(template_snapshot, campaign_snapshot),
      campaign_name = coalesce(nullif(campaign_name, ''), campaign_row.name)
  where campaign_id = campaign_row.id;

  delete from loyalty.campaigns
  where id = campaign_row.id;

  return jsonb_build_object('success', true);
end;
$$;
