-- Loyalty missions, server-validated card actions, and claim audit trail.
-- Safe to re-run on existing Stampfy projects.

alter table public.transactions
  add column if not exists created_at timestamptz not null default now();
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('stamp_add', 'stamp_remove', 'redeem', 'issued', 'mission_bonus'));

create table if not exists public.trusted_card_action_events (
  transaction_id text primary key,
  created_at timestamptz not null default now()
);
alter table public.trusted_card_action_events enable row level security;
revoke all on public.trusted_card_action_events from anon, authenticated;

create table if not exists public.loyalty_missions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id text not null,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '',
  mission_type text not null check (mission_type in ('visit_count', 'card_stamps')),
  goal_count integer not null check (goal_count between 1 and 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_type text not null default 'benefit' check (reward_type in ('benefit', 'bonus_stamps')),
  reward_description text not null check (length(trim(reward_description)) between 1 and 300),
  reward_stamps integer not null default 0 check (reward_stamps between 0 and 20),
  max_completions integer not null default 1 check (max_completions between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_missions_valid_period check (ends_at > starts_at),
  constraint loyalty_missions_valid_reward check (
    (reward_type = 'benefit' and reward_stamps = 0)
    or (reward_type = 'bonus_stamps' and reward_stamps > 0)
  )
);

alter table public.loyalty_missions add column if not exists reward_type text not null default 'benefit';
alter table public.loyalty_missions add column if not exists reward_stamps integer not null default 0;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.loyalty_missions'::regclass
      and conname = 'loyalty_missions_valid_reward'
  ) then
    alter table public.loyalty_missions
      add constraint loyalty_missions_valid_reward check (
        (reward_type = 'benefit' and reward_stamps = 0)
        or (reward_type = 'bonus_stamps' and reward_stamps between 1 and 20)
      );
  end if;
end;
$$;

create index if not exists loyalty_missions_owner_campaign_idx
  on public.loyalty_missions(owner_id, campaign_id, is_active, starts_at, ends_at);

alter table public.loyalty_missions enable row level security;
drop policy if exists "Owners can manage own loyalty missions" on public.loyalty_missions;
create policy "Owners can manage own loyalty missions"
  on public.loyalty_missions for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Staff can read owner loyalty missions" on public.loyalty_missions;
create policy "Staff can read owner loyalty missions"
  on public.loyalty_missions for select
  using (owner_id = (select public.current_staff_owner_id()));

grant select, insert, update on public.loyalty_missions to authenticated;
revoke delete on public.loyalty_missions from anon, authenticated;

create table if not exists public.mission_progress_events (
  mission_id uuid not null references public.loyalty_missions(id) on delete cascade,
  transaction_id text not null references public.transactions(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  card_id text not null references public.issued_cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (mission_id, transaction_id)
);

create index if not exists mission_progress_customer_idx
  on public.mission_progress_events(mission_id, customer_id, created_at);
create index if not exists mission_progress_card_idx
  on public.mission_progress_events(mission_id, card_id, created_at);

alter table public.mission_progress_events enable row level security;
revoke all on public.mission_progress_events from anon, authenticated;

create table if not exists public.mission_completions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.loyalty_missions(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  card_id text,
  reward_type text not null default 'benefit',
  completion_number integer not null check (completion_number > 0),
  reward_description text not null,
  reward_stamps integer not null default 0,
  completed_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(id) on delete set null,
  constraint mission_completion_redemption_pair check (
    (redeemed_at is null and redeemed_by is null)
    or (redeemed_at is not null and redeemed_by is not null)
  )
);

alter table public.mission_completions add column if not exists reward_type text not null default 'benefit';
alter table public.mission_completions add column if not exists reward_stamps integer not null default 0;

create unique index if not exists mission_frequency_completion_unique
  on public.mission_completions(mission_id, customer_id, completion_number)
  where card_id is null;
create unique index if not exists mission_card_completion_unique
  on public.mission_completions(mission_id, customer_id, card_id, completion_number)
  where card_id is not null;
create index if not exists mission_completions_customer_idx
  on public.mission_completions(mission_id, customer_id, completed_at);

alter table public.mission_completions enable row level security;
revoke all on public.mission_completions from anon, authenticated;

create table if not exists public.mission_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null unique references public.mission_completions(id) on delete cascade,
  mission_id uuid not null references public.loyalty_missions(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  card_id text,
  reward_type text not null default 'benefit',
  reward_description text not null,
  reward_stamps integer not null default 0,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz not null default now()
);

alter table public.mission_reward_redemptions add column if not exists reward_type text not null default 'benefit';
alter table public.mission_reward_redemptions add column if not exists reward_stamps integer not null default 0;

alter table public.mission_reward_redemptions enable row level security;
revoke all on public.mission_reward_redemptions from anon, authenticated;

create or replace function public.validate_loyalty_mission()
returns trigger as $$
declare
  campaign_owner_id uuid;
  campaign_owner_role text;
begin
  if new.campaign_id is not null then
    select owner_id into campaign_owner_id
    from public.campaigns where id = new.campaign_id;
    if not found or campaign_owner_id <> new.owner_id then
      raise exception 'Mission campaign must belong to the same business.';
    end if;
  end if;

  select role into campaign_owner_role from public.profiles where id = new.owner_id;
  if campaign_owner_role <> 'owner' then
    raise exception 'Only a business owner can own a mission.';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1 from public.mission_progress_events where mission_id = old.id
  ) and (
    new.owner_id is distinct from old.owner_id
    or new.campaign_id is distinct from old.campaign_id
    or new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.mission_type is distinct from old.mission_type
    or new.goal_count is distinct from old.goal_count
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.reward_type is distinct from old.reward_type
    or new.reward_description is distinct from old.reward_description
    or new.reward_stamps is distinct from old.reward_stamps
    or new.max_completions is distinct from old.max_completions
  ) then
    raise exception 'Mission rules cannot be edited after customer progress begins. Pause the mission instead.';
  end if;

  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer
set search_path = public;

drop trigger if exists loyalty_mission_validate on public.loyalty_missions;
create trigger loyalty_mission_validate
  before insert or update on public.loyalty_missions
  for each row execute function public.validate_loyalty_mission();

create or replace function public.track_loyalty_mission_stamp()
returns trigger as $$
declare
  card_row public.issued_cards%rowtype;
  mission_row public.loyalty_missions%rowtype;
  event_count integer;
  completion_count integer;
  target_completion integer;
begin
  if new.type <> 'stamp_add' or new.amount <= 0 then
    return new;
  end if;

  delete from public.trusted_card_action_events where transaction_id = new.id;
  if not found then
    return new;
  end if;

  select * into card_row
  from public.issued_cards
  where id = new.card_id;
  if not found or card_row.campaign_id is null then
    return new;
  end if;

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

    insert into public.mission_progress_events (
      mission_id, transaction_id, customer_id, card_id, created_at
    ) values (
      mission_row.id, new.id, card_row.customer_id, card_row.id, new.created_at
    ) on conflict do nothing;

    if not found then
      continue;
    end if;

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
      and (
        (mission_row.mission_type = 'visit_count' and c.card_id is null)
        or (mission_row.mission_type = 'card_stamps' and c.card_id = card_row.id)
      );

    target_completion := least(
      floor(event_count::numeric / mission_row.goal_count)::integer,
      mission_row.max_completions
    );

    while completion_count < target_completion loop
      completion_count := completion_count + 1;
      insert into public.mission_completions (
        mission_id, customer_id,
        card_id, reward_type, completion_number, reward_description, reward_stamps
      ) values (
        mission_row.id,
        card_row.customer_id,
        case when mission_row.mission_type = 'visit_count' then null else card_row.id end,
        mission_row.reward_type,
        completion_count,
        mission_row.reward_description,
        mission_row.reward_stamps
      ) on conflict do nothing;
    end loop;
  end loop;

  return new;
end;
$$ language plpgsql security definer
set search_path = public;

drop trigger if exists transaction_tracks_loyalty_missions on public.transactions;
create trigger transaction_tracks_loyalty_missions
  after insert on public.transactions
  for each row execute function public.track_loyalty_mission_stamp();

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
    and (
      (mission_row.mission_type = 'visit_count' and c.card_id is null)
      or (mission_row.mission_type = 'card_stamps' and c.card_id = card_id_input)
    );

  if include_completions_input then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'completionNumber', c.completion_number,
      'rewardType', c.reward_type,
      'rewardDescription', c.reward_description,
      'rewardStamps', c.reward_stamps,
      'completedAt', c.completed_at,
      'redeemedAt', c.redeemed_at
    ) order by c.completion_number), '[]'::jsonb)
    into completion_payload
    from public.mission_completions c
    where c.mission_id = mission_row.id
      and c.customer_id = customer_id_input
      and (
        (mission_row.mission_type = 'visit_count' and c.card_id is null)
        or (mission_row.mission_type = 'card_stamps' and c.card_id = card_id_input)
      );
  else
    completion_payload := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', mission_row.id,
    'name', mission_row.name,
    'description', mission_row.description,
    'missionType', mission_row.mission_type,
    'goalCount', mission_row.goal_count,
    'progress', least(
      mission_row.goal_count,
      greatest(0, event_count - (completion_count * mission_row.goal_count))
    ),
    'completedCount', completion_count,
    'maxCompletions', mission_row.max_completions,
    'rewardType', mission_row.reward_type,
    'rewardDescription', mission_row.reward_description,
    'rewardStamps', mission_row.reward_stamps,
    'startsAt', mission_row.starts_at,
    'endsAt', mission_row.ends_at,
    'isActive', mission_row.is_active,
    'availableRewards', (
      select count(*)::integer from public.mission_completions c
      where c.mission_id = mission_row.id
        and c.customer_id = customer_id_input
        and c.redeemed_at is null
        and (
          (mission_row.mission_type = 'visit_count' and c.card_id is null)
          or (mission_row.mission_type = 'card_stamps' and c.card_id = card_id_input)
        )
    ),
    'completions', completion_payload
  );
end;
$$ language plpgsql security definer stable
set search_path = public;
revoke all on function public.mission_progress_payload(uuid, text, text, boolean) from public, anon, authenticated;

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
    'maxCompletions', m.max_completions,
    'isActive', m.is_active,
    'createdAt', m.created_at,
    'participantCount', (
      select count(distinct e.customer_id)::integer from public.mission_progress_events e
      where e.mission_id = m.id
    ),
    'completedCount', (
      select count(*)::integer from public.mission_completions c
      where c.mission_id = m.id
    ),
    'redeemedCount', (
      select count(*)::integer from public.mission_reward_redemptions r
      where r.mission_id = m.id
    )
  ) order by m.created_at desc), '[]'::jsonb)
  into result
  from public.loyalty_missions m
  where m.owner_id = actor_row.id;

  return result;
end;
$$ language plpgsql security definer stable
set search_path = public;
revoke all on function public.get_owner_loyalty_missions() from public, anon;
grant execute on function public.get_owner_loyalty_missions() to authenticated;

create or replace function public.get_card_loyalty_missions(card_id_input text)
returns jsonb as $$
declare
  actor_row public.profiles%rowtype;
  card_row public.issued_cards%rowtype;
  actor_owner_id uuid;
  result jsonb;
begin
  select * into actor_row from public.profiles where id = auth.uid();
  if not found or actor_row.access <> 'active' then raise exception 'Active authentication required.'; end if;
  actor_owner_id := case when actor_row.role = 'owner' then actor_row.id else actor_row.owner_id end;

  select * into card_row from public.issued_cards where id = card_id_input;
  if not found or actor_owner_id is null or card_row.owner_id <> actor_owner_id then
    raise exception 'Card not found for this account.';
  end if;

  select coalesce(jsonb_agg(
    public.mission_progress_payload(m.id, card_row.customer_id, card_row.id, true)
    order by m.ends_at asc
  ), '[]'::jsonb)
  into result
  from public.loyalty_missions m
  where m.owner_id = card_row.owner_id
    and m.campaign_id = card_row.campaign_id
    and (
      m.is_active
      or exists (
        select 1 from public.mission_completions c
        where c.mission_id = m.id and c.customer_id = card_row.customer_id
          and (c.card_id is null or c.card_id = card_row.id)
      )
    );

  return result;
end;
$$ language plpgsql security definer stable
set search_path = public;
revoke all on function public.get_card_loyalty_missions(text) from public, anon;
grant execute on function public.get_card_loyalty_missions(text) to authenticated;

create or replace function public.redeem_mission_reward(completion_id_input uuid)
returns jsonb as $$
declare
  actor_row public.profiles%rowtype;
  completion_row public.mission_completions%rowtype;
  mission_row public.loyalty_missions%rowtype;
  actor_owner_id uuid;
  redeemed_time timestamptz := clock_timestamp();
  reward_card public.issued_cards%rowtype;
  reward_tx public.transactions%rowtype;
  reward_total_stamps integer;
begin
  select * into actor_row from public.profiles where id = auth.uid();
  if not found or actor_row.access <> 'active' then raise exception 'Active authentication required.'; end if;
  actor_owner_id := case when actor_row.role = 'owner' then actor_row.id else actor_row.owner_id end;

  select * into completion_row
  from public.mission_completions
  where id = completion_id_input
  for update;
  if not found then raise exception 'Mission reward not found.'; end if;

  select * into mission_row from public.loyalty_missions where id = completion_row.mission_id;
  if not found or actor_owner_id is null or mission_row.owner_id <> actor_owner_id then
    raise exception 'Mission reward not found for this account.';
  end if;
  if completion_row.redeemed_at is not null then
    return jsonb_build_object(
      'success', true,
      'alreadyRedeemed', true,
      'completionId', completion_row.id,
      'redeemedAt', completion_row.redeemed_at,
      'redeemedBy', completion_row.redeemed_by,
      'rewardDescription', completion_row.reward_description,
      'rewardType', completion_row.reward_type
    );
  end if;

  if completion_row.reward_type = 'bonus_stamps' then
    select ic.* into reward_card
    from public.issued_cards ic
    join public.campaigns c on c.id = ic.campaign_id
    where ic.owner_id = actor_owner_id
      and ic.customer_id = completion_row.customer_id
      and ic.campaign_id = mission_row.campaign_id
      and ic.status = 'Active'
      and ic.stamps + completion_row.reward_stamps <= c.total_stamps
    order by case when ic.id = completion_row.card_id then 0 else 1 end,
      ic.last_visit desc, ic.created_at desc
    limit 1
    for update of ic skip locked;
    if not found then
      raise exception 'No active card has enough space for this bonus stamp reward.';
    end if;

    select c.total_stamps into reward_total_stamps
    from public.campaigns c where c.id = reward_card.campaign_id;
    update public.issued_cards
    set stamps = least(reward_total_stamps, reward_card.stamps + completion_row.reward_stamps)
    where id = reward_card.id
    returning * into reward_card;

    insert into public.transactions (
      id, card_id, type, amount, date, "timestamp", title, remarks,
      actor_id, actor_name, actor_role, created_at
    ) values (
      'mission-bonus-' || completion_row.id::text,
      reward_card.id,
      'mission_bonus',
      completion_row.reward_stamps,
      to_char(redeemed_time at time zone 'UTC', 'Mon FMDD, YYYY FMHH12:MI AM'),
      floor(extract(epoch from redeemed_time) * 1000)::bigint,
      'Mission bonus stamps',
      mission_row.name,
      auth.uid(),
      actor_row.business_name,
      actor_row.role,
      redeemed_time
    ) returning * into reward_tx;
  end if;

  update public.mission_completions
  set redeemed_at = redeemed_time,
      redeemed_by = auth.uid()
  where id = completion_row.id;

  insert into public.mission_reward_redemptions (
    completion_id, mission_id, customer_id, card_id,
    reward_type, reward_description, reward_stamps, redeemed_by, redeemed_at
  ) values (
    completion_row.id, mission_row.id, completion_row.customer_id,
    coalesce(reward_card.id, completion_row.card_id), completion_row.reward_type,
    completion_row.reward_description, completion_row.reward_stamps, auth.uid(), redeemed_time
  );

  return jsonb_build_object(
    'success', true,
    'completionId', completion_row.id,
    'redeemedAt', redeemed_time,
    'redeemedBy', auth.uid(),
    'rewardDescription', completion_row.reward_description,
    'rewardType', completion_row.reward_type,
    'card', case when reward_card.id is null then null else jsonb_build_object(
      'id', reward_card.id, 'stamps', reward_card.stamps, 'status', reward_card.status,
      'completedDate', reward_card.completed_date, 'lastVisit', reward_card.last_visit
    ) end,
    'transaction', case when reward_tx.id is null then null else jsonb_build_object(
      'id', reward_tx.id, 'type', reward_tx.type, 'amount', reward_tx.amount,
      'date', reward_tx.date, 'timestamp', reward_tx."timestamp", 'title', reward_tx.title,
      'remarks', reward_tx.remarks, 'actorId', reward_tx.actor_id,
      'actorName', reward_tx.actor_name, 'actorRole', reward_tx.actor_role
    ) end
  );
end;
$$ language plpgsql security definer
set search_path = public;
revoke all on function public.redeem_mission_reward(uuid) from public, anon;
grant execute on function public.redeem_mission_reward(uuid) to authenticated;

create or replace function public.record_card_action(
  card_id_input text,
  transaction_id_input text,
  action_input text,
  remarks_input text default null
)
returns jsonb as $$
declare
  actor_row public.profiles%rowtype;
  card_row public.issued_cards%rowtype;
  existing_tx public.transactions%rowtype;
  actor_owner_id uuid;
  action_time timestamptz := clock_timestamp();
  transaction_type text;
  transaction_amount integer;
  transaction_title text;
  transaction_row public.transactions%rowtype;
  total_stamps integer;
begin
  select * into actor_row from public.profiles where id = auth.uid();
  if not found then raise exception 'Authentication required.'; end if;
  actor_owner_id := case when actor_row.role = 'owner' then actor_row.id else actor_row.owner_id end;

  select * into card_row
  from public.issued_cards
  where id = card_id_input
  for update;
  if not found or actor_owner_id is null or card_row.owner_id <> actor_owner_id then
    raise exception 'Card not found for this account.';
  end if;

  if action_input not in ('issued', 'stamp_add', 'stamp_remove', 'redeem') then
    raise exception 'Unsupported card action.';
  end if;
  if transaction_id_input is null or length(trim(transaction_id_input)) = 0 or length(transaction_id_input) > 100 then
    raise exception 'A valid transaction id is required.';
  end if;

  select * into existing_tx from public.transactions where id = transaction_id_input;
  if found then
    if existing_tx.card_id <> card_id_input or existing_tx.type <> action_input then
      raise exception 'Transaction id has already been used.';
    end if;
    return jsonb_build_object(
      'success', true,
      'card', jsonb_build_object(
        'stamps', card_row.stamps, 'status', card_row.status,
        'completedDate', card_row.completed_date, 'lastVisit', card_row.last_visit
      ),
      'transaction', jsonb_build_object(
        'id', existing_tx.id, 'type', existing_tx.type, 'amount', existing_tx.amount,
        'date', existing_tx.date, 'timestamp', existing_tx."timestamp", 'title', existing_tx.title,
        'remarks', existing_tx.remarks, 'actorId', existing_tx.actor_id,
        'actorName', existing_tx.actor_name, 'actorRole', existing_tx.actor_role
      )
    );
  end if;

  if action_input = 'issued' then
    if card_row.created_at < action_time - interval '5 minutes'
      or exists (select 1 from public.transactions t where t.card_id = card_row.id and t.type = 'issued') then
      raise exception 'Card issuance has already been recorded.';
    end if;
    transaction_type := 'issued';
    transaction_amount := 0;
    transaction_title := 'Card Issued';
  elsif action_input = 'stamp_add' then
    select c.total_stamps into total_stamps from public.campaigns c where c.id = card_row.campaign_id;
    if card_row.status <> 'Active' or total_stamps is null or card_row.stamps >= total_stamps then
      raise exception 'Card cannot receive another stamp.';
    end if;
    update public.issued_cards
    set stamps = card_row.stamps + 1, last_visit = (action_time at time zone 'UTC')::date
    where id = card_row.id
    returning * into card_row;
    transaction_type := 'stamp_add';
    transaction_amount := 1;
    transaction_title := 'Stamp Collected';
  elsif action_input = 'stamp_remove' then
    if card_row.status <> 'Active' or card_row.stamps <= 0 then
      raise exception 'Card has no removable stamp.';
    end if;
    update public.issued_cards set stamps = card_row.stamps - 1
    where id = card_row.id returning * into card_row;
    transaction_type := 'stamp_remove';
    transaction_amount := -1;
    transaction_title := 'Stamp Removed';
  else
    select c.total_stamps into total_stamps from public.campaigns c where c.id = card_row.campaign_id;
    if card_row.status <> 'Active' or total_stamps is null or card_row.stamps < total_stamps then
      raise exception 'Card is not eligible for redemption.';
    end if;
    update public.issued_cards
    set status = 'Redeemed', completed_date = (action_time at time zone 'UTC')::date
    where id = card_row.id returning * into card_row;
    transaction_type := 'redeem';
    transaction_amount := 0;
    transaction_title := 'Reward Redeemed';
  end if;

  if action_input = 'stamp_add' then
    insert into public.trusted_card_action_events (transaction_id, created_at)
    values (transaction_id_input, action_time);
  end if;

  insert into public.transactions (
    id, card_id, type, amount, date, "timestamp", title, remarks,
    actor_id, actor_name, actor_role, created_at
  ) values (
    transaction_id_input, card_row.id, transaction_type, transaction_amount,
    to_char(action_time at time zone 'UTC', 'Mon FMDD, YYYY FMHH12:MI AM'),
    floor(extract(epoch from action_time) * 1000)::bigint,
    transaction_title, nullif(trim(coalesce(remarks_input, '')), ''),
    auth.uid(), actor_row.business_name, actor_row.role, action_time
  ) returning * into transaction_row;

  return jsonb_build_object(
    'success', true,
    'card', jsonb_build_object(
      'stamps', card_row.stamps, 'status', card_row.status,
      'completedDate', card_row.completed_date, 'lastVisit', card_row.last_visit
    ),
    'transaction', jsonb_build_object(
      'id', transaction_row.id, 'type', transaction_row.type, 'amount', transaction_row.amount,
      'date', transaction_row.date, 'timestamp', transaction_row."timestamp", 'title', transaction_row.title,
      'remarks', transaction_row.remarks, 'actorId', transaction_row.actor_id,
      'actorName', transaction_row.actor_name, 'actorRole', transaction_row.actor_role
    )
  );
end;
$$ language plpgsql security definer
set search_path = public;
revoke all on function public.record_card_action(text, text, text, text) from public, anon;
grant execute on function public.record_card_action(text, text, text, text) to authenticated;

create or replace function public.get_public_card(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_row record;
  card_row record;
  customer_row record;
  campaign_payload jsonb;
  history_data jsonb;
  missions_payload jsonb;
begin
  select id, slug, business_name into owner_row
  from public.profiles where slug = slug_input and role = 'owner';
  if not found then return null; end if;

  select * into card_row
  from public.issued_cards where unique_id = card_unique_id and owner_id = owner_row.id;
  if not found then return null; end if;

  select * into customer_row
  from public.customers where id = card_row.customer_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'reward_name', c.reward_name, 'tagline', c.tagline,
    'background_image', c.background_image, 'background_opacity', c.background_opacity,
    'logo_image', c.logo_image, 'show_logo', c.show_logo, 'title_size', c.title_size,
    'icon_key', c.icon_key, 'colors', c.colors,
    'total_stamps', c.total_stamps, 'social', c.social
  ) into campaign_payload
  from public.campaigns c where c.id = card_row.campaign_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'type', t.type, 'amount', t.amount,
    'date', t.date, 'timestamp', t."timestamp", 'title', t.title
  ) order by t."timestamp"), '[]'::jsonb)
  into history_data
  from public.transactions t where t.card_id = card_row.id;

  select coalesce(jsonb_agg(
    public.mission_progress_payload(m.id, card_row.customer_id, card_row.id, false)
    order by m.ends_at asc
  ), '[]'::jsonb)
  into missions_payload
  from public.loyalty_missions m
  where m.owner_id = owner_row.id
    and m.campaign_id = card_row.campaign_id
    and (
      m.is_active
      or exists (
        select 1 from public.mission_completions c
        where c.mission_id = m.id and c.customer_id = card_row.customer_id
          and (c.card_id is null or c.card_id = card_row.id)
      )
    );

  return jsonb_build_object(
    'card', jsonb_build_object(
      'id', card_row.id, 'uniqueId', card_row.unique_id,
      'campaignId', card_row.campaign_id, 'campaignName', card_row.campaign_name,
      'stamps', card_row.stamps, 'lastVisit', card_row.last_visit,
      'status', card_row.status, 'completedDate', card_row.completed_date,
      'templateSnapshot', card_row.template_snapshot, 'history', history_data
    ),
    'customer', jsonb_build_object('id', customer_row.id, 'name', customer_row.name),
    'campaign', campaign_payload,
    'missions', missions_payload
  );
end;
$$ language plpgsql security definer
set search_path = public;
grant execute on function public.get_public_card(text, uuid) to anon, authenticated;
