-- Phase 3.1: mission completions unlock rewards from the shared reward catalog.
-- Apply after add_loyalty_missions.sql, add_loyalty_points.sql, and add_loyalty_rewards.sql.

alter table public.loyalty_missions
  add column if not exists catalog_reward_id uuid;

alter table public.mission_completions
  add column if not exists catalog_reward_id uuid references public.loyalty_rewards(id) on delete set null;

alter table public.loyalty_reward_redemptions
  add column if not exists mission_completion_id uuid references public.mission_completions(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.loyalty_missions'::regclass
      and conname = 'loyalty_missions_catalog_reward_id_fkey'
  ) then
    alter table public.loyalty_missions
      add constraint loyalty_missions_catalog_reward_id_fkey
      foreign key (catalog_reward_id) references public.loyalty_rewards(id) on delete restrict;
  end if;
end;
$$;

create index if not exists loyalty_missions_catalog_reward_idx
  on public.loyalty_missions(owner_id, catalog_reward_id)
  where catalog_reward_id is not null;

create index if not exists loyalty_reward_redemptions_mission_completion_idx
  on public.loyalty_reward_redemptions(mission_completion_id)
  where mission_completion_id is not null;

create unique index if not exists loyalty_reward_redemptions_active_mission_completion_unique
  on public.loyalty_reward_redemptions(mission_completion_id)
  where mission_completion_id is not null and status in ('issued', 'redeemed');

alter table public.loyalty_missions
  drop constraint if exists loyalty_missions_reward_type_check;
alter table public.loyalty_missions
  drop constraint if exists loyalty_missions_valid_reward;
alter table public.loyalty_missions
  add constraint loyalty_missions_reward_type_check
  check (reward_type in ('benefit', 'bonus_stamps', 'catalog_reward'));
alter table public.loyalty_missions
  add constraint loyalty_missions_valid_reward check (
    (reward_type = 'benefit' and reward_stamps = 0 and catalog_reward_id is null)
    or (reward_type = 'bonus_stamps' and reward_stamps between 1 and 20 and catalog_reward_id is null)
    or (reward_type = 'catalog_reward' and reward_stamps = 0 and catalog_reward_id is not null)
  );

create or replace function public.validate_loyalty_mission_catalog_reward()
returns trigger as $$
declare
  reward_owner_id uuid;
  reward_campaign_id text;
  reward_name_value text;
begin
  if tg_op = 'UPDATE' then
    if new.catalog_reward_id is distinct from old.catalog_reward_id
      and exists (select 1 from public.mission_progress_events e where e.mission_id = old.id) then
      raise exception 'Mission rules cannot be edited after customer progress begins. Pause the mission instead.';
    end if;
  end if;

  if new.reward_type = 'catalog_reward' then
    select r.owner_id, r.campaign_id, r.name
    into reward_owner_id, reward_campaign_id, reward_name_value
    from public.loyalty_rewards r
    where r.id = new.catalog_reward_id;
    if not found or reward_owner_id <> new.owner_id then
      raise exception 'Choose a reward from this business catalog.';
    end if;
    if reward_campaign_id is not null and reward_campaign_id <> new.campaign_id then
      raise exception 'The catalog reward must be global or belong to this mission campaign.';
    end if;
    if tg_op = 'INSERT' then
      new.reward_description := reward_name_value;
    elsif new.catalog_reward_id is distinct from old.catalog_reward_id then
      new.reward_description := reward_name_value;
    end if;
  elsif new.catalog_reward_id is not null then
    raise exception 'A catalog reward can only be linked to a catalog reward mission.';
  end if;

  return new;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.validate_loyalty_mission_catalog_reward() from public, anon, authenticated;
drop trigger if exists loyalty_mission_catalog_reward_validate on public.loyalty_missions;
create trigger loyalty_mission_catalog_reward_validate
  before insert or update on public.loyalty_missions
  for each row execute function public.validate_loyalty_mission_catalog_reward();

create or replace function public.track_loyalty_mission_stamp()
returns trigger as $$
declare
  card_row public.issued_cards%rowtype;
  mission_row public.loyalty_missions%rowtype;
  event_count integer;
  completion_count integer;
  target_completion integer;
begin
  if new.type <> 'stamp_add' or new.amount <= 0 then return new; end if;

  delete from public.trusted_card_action_events where transaction_id = new.id;
  if not found then return new; end if;

  select * into card_row from public.issued_cards where id = new.card_id;
  if not found or card_row.campaign_id is null then return new; end if;

  for mission_row in
    select * from public.loyalty_missions m
    where m.owner_id = card_row.owner_id
      and m.campaign_id = card_row.campaign_id
      and m.is_active
      and new.created_at >= m.starts_at
      and new.created_at < m.ends_at
  loop
    perform pg_advisory_xact_lock(
      hashtext(mission_row.id::text),
      hashtext(card_row.customer_id || case
        when mission_row.mission_type = 'visit_count' then ''
        else ':' || card_row.id
      end)
    );

    insert into public.mission_progress_events (mission_id, transaction_id, customer_id, card_id, created_at)
    values (mission_row.id, new.id, card_row.customer_id, card_row.id, new.created_at)
    on conflict do nothing;
    if not found then continue; end if;

    select count(*)::integer into event_count
    from public.mission_progress_events e
    where e.mission_id = mission_row.id
      and e.customer_id = card_row.customer_id
      and e.created_at >= mission_row.starts_at
      and e.created_at < mission_row.ends_at
      and (mission_row.mission_type = 'visit_count' or e.card_id = card_row.id);

    select count(*)::integer into completion_count
    from public.mission_completions c
    where c.mission_id = mission_row.id
      and c.customer_id = card_row.customer_id
      and ((mission_row.mission_type = 'visit_count' and c.card_id is null)
        or (mission_row.mission_type = 'card_stamps' and c.card_id = card_row.id));

    target_completion := least(floor(event_count::numeric / mission_row.goal_count)::integer, mission_row.max_completions);
    while completion_count < target_completion loop
      completion_count := completion_count + 1;
      insert into public.mission_completions (
        mission_id, customer_id, card_id, reward_type, completion_number,
        reward_description, reward_stamps, catalog_reward_id
      ) values (
        mission_row.id, card_row.customer_id,
        case when mission_row.mission_type = 'visit_count' then null else card_row.id end,
        mission_row.reward_type, completion_count, mission_row.reward_description,
        mission_row.reward_stamps, mission_row.catalog_reward_id
      ) on conflict do nothing;
    end loop;
  end loop;

  return new;
end;
$$ language plpgsql security definer
set search_path = public;

create or replace function public.mission_progress_payload(
  mission_id_input uuid,
  customer_id_input text,
  card_id_input text,
  include_completions_input boolean default false
)
returns jsonb as $$
declare
  mission_row public.loyalty_missions%rowtype;
  event_count integer;
  completion_count integer;
  completion_payload jsonb;
begin
  select * into mission_row from public.loyalty_missions where id = mission_id_input;
  if not found then return null; end if;

  select count(*)::integer into event_count
  from public.mission_progress_events e
  where e.mission_id = mission_row.id
    and e.customer_id = customer_id_input
    and e.created_at >= mission_row.starts_at
    and e.created_at < mission_row.ends_at
    and (mission_row.mission_type = 'visit_count' or e.card_id = card_id_input);

  select count(*)::integer into completion_count
  from public.mission_completions c
  where c.mission_id = mission_row.id
    and c.customer_id = customer_id_input
    and ((mission_row.mission_type = 'visit_count' and c.card_id is null)
      or (mission_row.mission_type = 'card_stamps' and c.card_id = card_id_input));

  if include_completions_input then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'completionNumber', c.completion_number,
      'rewardType', c.reward_type,
      'rewardDescription', c.reward_description,
      'rewardStamps', c.reward_stamps,
      'catalogRewardId', c.catalog_reward_id,
      'catalogRewardClaimStatus', case
        when c.reward_type <> 'catalog_reward' then null
        when exists (select 1 from public.loyalty_reward_redemptions r where r.mission_completion_id = c.id and r.status = 'redeemed') then 'redeemed'
        when exists (select 1 from public.loyalty_reward_redemptions r where r.mission_completion_id = c.id and r.status = 'issued') then 'issued'
        else 'available' end,
      'completedAt', c.completed_at,
      'redeemedAt', case when c.reward_type = 'catalog_reward' then (
        select r.redeemed_at from public.loyalty_reward_redemptions r
        where r.mission_completion_id = c.id and r.status = 'redeemed'
        order by r.issued_at desc limit 1
      ) else c.redeemed_at end
    ) order by c.completion_number), '[]'::jsonb)
    into completion_payload
    from public.mission_completions c
    where c.mission_id = mission_row.id
      and c.customer_id = customer_id_input
      and ((mission_row.mission_type = 'visit_count' and c.card_id is null)
        or (mission_row.mission_type = 'card_stamps' and c.card_id = card_id_input));
  else
    completion_payload := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', mission_row.id,
    'name', mission_row.name,
    'description', mission_row.description,
    'missionType', mission_row.mission_type,
    'goalCount', mission_row.goal_count,
    'progress', least(mission_row.goal_count, greatest(0, event_count - (completion_count * mission_row.goal_count))),
    'completedCount', completion_count,
    'maxCompletions', mission_row.max_completions,
    'rewardType', mission_row.reward_type,
    'rewardDescription', mission_row.reward_description,
    'rewardStamps', mission_row.reward_stamps,
    'catalogRewardId', mission_row.catalog_reward_id,
    'startsAt', mission_row.starts_at,
    'endsAt', mission_row.ends_at,
    'isActive', mission_row.is_active,
    'availableRewards', (
      select count(*)::integer from public.mission_completions c
      where c.mission_id = mission_row.id and c.customer_id = customer_id_input
        and c.redeemed_at is null
        and ((mission_row.mission_type = 'visit_count' and c.card_id is null)
          or (mission_row.mission_type = 'card_stamps' and c.card_id = card_id_input))
        and (c.reward_type <> 'catalog_reward' or not exists (
          select 1 from public.loyalty_reward_redemptions r
          where r.mission_completion_id = c.id and r.status in ('issued', 'redeemed')
        ))
    ),
    'completions', completion_payload
  );
end;
$$ language plpgsql security definer stable
set search_path = public;

create or replace function public.get_owner_loyalty_missions()
returns jsonb as $$
declare
  actor_row public.profiles%rowtype;
  result jsonb;
begin
  select * into actor_row from public.profiles where id = auth.uid();
  if not found or actor_row.role <> 'owner' or actor_row.access <> 'active' then
    raise exception 'Only business owners can view mission analytics.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'ownerId', m.owner_id,
    'campaignId', m.campaign_id,
    'name', m.name,
    'description', m.description,
    'missionType', m.mission_type,
    'goalCount', m.goal_count,
    'startsAt', m.starts_at,
    'endsAt', m.ends_at,
    'rewardType', m.reward_type,
    'rewardDescription', m.reward_description,
    'rewardStamps', m.reward_stamps,
    'catalogRewardId', m.catalog_reward_id,
    'catalogRewardName', reward.name,
    'maxCompletions', m.max_completions,
    'isActive', m.is_active,
    'createdAt', m.created_at,
    'participantCount', (select count(distinct e.customer_id)::integer from public.mission_progress_events e where e.mission_id = m.id),
    'completedCount', (select count(*)::integer from public.mission_completions c where c.mission_id = m.id),
    'redeemedCount',
      (select count(*)::integer from public.mission_reward_redemptions r where r.mission_id = m.id)
      + (select count(*)::integer from public.loyalty_reward_redemptions r
         join public.mission_completions c on c.id = r.mission_completion_id
         where c.mission_id = m.id and r.status = 'redeemed')
  ) order by m.created_at desc), '[]'::jsonb)
  into result
  from public.loyalty_missions m
  left join public.loyalty_rewards reward on reward.id = m.catalog_reward_id
  where m.owner_id = actor_row.id;

  return result;
end;
$$ language plpgsql security definer stable
set search_path = public;

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
  from public.profiles p where p.slug = slug_input and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then return null; end if;

  select c.customer_id, c.campaign_id into customer_id_value, campaign_id_value
  from public.issued_cards c where c.unique_id = card_unique_id and c.owner_id = owner_id_value;
  if customer_id_value is null then return null; end if;

  perform public.process_loyalty_reward_expirations(owner_id_value, customer_id_value);
  select coalesce(sum(l.points_delta), 0)::bigint into points_balance
  from public.customer_loyalty_points_ledger l
  where l.owner_id = owner_id_value and l.customer_id = customer_id_value;
  select coalesce((select p.is_enabled from public.loyalty_points_programs p where p.owner_id = owner_id_value), false)
    into points_program_enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'description', r.description,
    'pointsCost', r.points_cost,
    'minimumPoints', r.minimum_points,
    'remainingQuantity', case when r.stock_quantity is null then null else greatest(0, r.stock_quantity - counts.active_count) end,
    'customerClaimCount', counts.customer_count,
    'maxClaimsPerCustomer', r.max_claims_per_customer,
    'missionCompletions', mission_claims.completions,
    'canClaim',
      (mission_claims.available_count > 0 or
        (r.points_cost = 0 and r.minimum_points = 0 or points_program_enabled and points_balance >= r.points_cost and points_balance >= r.minimum_points))
      and (r.stock_quantity is null or counts.active_count < r.stock_quantity)
      and counts.customer_count < r.max_claims_per_customer,
    'unavailableReason', case
      when r.stock_quantity is not null and counts.active_count >= r.stock_quantity then 'sold_out'
      when counts.customer_count >= r.max_claims_per_customer then 'customer_limit'
      when mission_claims.available_count > 0 then null
      when (r.points_cost > 0 or r.minimum_points > 0) and not points_program_enabled then 'points_program_disabled'
      when points_balance < r.points_cost or points_balance < r.minimum_points then 'not_enough_points'
      else null end,
    'endsAt', r.ends_at
  ) order by r.ends_at, r.name), '[]'::jsonb)
  into rewards_payload
  from public.loyalty_rewards r
  cross join lateral (
    select
      count(*) filter (where x.status in ('issued', 'redeemed'))::integer as active_count,
      count(*) filter (where x.customer_id = customer_id_value and x.status in ('issued', 'redeemed'))::integer as customer_count
    from public.loyalty_reward_redemptions x where x.reward_id = r.id
  ) counts
  cross join lateral (
    select
      count(*) filter (where not exists (
        select 1 from public.loyalty_reward_redemptions x
        where x.mission_completion_id = c.id and x.status in ('issued', 'redeemed')
      ))::integer as available_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'completionId', c.id, 'missionName', m.name
      ) order by c.completed_at, c.id) filter (where not exists (
        select 1 from public.loyalty_reward_redemptions x
        where x.mission_completion_id = c.id and x.status in ('issued', 'redeemed')
      )), '[]'::jsonb) as completions
    from public.mission_completions c
    join public.loyalty_missions m on m.id = c.mission_id
    where c.catalog_reward_id = r.id
      and c.reward_type = 'catalog_reward'
      and c.customer_id = customer_id_value
      and c.redeemed_at is null
      and m.owner_id = owner_id_value
      and m.campaign_id = campaign_id_value
      and ((m.mission_type = 'visit_count' and c.card_id is null)
        or (m.mission_type = 'card_stamps' and c.card_id = (select ic.id from public.issued_cards ic where ic.unique_id = card_unique_id and ic.owner_id = owner_id_value)))
  ) mission_claims
  where r.owner_id = owner_id_value
    and ((r.is_active and now() >= r.starts_at and now() < r.ends_at
      and (r.campaign_id is null or r.campaign_id = campaign_id_value))
      or mission_claims.available_count > 0);

  return jsonb_build_object('balance', points_balance, 'rewards', rewards_payload);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_public_loyalty_rewards(text, uuid) from public;
grant execute on function public.get_public_loyalty_rewards(text, uuid) to anon, authenticated;

create or replace function public.claim_mission_catalog_reward(
  slug_input text,
  card_unique_id uuid,
  completion_id_input uuid,
  idempotency_key_input text
)
returns jsonb as $$
declare
  owner_id_value uuid;
  customer_id_value text;
  card_id_value text;
  campaign_id_value text;
  reward_id_value uuid;
  completion_row public.mission_completions%rowtype;
  reward_row public.loyalty_rewards%rowtype;
  existing_row public.loyalty_reward_redemptions%rowtype;
  active_row public.loyalty_reward_redemptions%rowtype;
  redemption_row public.loyalty_reward_redemptions%rowtype;
  current_balance bigint;
  active_claim_count integer;
  customer_claim_count integer;
  code_value text;
  attempt_number integer;
  key_value text := trim(coalesce(idempotency_key_input, ''));
begin
  select p.id into owner_id_value from public.profiles p
  where p.slug = slug_input and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then return jsonb_build_object('success', false, 'error', 'card_not_found'); end if;

  select c.id, c.customer_id, c.campaign_id
  into card_id_value, customer_id_value, campaign_id_value
  from public.issued_cards c where c.unique_id = card_unique_id and c.owner_id = owner_id_value;
  if customer_id_value is null then return jsonb_build_object('success', false, 'error', 'card_not_found'); end if;
  if length(key_value) not between 1 and 100 or completion_id_input is null then
    return jsonb_build_object('success', false, 'error', 'invalid_request');
  end if;

  perform public.process_loyalty_reward_expirations(owner_id_value, customer_id_value);
  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('mission-claim:' || key_value));
  select * into existing_row from public.loyalty_reward_redemptions r
  where r.owner_id = owner_id_value and r.idempotency_key = key_value;
  if found then
    if existing_row.mission_completion_id is distinct from completion_id_input
      or existing_row.customer_id <> customer_id_value or existing_row.card_id <> card_id_value then
      return jsonb_build_object('success', false, 'error', 'invalid_request');
    end if;
    if existing_row.status <> 'issued' then
      return jsonb_build_object('success', false, 'error', existing_row.status, 'status', existing_row.status);
    end if;
    select coalesce(sum(l.points_delta), 0)::bigint into current_balance
    from public.customer_loyalty_points_ledger l
    where l.owner_id = owner_id_value and l.customer_id = customer_id_value;
    return jsonb_build_object('success', true, 'redemptionId', existing_row.id,
      'code', existing_row.redemption_code, 'expiresAt', existing_row.expires_at,
      'balance', current_balance, 'alreadyIssued', true);
  end if;

  select m.catalog_reward_id into reward_id_value
  from public.mission_completions c
  join public.loyalty_missions m on m.id = c.mission_id
  where c.id = completion_id_input
    and c.customer_id = customer_id_value
    and c.reward_type = 'catalog_reward'
    and c.catalog_reward_id is not null
    and m.owner_id = owner_id_value
    and m.campaign_id = campaign_id_value
    and ((m.mission_type = 'visit_count' and c.card_id is null)
      or (m.mission_type = 'card_stamps' and c.card_id = card_id_value));
  if reward_id_value is null then return jsonb_build_object('success', false, 'error', 'not_eligible'); end if;

  select * into reward_row from public.loyalty_rewards r
  where r.id = reward_id_value and r.owner_id = owner_id_value for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_available'); end if;

  perform public.process_loyalty_reward_expirations(owner_id_value, null, reward_row.id);
  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext(customer_id_value));
  select * into completion_row from public.mission_completions c
  where c.id = completion_id_input for update;
  if not found or completion_row.customer_id <> customer_id_value
    or completion_row.catalog_reward_id <> reward_row.id
    or completion_row.reward_type <> 'catalog_reward'
    or completion_row.redeemed_at is not null then
    return jsonb_build_object('success', false, 'error', 'not_eligible');
  end if;

  select * into active_row from public.loyalty_reward_redemptions r
  where r.mission_completion_id = completion_row.id and r.status in ('issued', 'redeemed')
  order by r.issued_at desc limit 1 for update;
  if found then
    if active_row.status = 'redeemed' then return jsonb_build_object('success', false, 'error', 'already_redeemed'); end if;
    select coalesce(sum(l.points_delta), 0)::bigint into current_balance
    from public.customer_loyalty_points_ledger l
    where l.owner_id = owner_id_value and l.customer_id = customer_id_value;
    return jsonb_build_object('success', true, 'redemptionId', active_row.id,
      'code', active_row.redemption_code, 'expiresAt', active_row.expires_at,
      'balance', current_balance, 'alreadyIssued', true);
  end if;

  select count(*)::integer into active_claim_count from public.loyalty_reward_redemptions r
  where r.reward_id = reward_row.id and r.status in ('issued', 'redeemed');
  select count(*)::integer into customer_claim_count from public.loyalty_reward_redemptions r
  where r.reward_id = reward_row.id and r.customer_id = customer_id_value and r.status in ('issued', 'redeemed');
  if (reward_row.stock_quantity is not null and active_claim_count >= reward_row.stock_quantity)
    or customer_claim_count >= reward_row.max_claims_per_customer then
    return jsonb_build_object('success', false, 'error', case
      when reward_row.stock_quantity is not null and active_claim_count >= reward_row.stock_quantity then 'sold_out'
      else 'customer_limit' end);
  end if;

  for attempt_number in 1..5 loop
    code_value := 'SF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    begin
      insert into public.loyalty_reward_redemptions(
        owner_id, reward_id, customer_id, card_id, mission_completion_id,
        reward_name, reward_description, points_cost, redemption_code,
        idempotency_key, expires_at
      ) values (
        owner_id_value, reward_row.id, customer_id_value, card_id_value, completion_row.id,
        reward_row.name, reward_row.description, 0, code_value, key_value,
        now() + make_interval(hours => reward_row.redemption_validity_hours)
      ) returning * into redemption_row;
      exit;
    exception when unique_violation then
      if attempt_number = 5 then raise; end if;
    end;
  end loop;

  insert into public.loyalty_reward_redemption_events(owner_id, redemption_id, event_type, reason)
  values (owner_id_value, redemption_row.id, 'issued', 'Reward unlocked by a completed mission');
  select coalesce(sum(l.points_delta), 0)::bigint into current_balance
  from public.customer_loyalty_points_ledger l
  where l.owner_id = owner_id_value and l.customer_id = customer_id_value;

  return jsonb_build_object('success', true, 'redemptionId', redemption_row.id,
    'code', redemption_row.redemption_code, 'expiresAt', redemption_row.expires_at,
    'balance', current_balance, 'alreadyIssued', false);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.claim_mission_catalog_reward(text, uuid, uuid, text) from public;
grant execute on function public.claim_mission_catalog_reward(text, uuid, uuid, text) to anon, authenticated;

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
    'missionName', mission.name,
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
  ) r
  left join public.mission_completions completion on completion.id = r.mission_completion_id
  left join public.loyalty_missions mission on mission.id = completion.mission_id;
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
    'missionName', mission.name,
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
  left join public.profiles redeemer on redeemer.id = r.redeemed_by
  left join public.mission_completions completion on completion.id = r.mission_completion_id
  left join public.loyalty_missions mission on mission.id = completion.mission_id;
  return redemptions_payload;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_staff_loyalty_reward_redemptions() from public, anon;
grant execute on function public.get_staff_loyalty_reward_redemptions() to authenticated;

create or replace function public.prevent_manual_catalog_mission_redemption()
returns trigger as $$
begin
  if old.reward_type = 'catalog_reward' and old.redeemed_at is null and new.redeemed_at is not null then
    raise exception 'Catalog mission rewards must be claimed through the reward catalog code.';
  end if;
  return new;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.prevent_manual_catalog_mission_redemption() from public, anon, authenticated;
drop trigger if exists mission_completion_prevent_manual_catalog_redemption on public.mission_completions;
create trigger mission_completion_prevent_manual_catalog_redemption
  before update on public.mission_completions
  for each row execute function public.prevent_manual_catalog_mission_redemption();

-- Keep the owner-only reset compatible with the new mission-to-reward foreign key.
create or replace function public.reset_owner_business_data()
returns jsonb as $$
declare
  owner_id_value uuid;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active'
  for update;
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('reset-business-data'));
  delete from public.trusted_card_action_events e
  using public.transactions t
  join public.issued_cards c on c.id = t.card_id
  where e.transaction_id = t.id and c.owner_id = owner_id_value;

  delete from public.loyalty_reward_redemptions where owner_id = owner_id_value;
  delete from public.loyalty_missions where owner_id = owner_id_value;
  delete from public.loyalty_rewards where owner_id = owner_id_value;

  delete from public.customers where owner_id = owner_id_value;
  delete from public.campaigns where owner_id = owner_id_value;
  delete from public.loyalty_point_levels where owner_id = owner_id_value;
  delete from public.loyalty_points_programs where owner_id = owner_id_value;
  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.reset_owner_business_data() from public, anon;
grant execute on function public.reset_owner_business_data() to authenticated;

notify pgrst, 'reload schema';
