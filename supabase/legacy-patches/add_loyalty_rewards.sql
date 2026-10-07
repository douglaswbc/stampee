-- Phase 3: a stock-safe reward catalog with customer claims and audited codes.
-- Apply after supabase/legacy-patches/add_loyalty_points.sql.

create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id text references public.campaigns(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null check (length(trim(description)) between 1 and 300),
  points_cost integer not null default 0 check (points_cost between 0 and 1000000),
  minimum_points integer not null default 0 check (minimum_points between 0 and 100000000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  stock_quantity integer check (stock_quantity is null or stock_quantity between 0 and 1000000),
  max_claims_per_customer integer not null default 1 check (max_claims_per_customer between 1 and 100),
  redemption_validity_hours integer not null default 168 check (redemption_validity_hours between 1 and 720),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_rewards_valid_period check (ends_at > starts_at)
);

create index if not exists loyalty_rewards_owner_active_dates_idx
  on public.loyalty_rewards(owner_id, is_active, starts_at, ends_at);
create index if not exists loyalty_rewards_campaign_idx
  on public.loyalty_rewards(campaign_id) where campaign_id is not null;
alter table public.loyalty_rewards enable row level security;
revoke all on public.loyalty_rewards from public, anon, authenticated;

create table if not exists public.loyalty_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  reward_id uuid not null references public.loyalty_rewards(id) on delete restrict,
  customer_id text not null references public.customers(id) on delete cascade,
  card_id text references public.issued_cards(id) on delete set null,
  reward_name text not null,
  reward_description text not null,
  points_cost integer not null check (points_cost between 0 and 1000000),
  redemption_code text not null,
  idempotency_key text not null,
  status text not null default 'issued' check (status in ('issued', 'redeemed', 'expired', 'cancelled')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(id) on delete set null,
  expired_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancellation_reason text,
  unique (owner_id, redemption_code),
  unique (owner_id, idempotency_key),
  constraint loyalty_reward_redemption_times check (expires_at > issued_at),
  constraint loyalty_reward_redemption_status_times check (
    (status <> 'redeemed' or (redeemed_at is not null and redeemed_by is not null))
    and (status <> 'expired' or expired_at is not null)
    and (status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null and cancellation_reason is not null))
  )
);

create index if not exists loyalty_reward_redemptions_customer_idx
  on public.loyalty_reward_redemptions(owner_id, customer_id, issued_at desc);
create index if not exists loyalty_reward_redemptions_status_expiry_idx
  on public.loyalty_reward_redemptions(owner_id, status, expires_at);
create index if not exists loyalty_reward_redemptions_reward_status_customer_idx
  on public.loyalty_reward_redemptions(reward_id, status, customer_id);
create index if not exists loyalty_reward_redemptions_owner_issued_idx
  on public.loyalty_reward_redemptions(owner_id, issued_at desc);
alter table public.loyalty_reward_redemptions enable row level security;
revoke all on public.loyalty_reward_redemptions from public, anon, authenticated;

create table if not exists public.loyalty_reward_redemption_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  redemption_id uuid not null references public.loyalty_reward_redemptions(id) on delete cascade,
  event_type text not null check (event_type in ('issued', 'redeemed', 'expired', 'cancelled')),
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (redemption_id, event_type)
);

create index if not exists loyalty_reward_redemption_events_owner_created_idx
  on public.loyalty_reward_redemption_events(owner_id, created_at desc);
alter table public.loyalty_reward_redemption_events enable row level security;
revoke all on public.loyalty_reward_redemption_events from public, anon, authenticated;

alter table public.customer_loyalty_points_ledger
  add column if not exists reward_redemption_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_loyalty_points_ledger'::regclass
      and conname = 'customer_loyalty_points_reward_redemption_fk'
  ) then
    alter table public.customer_loyalty_points_ledger
      add constraint customer_loyalty_points_reward_redemption_fk
      foreign key (reward_redemption_id)
      references public.loyalty_reward_redemptions(id) on delete cascade;
  end if;
end;
$$;

alter table public.customer_loyalty_points_ledger
  drop constraint if exists customer_loyalty_points_ledger_entry_type_check;
alter table public.customer_loyalty_points_ledger
  drop constraint if exists loyalty_points_entry_type_check;
alter table public.customer_loyalty_points_ledger
  add constraint loyalty_points_entry_type_check
  check (entry_type in ('visit', 'visit_reversal', 'manual_adjustment', 'reward_redemption', 'reward_refund'));

alter table public.customer_loyalty_points_ledger
  drop constraint if exists customer_loyalty_points_ledger_points_delta_check;
alter table public.customer_loyalty_points_ledger
  drop constraint if exists loyalty_points_delta_range;
alter table public.customer_loyalty_points_ledger
  add constraint loyalty_points_delta_range check (
    points_delta between -1000000 and 1000000
    and (points_delta <> 0 or entry_type = 'visit_reversal')
  );

alter table public.customer_loyalty_points_ledger
  drop constraint if exists loyalty_points_entry_shape;
alter table public.customer_loyalty_points_ledger
  add constraint loyalty_points_entry_shape check (
    (entry_type = 'visit' and points_delta > 0 and source_transaction_id is not null and reverses_entry_id is null and reward_redemption_id is null)
    or (entry_type = 'visit_reversal' and points_delta <= 0 and source_transaction_id is not null and reverses_entry_id is not null and reward_redemption_id is null)
    or (entry_type = 'manual_adjustment' and points_delta <> 0 and source_transaction_id is null and reverses_entry_id is null and reward_redemption_id is null)
    or (entry_type = 'reward_redemption' and points_delta < 0 and source_transaction_id is null and reverses_entry_id is null and reward_redemption_id is not null)
    or (entry_type = 'reward_refund' and points_delta > 0 and source_transaction_id is null and reverses_entry_id is not null and reward_redemption_id is not null)
  );

create index if not exists customer_loyalty_points_reward_redemption_idx
  on public.customer_loyalty_points_ledger(reward_redemption_id)
  where reward_redemption_id is not null;

create or replace function public.current_active_loyalty_rewards_owner_id()
returns uuid as $$
declare
  owner_id_value uuid;
begin
  select case when actor.role = 'owner' then actor.id else actor.owner_id end
  into owner_id_value
  from public.profiles actor
  join public.profiles owner_profile
    on owner_profile.id = case when actor.role = 'owner' then actor.id else actor.owner_id end
   and owner_profile.role = 'owner'
   and owner_profile.access = 'active'
  where actor.id = auth.uid()
    and actor.role in ('owner', 'staff')
    and actor.access = 'active';
  return owner_id_value;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.current_active_loyalty_rewards_owner_id() from public, anon, authenticated;

create or replace function public.process_loyalty_reward_expirations(
  owner_id_input uuid,
  customer_id_input text default null,
  reward_id_input uuid default null
)
returns integer as $$
declare
  redemption_row public.loyalty_reward_redemptions%rowtype;
  debit_row public.customer_loyalty_points_ledger%rowtype;
  expired_count integer := 0;
begin
  for redemption_row in
    select * from public.loyalty_reward_redemptions r
    where r.owner_id = owner_id_input
      and r.status = 'issued'
      and r.expires_at <= now()
      and (customer_id_input is null or r.customer_id = customer_id_input)
      and (reward_id_input is null or r.reward_id = reward_id_input)
    order by r.expires_at, r.id
    for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtext(owner_id_input::text), hashtext(redemption_row.customer_id));
    update public.loyalty_reward_redemptions
    set status = 'expired', expired_at = now()
    where id = redemption_row.id and status = 'issued'
      and expires_at <= now();
    if not found then continue; end if;

    insert into public.loyalty_reward_redemption_events(owner_id, redemption_id, event_type, reason)
    values (owner_id_input, redemption_row.id, 'expired', 'Code expired');

    if redemption_row.points_cost > 0 then
      select * into debit_row
      from public.customer_loyalty_points_ledger l
      where l.reward_redemption_id = redemption_row.id
        and l.entry_type = 'reward_redemption'
      for update;
      if found then
        insert into public.customer_loyalty_points_ledger(
          owner_id, customer_id, card_id, reward_redemption_id, reverses_entry_id,
          entry_type, points_delta, idempotency_key, description, created_at
        ) values (
          owner_id_input, redemption_row.customer_id, redemption_row.card_id, redemption_row.id, debit_row.id,
          'reward_refund', -debit_row.points_delta, 'reward-refund:' || redemption_row.id::text,
          redemption_row.reward_name, now()
        ) on conflict do nothing;
      end if;
    end if;
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.process_loyalty_reward_expirations(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.archive_loyalty_rewards_for_deleted_campaign()
returns trigger as $$
begin
  update public.loyalty_rewards
  set is_active = false, campaign_id = null, updated_at = now()
  where campaign_id = old.id;
  return old;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.archive_loyalty_rewards_for_deleted_campaign() from public, anon, authenticated;
drop trigger if exists archive_loyalty_rewards_before_campaign_delete on public.campaigns;
create trigger archive_loyalty_rewards_before_campaign_delete
  before delete on public.campaigns
  for each row execute function public.archive_loyalty_rewards_for_deleted_campaign();

create or replace function public.get_owner_loyalty_rewards()
returns jsonb as $$
declare
  owner_id_value uuid;
  rewards_payload jsonb;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;
  perform public.process_loyalty_reward_expirations(owner_id_value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'description', r.description,
    'campaignId', r.campaign_id,
    'pointsCost', r.points_cost,
    'minimumPoints', r.minimum_points,
    'startsAt', r.starts_at,
    'endsAt', r.ends_at,
    'stockQuantity', r.stock_quantity,
    'remainingQuantity', case when r.stock_quantity is null then null else greatest(0, r.stock_quantity - counts.active_count) end,
    'activeClaimCount', counts.active_count,
    'redeemedCount', counts.redeemed_count,
    'maxClaimsPerCustomer', r.max_claims_per_customer,
    'redemptionValidityHours', r.redemption_validity_hours,
    'isActive', r.is_active
  ) order by r.created_at desc), '[]'::jsonb)
  into rewards_payload
  from public.loyalty_rewards r
  cross join lateral (
    select
      count(*) filter (where x.status in ('issued', 'redeemed'))::integer as active_count,
      count(*) filter (where x.status = 'redeemed')::integer as redeemed_count
    from public.loyalty_reward_redemptions x
    where x.reward_id = r.id
  ) counts
  where r.owner_id = owner_id_value;
  return rewards_payload;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_owner_loyalty_rewards() from public, anon;
grant execute on function public.get_owner_loyalty_rewards() to authenticated;

create or replace function public.save_owner_loyalty_reward(
  reward_id_input uuid,
  name_input text,
  description_input text,
  campaign_id_input text,
  points_cost_input integer,
  minimum_points_input integer,
  starts_at_input timestamptz,
  ends_at_input timestamptz,
  stock_quantity_input integer,
  max_claims_per_customer_input integer,
  redemption_validity_hours_input integer,
  is_active_input boolean
)
returns jsonb as $$
declare
  owner_id_value uuid;
  reward_row public.loyalty_rewards%rowtype;
  active_claim_count integer;
  clean_name text := trim(coalesce(name_input, ''));
  clean_description text := trim(coalesce(description_input, ''));
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;
  if length(clean_name) not between 1 and 100 or length(clean_description) not between 1 and 300 then
    raise exception 'Reward name and description are required.';
  end if;
  if points_cost_input not between 0 and 1000000
    or minimum_points_input not between 0 and 100000000
    or starts_at_input is null or ends_at_input is null or ends_at_input <= starts_at_input
    or (stock_quantity_input is not null and stock_quantity_input not between 0 and 1000000)
    or max_claims_per_customer_input not between 1 and 100
    or redemption_validity_hours_input not between 1 and 720 then
    raise exception 'Reward rules or validity are outside the allowed range.';
  end if;
  if campaign_id_input is not null and not exists (
    select 1 from public.campaigns c where c.id = campaign_id_input and c.owner_id = owner_id_value
  ) then raise exception 'Campaign not found for this business.'; end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('loyalty-rewards-catalog'));
  if reward_id_input is null then
    insert into public.loyalty_rewards(
      owner_id, campaign_id, name, description, points_cost, minimum_points,
      starts_at, ends_at, stock_quantity, max_claims_per_customer,
      redemption_validity_hours, is_active
    ) values (
      owner_id_value, campaign_id_input, clean_name, clean_description, points_cost_input, minimum_points_input,
      starts_at_input, ends_at_input, stock_quantity_input, max_claims_per_customer_input,
      redemption_validity_hours_input, coalesce(is_active_input, true)
    ) returning * into reward_row;
  else
    select * into reward_row
    from public.loyalty_rewards r
    where r.id = reward_id_input and r.owner_id = owner_id_value
    for update;
    if not found then raise exception 'Reward not found for this business.'; end if;
    perform public.process_loyalty_reward_expirations(owner_id_value, null, reward_row.id);
    select count(*)::integer into active_claim_count
    from public.loyalty_reward_redemptions r
    where r.reward_id = reward_row.id and r.status in ('issued', 'redeemed');
    if stock_quantity_input is not null and stock_quantity_input < active_claim_count then
      raise exception 'Stock cannot be lower than already issued and redeemed rewards.';
    end if;
    update public.loyalty_rewards
    set campaign_id = campaign_id_input,
        name = clean_name,
        description = clean_description,
        points_cost = points_cost_input,
        minimum_points = minimum_points_input,
        starts_at = starts_at_input,
        ends_at = ends_at_input,
        stock_quantity = stock_quantity_input,
        max_claims_per_customer = max_claims_per_customer_input,
        redemption_validity_hours = redemption_validity_hours_input,
        is_active = coalesce(is_active_input, false),
        updated_at = now()
    where id = reward_row.id and owner_id = owner_id_value
    returning * into reward_row;
  end if;

  return jsonb_build_object('success', true, 'id', reward_row.id, 'isActive', reward_row.is_active);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.save_owner_loyalty_reward(uuid, text, text, text, integer, integer, timestamptz, timestamptz, integer, integer, integer, boolean) from public, anon;
grant execute on function public.save_owner_loyalty_reward(uuid, text, text, text, integer, integer, timestamptz, timestamptz, integer, integer, integer, boolean) to authenticated;

create or replace function public.get_public_loyalty_rewards(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_id_value uuid;
  customer_id_value text;
  campaign_id_value text;
  points_balance bigint;
  points_program_enabled boolean := false;
  rewards_payload jsonb;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.slug = slug_input and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then return null; end if;

  select c.customer_id, c.campaign_id into customer_id_value, campaign_id_value
  from public.issued_cards c
  where c.unique_id = card_unique_id and c.owner_id = owner_id_value;
  if customer_id_value is null then return null; end if;

  perform public.process_loyalty_reward_expirations(owner_id_value, customer_id_value);
  select coalesce(sum(l.points_delta), 0)::bigint into points_balance
  from public.customer_loyalty_points_ledger l
  where l.owner_id = owner_id_value and l.customer_id = customer_id_value;
  select coalesce((
    select p.is_enabled from public.loyalty_points_programs p where p.owner_id = owner_id_value
  ), false) into points_program_enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'description', r.description,
    'pointsCost', r.points_cost,
    'minimumPoints', r.minimum_points,
    'remainingQuantity', case when r.stock_quantity is null then null else greatest(0, r.stock_quantity - counts.active_count) end,
    'customerClaimCount', counts.customer_count,
    'maxClaimsPerCustomer', r.max_claims_per_customer,
    'canClaim',
      (r.points_cost = 0 and r.minimum_points = 0 or points_program_enabled and points_balance >= r.points_cost and points_balance >= r.minimum_points)
      and (r.stock_quantity is null or counts.active_count < r.stock_quantity)
      and counts.customer_count < r.max_claims_per_customer,
    'unavailableReason', case
      when (r.points_cost > 0 or r.minimum_points > 0) and not points_program_enabled then 'points_program_disabled'
      when points_balance < r.points_cost or points_balance < r.minimum_points then 'not_enough_points'
      when r.stock_quantity is not null and counts.active_count >= r.stock_quantity then 'sold_out'
      when counts.customer_count >= r.max_claims_per_customer then 'customer_limit'
      else null end,
    'endsAt', r.ends_at
  ) order by r.ends_at, r.name), '[]'::jsonb)
  into rewards_payload
  from public.loyalty_rewards r
  cross join lateral (
    select
      count(*) filter (where x.status in ('issued', 'redeemed'))::integer as active_count,
      count(*) filter (where x.customer_id = customer_id_value and x.status in ('issued', 'redeemed'))::integer as customer_count
    from public.loyalty_reward_redemptions x
    where x.reward_id = r.id
  ) counts
  where r.owner_id = owner_id_value
    and r.is_active
    and now() >= r.starts_at and now() < r.ends_at
    and (r.campaign_id is null or r.campaign_id = campaign_id_value);

  return jsonb_build_object('balance', points_balance, 'rewards', rewards_payload);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_public_loyalty_rewards(text, uuid) from public;
grant execute on function public.get_public_loyalty_rewards(text, uuid) to anon, authenticated;

create or replace function public.claim_loyalty_reward(
  slug_input text,
  card_unique_id uuid,
  reward_id_input uuid,
  idempotency_key_input text
)
returns jsonb as $$
declare
  owner_id_value uuid;
  customer_id_value text;
  card_id_value text;
  campaign_id_value text;
  reward_row public.loyalty_rewards%rowtype;
  existing_row public.loyalty_reward_redemptions%rowtype;
  redemption_row public.loyalty_reward_redemptions%rowtype;
  current_balance bigint;
  active_claim_count integer;
  customer_claim_count integer;
  points_enabled boolean := false;
  code_value text;
  attempt_number integer;
  key_value text := trim(coalesce(idempotency_key_input, ''));
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.slug = slug_input and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then return jsonb_build_object('success', false, 'error', 'card_not_found'); end if;
  select c.id, c.customer_id, c.campaign_id
  into card_id_value, customer_id_value, campaign_id_value
  from public.issued_cards c
  where c.unique_id = card_unique_id and c.owner_id = owner_id_value;
  if customer_id_value is null then return jsonb_build_object('success', false, 'error', 'card_not_found'); end if;
  if length(key_value) not between 1 and 100 then return jsonb_build_object('success', false, 'error', 'invalid_request'); end if;

  perform public.process_loyalty_reward_expirations(owner_id_value, customer_id_value);
  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('claim:' || key_value));
  select * into existing_row
  from public.loyalty_reward_redemptions r
  where r.owner_id = owner_id_value and r.idempotency_key = key_value;
  if found then
    if existing_row.reward_id <> reward_id_input or existing_row.customer_id <> customer_id_value or existing_row.card_id <> card_id_value then
      return jsonb_build_object('success', false, 'error', 'invalid_request');
    end if;
    if existing_row.status <> 'issued' then
      return jsonb_build_object('success', false, 'error', existing_row.status, 'status', existing_row.status);
    end if;
    select coalesce(sum(l.points_delta), 0)::bigint into current_balance
    from public.customer_loyalty_points_ledger l
    where l.owner_id = owner_id_value and l.customer_id = customer_id_value;
    return jsonb_build_object('success', true, 'redemptionId', existing_row.id, 'code', existing_row.redemption_code, 'expiresAt', existing_row.expires_at, 'balance', current_balance, 'alreadyIssued', true);
  end if;

  select * into reward_row
  from public.loyalty_rewards r
  where r.id = reward_id_input and r.owner_id = owner_id_value
  for update;
  if not found or not reward_row.is_active or now() < reward_row.starts_at or now() >= reward_row.ends_at
    or (reward_row.campaign_id is not null and reward_row.campaign_id is distinct from campaign_id_value) then
    return jsonb_build_object('success', false, 'error', 'not_available');
  end if;

  perform public.process_loyalty_reward_expirations(owner_id_value, null, reward_row.id);
  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext(customer_id_value));
  select coalesce(sum(l.points_delta), 0)::bigint into current_balance
  from public.customer_loyalty_points_ledger l
  where l.owner_id = owner_id_value and l.customer_id = customer_id_value;
  select coalesce((
    select p.is_enabled from public.loyalty_points_programs p where p.owner_id = owner_id_value
  ), false) into points_enabled;
  if (reward_row.points_cost > 0 or reward_row.minimum_points > 0)
    and (not points_enabled or current_balance < reward_row.points_cost or current_balance < reward_row.minimum_points) then
    return jsonb_build_object('success', false, 'error', 'not_eligible');
  end if;

  select count(*)::integer into active_claim_count
  from public.loyalty_reward_redemptions r
  where r.reward_id = reward_row.id and r.status in ('issued', 'redeemed');
  select count(*)::integer into customer_claim_count
  from public.loyalty_reward_redemptions r
  where r.reward_id = reward_row.id and r.customer_id = customer_id_value and r.status in ('issued', 'redeemed');
  if (reward_row.stock_quantity is not null and active_claim_count >= reward_row.stock_quantity)
    or customer_claim_count >= reward_row.max_claims_per_customer then
    return jsonb_build_object('success', false, 'error', case when reward_row.stock_quantity is not null and active_claim_count >= reward_row.stock_quantity then 'sold_out' else 'customer_limit' end);
  end if;

  for attempt_number in 1..5 loop
    code_value := 'SF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    begin
      insert into public.loyalty_reward_redemptions(
        owner_id, reward_id, customer_id, card_id, reward_name, reward_description,
        points_cost, redemption_code, idempotency_key, expires_at
      ) values (
        owner_id_value, reward_row.id, customer_id_value, card_id_value, reward_row.name, reward_row.description,
        reward_row.points_cost, code_value, key_value,
        least(now() + make_interval(hours => reward_row.redemption_validity_hours), reward_row.ends_at)
      ) returning * into redemption_row;
      exit;
    exception when unique_violation then
      if attempt_number = 5 then raise; end if;
    end;
  end loop;

  insert into public.loyalty_reward_redemption_events(owner_id, redemption_id, event_type, reason)
  values (owner_id_value, redemption_row.id, 'issued', 'Reward claimed by customer');

  if reward_row.points_cost > 0 then
    insert into public.customer_loyalty_points_ledger(
      owner_id, customer_id, card_id, reward_redemption_id, entry_type,
      points_delta, idempotency_key, description, created_at
    ) values (
      owner_id_value, customer_id_value, card_id_value, redemption_row.id, 'reward_redemption',
      -reward_row.points_cost, 'reward-debit:' || redemption_row.id::text, reward_row.name, now()
    );
    current_balance := current_balance - reward_row.points_cost;
  end if;

  return jsonb_build_object('success', true, 'redemptionId', redemption_row.id, 'code', redemption_row.redemption_code, 'expiresAt', redemption_row.expires_at, 'balance', current_balance, 'alreadyIssued', false);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.claim_loyalty_reward(text, uuid, uuid, text) from public;
grant execute on function public.claim_loyalty_reward(text, uuid, uuid, text) to anon, authenticated;

create or replace function public.get_public_loyalty_reward_redemptions(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_id_value uuid;
  customer_id_value text;
  redemptions_payload jsonb;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.slug = slug_input and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then return '[]'::jsonb; end if;
  select c.customer_id into customer_id_value
  from public.issued_cards c
  where c.unique_id = card_unique_id and c.owner_id = owner_id_value;
  if customer_id_value is null then return '[]'::jsonb; end if;
  perform public.process_loyalty_reward_expirations(owner_id_value, customer_id_value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'rewardName', r.reward_name,
    'code', r.redemption_code,
    'status', r.status,
    'pointsCost', r.points_cost,
    'issuedAt', r.issued_at,
    'expiresAt', r.expires_at,
    'redeemedAt', r.redeemed_at,
    'cancelledAt', r.cancelled_at
  ) order by r.issued_at desc), '[]'::jsonb)
  into redemptions_payload
  from (
    select * from public.loyalty_reward_redemptions x
    where x.owner_id = owner_id_value and x.customer_id = customer_id_value
    order by x.issued_at desc limit 20
  ) r;
  return redemptions_payload;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_public_loyalty_reward_redemptions(text, uuid) from public;
grant execute on function public.get_public_loyalty_reward_redemptions(text, uuid) to anon, authenticated;

create or replace function public.get_staff_loyalty_reward_redemptions()
returns jsonb as $$
declare
  owner_id_value uuid := public.current_active_loyalty_rewards_owner_id();
  redemptions_payload jsonb;
begin
  if owner_id_value is null then raise exception 'Active owner or staff authentication required.'; end if;
  perform public.process_loyalty_reward_expirations(owner_id_value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'rewardName', r.reward_name,
    'customerName', c.name,
    'code', r.redemption_code,
    'status', r.status,
    'pointsCost', r.points_cost,
    'issuedAt', r.issued_at,
    'expiresAt', r.expires_at,
    'redeemedAt', r.redeemed_at,
    'redeemedBy', redeemer.business_name,
    'cancelledAt', r.cancelled_at,
    'cancellationReason', r.cancellation_reason
  ) order by r.issued_at desc), '[]'::jsonb)
  into redemptions_payload
  from (
    select * from public.loyalty_reward_redemptions x
    where x.owner_id = owner_id_value
    order by x.issued_at desc limit 100
  ) r
  join public.customers c on c.id = r.customer_id
  left join public.profiles redeemer on redeemer.id = r.redeemed_by;
  return redemptions_payload;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_staff_loyalty_reward_redemptions() from public, anon;
grant execute on function public.get_staff_loyalty_reward_redemptions() to authenticated;

create or replace function public.validate_loyalty_reward_code(code_input text)
returns jsonb as $$
declare
  owner_id_value uuid := public.current_active_loyalty_rewards_owner_id();
  redemption_row public.loyalty_reward_redemptions%rowtype;
begin
  if owner_id_value is null then raise exception 'Active owner or staff authentication required.'; end if;
  select * into redemption_row
  from public.loyalty_reward_redemptions r
  where r.owner_id = owner_id_value and upper(r.redemption_code) = upper(trim(coalesce(code_input, '')))
  for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;

  perform public.process_loyalty_reward_expirations(owner_id_value, redemption_row.customer_id, redemption_row.reward_id);
  select * into redemption_row from public.loyalty_reward_redemptions r where r.id = redemption_row.id;
  if redemption_row.status <> 'issued' then
    return jsonb_build_object('success', false, 'error', redemption_row.status, 'status', redemption_row.status, 'rewardName', redemption_row.reward_name);
  end if;

  update public.loyalty_reward_redemptions
  set status = 'redeemed', redeemed_at = now(), redeemed_by = auth.uid()
  where id = redemption_row.id
  returning * into redemption_row;
  insert into public.loyalty_reward_redemption_events(owner_id, redemption_id, event_type, actor_id, reason)
  values (owner_id_value, redemption_row.id, 'redeemed', auth.uid(), 'Code validated by staff');
  return jsonb_build_object('success', true, 'status', 'redeemed', 'rewardName', redemption_row.reward_name, 'code', redemption_row.redemption_code, 'customerName', (select c.name from public.customers c where c.id = redemption_row.customer_id), 'redeemedAt', redemption_row.redeemed_at);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.validate_loyalty_reward_code(text) from public, anon;
grant execute on function public.validate_loyalty_reward_code(text) to authenticated;

create or replace function public.cancel_loyalty_reward_code(code_input text, reason_input text)
returns jsonb as $$
declare
  owner_id_value uuid;
  redemption_row public.loyalty_reward_redemptions%rowtype;
  debit_row public.customer_loyalty_points_ledger%rowtype;
  reason_value text := trim(coalesce(reason_input, ''));
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;
  if length(reason_value) not between 3 and 250 then raise exception 'Enter a cancellation reason between 3 and 250 characters.'; end if;
  select * into redemption_row
  from public.loyalty_reward_redemptions r
  where r.owner_id = owner_id_value and upper(r.redemption_code) = upper(trim(coalesce(code_input, '')))
  for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  perform public.process_loyalty_reward_expirations(owner_id_value, redemption_row.customer_id, redemption_row.reward_id);
  select * into redemption_row from public.loyalty_reward_redemptions r where r.id = redemption_row.id;
  if redemption_row.status <> 'issued' then
    return jsonb_build_object('success', false, 'error', redemption_row.status, 'status', redemption_row.status);
  end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext(redemption_row.customer_id));
  update public.loyalty_reward_redemptions
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = reason_value
  where id = redemption_row.id
  returning * into redemption_row;
  insert into public.loyalty_reward_redemption_events(owner_id, redemption_id, event_type, actor_id, reason)
  values (owner_id_value, redemption_row.id, 'cancelled', auth.uid(), reason_value);

  if redemption_row.points_cost > 0 then
    select * into debit_row
    from public.customer_loyalty_points_ledger l
    where l.reward_redemption_id = redemption_row.id and l.entry_type = 'reward_redemption'
    for update;
    if found then
      insert into public.customer_loyalty_points_ledger(
        owner_id, customer_id, card_id, reward_redemption_id, reverses_entry_id,
        entry_type, points_delta, idempotency_key, description, actor_id
      ) values (
        owner_id_value, redemption_row.customer_id, redemption_row.card_id, redemption_row.id, debit_row.id,
        'reward_refund', -debit_row.points_delta, 'reward-refund:' || redemption_row.id::text,
        redemption_row.reward_name, auth.uid()
      ) on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('success', true, 'status', 'cancelled', 'redemptionId', redemption_row.id);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.cancel_loyalty_reward_code(text, text) from public, anon;
grant execute on function public.cancel_loyalty_reward_code(text, text) to authenticated;
