-- Phase 2: auditable points, configurable levels, and customer milestones.
-- Apply after supabase/legacy-patches/add_loyalty_missions.sql.

create table if not exists public.loyalty_points_programs (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  is_enabled boolean not null default false,
  points_per_visit integer not null default 10 check (points_per_visit between 1 and 10000),
  updated_at timestamptz not null default now()
);

alter table public.loyalty_points_programs enable row level security;
revoke all on public.loyalty_points_programs from public, anon, authenticated;

create table if not exists public.loyalty_point_levels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 50),
  min_points integer not null check (min_points between 0 and 100000000),
  benefit text not null check (length(trim(benefit)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (owner_id, min_points)
);

create index if not exists loyalty_point_levels_owner_min_idx
  on public.loyalty_point_levels(owner_id, min_points);
alter table public.loyalty_point_levels enable row level security;
revoke all on public.loyalty_point_levels from public, anon, authenticated;

create table if not exists public.customer_loyalty_points_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  card_id text references public.issued_cards(id) on delete set null,
  source_transaction_id text references public.transactions(id) on delete set null,
  reverses_entry_id uuid references public.customer_loyalty_points_ledger(id) on delete set null,
  entry_type text not null check (entry_type in ('visit', 'visit_reversal', 'manual_adjustment')),
  points_delta integer not null check (
    points_delta between -1000000 and 1000000
    and (points_delta <> 0 or entry_type = 'visit_reversal')
  ),
  idempotency_key text not null,
  description text not null check (length(trim(description)) between 1 and 250),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key),
  constraint loyalty_points_entry_shape check (
    (entry_type = 'visit' and points_delta > 0 and source_transaction_id is not null and reverses_entry_id is null)
    or (entry_type = 'visit_reversal' and points_delta <= 0 and source_transaction_id is not null and reverses_entry_id is not null)
    or (entry_type = 'manual_adjustment' and source_transaction_id is null and reverses_entry_id is null)
  )
);

create unique index if not exists loyalty_points_source_transaction_unique
  on public.customer_loyalty_points_ledger(owner_id, source_transaction_id)
  where source_transaction_id is not null;
create unique index if not exists loyalty_points_reversal_unique
  on public.customer_loyalty_points_ledger(reverses_entry_id)
  where reverses_entry_id is not null;
create index if not exists customer_loyalty_points_customer_created_idx
  on public.customer_loyalty_points_ledger(owner_id, customer_id, created_at desc);
alter table public.customer_loyalty_points_ledger enable row level security;
revoke all on public.customer_loyalty_points_ledger from public, anon, authenticated;

create table if not exists public.customer_loyalty_badges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  badge_key text not null check (badge_key in ('first_visit', 'mission_completion')),
  source_key text not null,
  earned_at timestamptz not null default now(),
  unique (owner_id, customer_id, badge_key, source_key)
);

create index if not exists customer_loyalty_badges_customer_earned_idx
  on public.customer_loyalty_badges(owner_id, customer_id, earned_at desc);
alter table public.customer_loyalty_badges enable row level security;
revoke all on public.customer_loyalty_badges from public, anon, authenticated;

create or replace function public.get_owner_loyalty_points_configuration()
returns jsonb as $$
declare
  owner_id_value uuid;
  program_row public.loyalty_points_programs%rowtype;
  levels_payload jsonb;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;

  select * into program_row
  from public.loyalty_points_programs p
  where p.owner_id = owner_id_value;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', l.name, 'minPoints', l.min_points, 'benefit', l.benefit
  ) order by l.min_points), '[]'::jsonb)
  into levels_payload
  from public.loyalty_point_levels l
  where l.owner_id = owner_id_value;

  return jsonb_build_object(
    'isEnabled', coalesce(program_row.is_enabled, false),
    'pointsPerVisit', coalesce(program_row.points_per_visit, 10),
    'levels', levels_payload
  );
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_owner_loyalty_points_configuration() from public, anon;
grant execute on function public.get_owner_loyalty_points_configuration() to authenticated;

create or replace function public.save_owner_loyalty_points_configuration(
  is_enabled_input boolean,
  points_per_visit_input integer,
  levels_input jsonb
)
returns jsonb as $$
declare
  owner_id_value uuid;
  level_row record;
  level_count integer;
  previous_min_points integer := -1;
  clean_name text;
  clean_benefit text;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;
  if points_per_visit_input not between 1 and 10000 then
    raise exception 'Points per visit must be between 1 and 10000.';
  end if;
  if jsonb_typeof(levels_input) <> 'array' then raise exception 'At least one loyalty level is required.'; end if;

  select count(*) into level_count
  from jsonb_to_recordset(levels_input) as x(name text, min_points integer, benefit text);
  if level_count < 1 or level_count > 10 then raise exception 'Configure between 1 and 10 loyalty levels.'; end if;

  for level_row in
    select * from jsonb_to_recordset(levels_input) as x(name text, min_points integer, benefit text)
    order by min_points
  loop
    clean_name := trim(coalesce(level_row.name, ''));
    clean_benefit := trim(coalesce(level_row.benefit, ''));
    if length(clean_name) not between 1 and 50
      or length(clean_benefit) not between 1 and 200
      or level_row.min_points not between 0 and 100000000
      or level_row.min_points <= previous_min_points then
      raise exception 'Level names, benefits, and point thresholds must be valid and strictly increasing.';
    end if;
    previous_min_points := level_row.min_points;
  end loop;
  if not exists (
    select 1 from jsonb_to_recordset(levels_input) as x(name text, min_points integer, benefit text)
    where min_points = 0
  ) then raise exception 'The first loyalty level must start at 0 points.'; end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('loyalty-levels'));

  insert into public.loyalty_points_programs(owner_id, is_enabled, points_per_visit, updated_at)
  values (owner_id_value, coalesce(is_enabled_input, false), points_per_visit_input, now())
  on conflict (owner_id) do update
    set is_enabled = excluded.is_enabled,
        points_per_visit = excluded.points_per_visit,
        updated_at = excluded.updated_at;

  delete from public.loyalty_point_levels where owner_id = owner_id_value;
  insert into public.loyalty_point_levels(owner_id, name, min_points, benefit)
  select owner_id_value, trim(x.name), x.min_points, trim(x.benefit)
  from jsonb_to_recordset(levels_input) as x(name text, min_points integer, benefit text);

  return public.get_owner_loyalty_points_configuration();
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.save_owner_loyalty_points_configuration(boolean, integer, jsonb) from public, anon;
grant execute on function public.save_owner_loyalty_points_configuration(boolean, integer, jsonb) to authenticated;

create or replace function public.get_owner_loyalty_point_customers()
returns jsonb as $$
declare
  owner_id_value uuid;
  customers_payload jsonb;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'balance', coalesce(point_balance.balance, 0)
  ) order by c.name), '[]'::jsonb)
  into customers_payload
  from public.customers c
  left join lateral (
    select sum(l.points_delta)::bigint as balance
    from public.customer_loyalty_points_ledger l
    where l.owner_id = owner_id_value and l.customer_id = c.id
  ) point_balance on true
  where c.owner_id = owner_id_value;

  return customers_payload;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_owner_loyalty_point_customers() from public, anon;
grant execute on function public.get_owner_loyalty_point_customers() to authenticated;

create or replace function public.adjust_customer_loyalty_points(
  customer_id_input text,
  points_delta_input integer,
  reason_input text,
  idempotency_key_input text
)
returns jsonb as $$
declare
  owner_id_value uuid;
  customer_row public.customers%rowtype;
  existing_entry public.customer_loyalty_points_ledger%rowtype;
  balance_value bigint;
  reason_value text := trim(coalesce(reason_input, ''));
  idempotency_value text := trim(coalesce(idempotency_key_input, ''));
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;
  if points_delta_input is null or points_delta_input = 0 or abs(points_delta_input) > 100000 then
    raise exception 'Point adjustment must be a non-zero value up to 100000 points.';
  end if;
  if length(reason_value) not between 3 and 250 then
    raise exception 'Enter a customer-facing reason between 3 and 250 characters.';
  end if;
  if length(idempotency_value) not between 1 and 100 then raise exception 'A valid adjustment key is required.'; end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('adjust:' || idempotency_value));
  select * into existing_entry
  from public.customer_loyalty_points_ledger l
  where l.owner_id = owner_id_value and l.idempotency_key = idempotency_value;
  if found then
    if existing_entry.customer_id <> customer_id_input
      or existing_entry.points_delta <> points_delta_input
      or existing_entry.description <> reason_value then
      raise exception 'Adjustment key was already used with different values.';
    end if;
    select coalesce(sum(l.points_delta), 0)::bigint into balance_value
    from public.customer_loyalty_points_ledger l
    where l.owner_id = owner_id_value and l.customer_id = customer_id_input;
    return jsonb_build_object('success', true, 'balance', balance_value, 'alreadyApplied', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext(customer_id_input));
  select * into customer_row
  from public.customers c
  where c.id = customer_id_input and c.owner_id = owner_id_value
  for update;
  if not found then raise exception 'Customer not found for this business.'; end if;

  select coalesce(sum(l.points_delta), 0)::bigint into balance_value
  from public.customer_loyalty_points_ledger l
  where l.owner_id = owner_id_value and l.customer_id = customer_id_input;
  if balance_value + points_delta_input < 0 then raise exception 'Adjustment cannot make the point balance negative.'; end if;

  insert into public.customer_loyalty_points_ledger(
    owner_id, customer_id, entry_type, points_delta, idempotency_key, description, actor_id
  ) values (
    owner_id_value, customer_id_input, 'manual_adjustment', points_delta_input,
    idempotency_value, reason_value, auth.uid()
  );
  balance_value := balance_value + points_delta_input;
  return jsonb_build_object('success', true, 'balance', balance_value, 'alreadyApplied', false);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.adjust_customer_loyalty_points(text, integer, text, text) from public, anon;
grant execute on function public.adjust_customer_loyalty_points(text, integer, text, text) to authenticated;

create or replace function public.customer_loyalty_points_payload(owner_id_input uuid, customer_id_input text)
returns jsonb as $$
declare
  program_row public.loyalty_points_programs%rowtype;
  balance_value bigint;
  current_level jsonb;
  next_level jsonb;
  current_min_points integer := 0;
  next_min_points integer;
  points_to_next integer;
  progress_percent integer := 100;
  history_payload jsonb;
  badges_payload jsonb;
begin
  select * into program_row
  from public.loyalty_points_programs p
  where p.owner_id = owner_id_input;
  if not found and not exists (
    select 1 from public.customer_loyalty_points_ledger l
    where l.owner_id = owner_id_input and l.customer_id = customer_id_input
  ) then
    return null;
  end if;

  select coalesce(sum(l.points_delta), 0)::bigint into balance_value
  from public.customer_loyalty_points_ledger l
  where l.owner_id = owner_id_input and l.customer_id = customer_id_input;

  select jsonb_build_object('name', l.name, 'minPoints', l.min_points, 'benefit', l.benefit), l.min_points
  into current_level, current_min_points
  from public.loyalty_point_levels l
  where l.owner_id = owner_id_input and l.min_points <= balance_value
  order by l.min_points desc limit 1;

  select jsonb_build_object('name', l.name, 'minPoints', l.min_points, 'benefit', l.benefit), l.min_points
  into next_level, next_min_points
  from public.loyalty_point_levels l
  where l.owner_id = owner_id_input and l.min_points > balance_value
  order by l.min_points asc limit 1;

  if next_min_points is not null then
    points_to_next := greatest(0, next_min_points - balance_value);
    progress_percent := least(100, greatest(0,
      floor(((balance_value - current_min_points)::numeric / nullif(next_min_points - current_min_points, 0)) * 100)::integer
    ));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entryType', h.entry_type,
    'pointsDelta', h.points_delta,
    'description', h.description,
    'createdAt', h.created_at
  ) order by h.created_at desc), '[]'::jsonb)
  into history_payload
  from (
    select l.entry_type, l.points_delta, l.description, l.created_at
    from public.customer_loyalty_points_ledger l
    where l.owner_id = owner_id_input and l.customer_id = customer_id_input
    order by l.created_at desc limit 20
  ) h;

  select coalesce(jsonb_agg(jsonb_build_object(
    'badgeKey', b.badge_key,
    'earnedAt', b.earned_at
  ) order by b.earned_at desc), '[]'::jsonb)
  into badges_payload
  from (
    select badge_key, earned_at
    from public.customer_loyalty_badges
    where owner_id = owner_id_input and customer_id = customer_id_input
    order by earned_at desc limit 20
  ) b;

  return jsonb_build_object(
    'isEnabled', coalesce(program_row.is_enabled, false),
    'balance', balance_value,
    'currentLevel', current_level,
    'nextLevel', next_level,
    'pointsToNextLevel', points_to_next,
    'progressPercent', progress_percent,
    'history', history_payload,
    'badges', badges_payload
  );
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.customer_loyalty_points_payload(uuid, text) from public, anon, authenticated;

create or replace function public.get_public_loyalty_points(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_id_value uuid;
  customer_id_value text;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.slug = slug_input and p.role = 'owner';
  if owner_id_value is null then return null; end if;

  select c.customer_id into customer_id_value
  from public.issued_cards c
  where c.unique_id = card_unique_id and c.owner_id = owner_id_value;
  if customer_id_value is null then return null; end if;

  return public.customer_loyalty_points_payload(owner_id_value, customer_id_value);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_public_loyalty_points(text, uuid) from public;
grant execute on function public.get_public_loyalty_points(text, uuid) to anon, authenticated;

create or replace function public.track_loyalty_points()
returns trigger as $$
declare
  card_row public.issued_cards%rowtype;
  program_row public.loyalty_points_programs%rowtype;
  credit_row public.customer_loyalty_points_ledger%rowtype;
  current_balance bigint;
  reversal_amount integer;
  trusted_action boolean := false;
begin
  if new.type not in ('stamp_add', 'stamp_remove') then return new; end if;

  if new.type = 'stamp_add' then
    select exists (
      select 1 from public.trusted_card_action_events e where e.transaction_id = new.id
    ) into trusted_action;
    if not trusted_action or new.amount <= 0 then return new; end if;
  else
    delete from public.trusted_card_action_events e
    where e.transaction_id = new.id;
    if not found then return new; end if;
  end if;

  select * into card_row from public.issued_cards c where c.id = new.card_id;
  if not found or card_row.campaign_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext(card_row.owner_id::text), hashtext(card_row.customer_id));

  if new.type = 'stamp_add' then
    select * into program_row
    from public.loyalty_points_programs p
    where p.owner_id = card_row.owner_id and p.is_enabled;
    if not found then return new; end if;

    insert into public.customer_loyalty_points_ledger(
      owner_id, customer_id, card_id, source_transaction_id, entry_type,
      points_delta, idempotency_key, description, actor_id, created_at
    ) values (
      card_row.owner_id, card_row.customer_id, card_row.id, new.id, 'visit',
      program_row.points_per_visit * new.amount, 'visit:' || new.id,
      'Verified visit', new.actor_id, new.created_at
    ) on conflict do nothing;

    if found then
      insert into public.customer_loyalty_badges(owner_id, customer_id, badge_key, source_key, earned_at)
      values (card_row.owner_id, card_row.customer_id, 'first_visit', 'first', new.created_at)
      on conflict do nothing;
    end if;
    return new;
  end if;

  select * into credit_row
  from public.customer_loyalty_points_ledger l
  where l.owner_id = card_row.owner_id
    and l.customer_id = card_row.customer_id
    and l.card_id = card_row.id
    and l.entry_type = 'visit'
    and l.points_delta > 0
    and not exists (
      select 1 from public.customer_loyalty_points_ledger reversal
      where reversal.reverses_entry_id = l.id
    )
  order by l.created_at desc
  limit 1
  for update;
  if not found then return new; end if;

  select coalesce(sum(l.points_delta), 0)::integer into current_balance
  from public.customer_loyalty_points_ledger l
  where l.owner_id = card_row.owner_id and l.customer_id = card_row.customer_id;
  reversal_amount := least(credit_row.points_delta, greatest(current_balance, 0));
  insert into public.customer_loyalty_points_ledger(
    owner_id, customer_id, card_id, source_transaction_id, reverses_entry_id,
    entry_type, points_delta, idempotency_key, description, actor_id, created_at
  ) values (
    card_row.owner_id, card_row.customer_id, card_row.id, new.id, credit_row.id,
    'visit_reversal', -reversal_amount, 'reversal:' || new.id,
    'Removed stamp', new.actor_id, new.created_at
  ) on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.track_loyalty_points() from public, anon, authenticated;
drop trigger if exists transaction_points_before_missions on public.transactions;
create trigger transaction_points_before_missions
  after insert on public.transactions
  for each row execute function public.track_loyalty_points();

create or replace function public.award_mission_completion_badge()
returns trigger as $$
begin
  insert into public.customer_loyalty_badges(owner_id, customer_id, badge_key, source_key, earned_at)
  select m.owner_id, new.customer_id, 'mission_completion', new.id::text, new.completed_at
  from public.loyalty_missions m
  join public.loyalty_points_programs p on p.owner_id = m.owner_id and p.is_enabled
  where m.id = new.mission_id
  on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.award_mission_completion_badge() from public, anon, authenticated;
drop trigger if exists mission_completion_awards_loyalty_badge on public.mission_completions;
create trigger mission_completion_awards_loyalty_badge
  after insert on public.mission_completions
  for each row execute function public.award_mission_completion_badge();

-- The owner-only RPC keeps point adjustments immutable, idempotent, and auditable.
-- Stamp additions and removals remain trusted only when created by record_card_action.
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
    where id = card_row.id returning * into card_row;
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

  if action_input in ('stamp_add', 'stamp_remove') then
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
