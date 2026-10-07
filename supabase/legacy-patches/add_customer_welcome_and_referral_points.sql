-- Add customer welcome points and campaign referral rewards.
-- Apply after add_loyalty_points.sql and add_loyalty_rewards.sql.

alter table public.loyalty_points_programs
  add column if not exists welcome_points integer not null default 0;

alter table public.loyalty_points_programs
  drop constraint if exists loyalty_points_welcome_points_range;
alter table public.loyalty_points_programs
  add constraint loyalty_points_welcome_points_range
  check (welcome_points = 0 or welcome_points between 2 and 100000);

create table if not exists public.customer_referral_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  referrer_customer_id text not null references public.customers(id) on delete cascade,
  referral_code uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (owner_id, campaign_id, referrer_customer_id)
);

create index if not exists customer_referral_links_lookup_idx
  on public.customer_referral_links(owner_id, campaign_id, referral_code);
alter table public.customer_referral_links enable row level security;
revoke all on public.customer_referral_links from public, anon, authenticated;

create table if not exists public.customer_referrals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id text not null,
  referral_link_id uuid references public.customer_referral_links(id) on delete set null,
  referrer_customer_id text not null references public.customers(id) on delete cascade,
  referred_customer_id text not null references public.customers(id) on delete cascade,
  signup_card_id text references public.issued_cards(id) on delete set null,
  referrer_points integer not null check (referrer_points between 0 and 50000),
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  qualifying_transaction_id text,
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  unique (owner_id, referred_customer_id),
  check (referrer_customer_id <> referred_customer_id)
);

create index if not exists customer_referrals_pending_idx
  on public.customer_referrals(owner_id, referred_customer_id, signup_card_id)
  where status = 'pending';
create unique index if not exists customer_referrals_qualifying_transaction_unique
  on public.customer_referrals(qualifying_transaction_id)
  where qualifying_transaction_id is not null;
alter table public.customer_referrals enable row level security;
revoke all on public.customer_referrals from public, anon, authenticated;

alter table public.customer_loyalty_points_ledger
  drop constraint if exists customer_loyalty_points_ledger_entry_type_check;
alter table public.customer_loyalty_points_ledger
  drop constraint if exists loyalty_points_entry_type_check;
alter table public.customer_loyalty_points_ledger
  add constraint loyalty_points_entry_type_check
  check (entry_type in ('visit', 'visit_reversal', 'manual_adjustment', 'reward_redemption', 'reward_refund', 'welcome_bonus', 'referral_reward'));

alter table public.customer_loyalty_points_ledger
  drop constraint if exists loyalty_points_entry_shape;
alter table public.customer_loyalty_points_ledger
  add constraint loyalty_points_entry_shape check (
    (entry_type = 'visit' and points_delta > 0 and source_transaction_id is not null and reverses_entry_id is null and reward_redemption_id is null)
    or (entry_type = 'visit_reversal' and points_delta <= 0 and source_transaction_id is not null and reverses_entry_id is not null and reward_redemption_id is null)
    or (entry_type = 'manual_adjustment' and points_delta <> 0 and source_transaction_id is null and reverses_entry_id is null and reward_redemption_id is null)
    or (entry_type = 'reward_redemption' and points_delta < 0 and source_transaction_id is null and reverses_entry_id is null and reward_redemption_id is not null)
    or (entry_type = 'reward_refund' and points_delta > 0 and source_transaction_id is null and reverses_entry_id is not null and reward_redemption_id is not null)
    or (entry_type in ('welcome_bonus', 'referral_reward') and points_delta > 0 and source_transaction_id is null and reverses_entry_id is null and reward_redemption_id is null)
  );

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
    'welcomePoints', coalesce(program_row.welcome_points, 0),
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
  welcome_points_input integer,
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
  if welcome_points_input is null or (welcome_points_input <> 0 and welcome_points_input not between 2 and 100000) then
    raise exception 'Welcome points must be 0 or between 2 and 100000.';
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

  insert into public.loyalty_points_programs(owner_id, is_enabled, points_per_visit, welcome_points, updated_at)
  values (owner_id_value, coalesce(is_enabled_input, false), points_per_visit_input, welcome_points_input, now())
  on conflict (owner_id) do update
    set is_enabled = excluded.is_enabled,
        points_per_visit = excluded.points_per_visit,
        welcome_points = excluded.welcome_points,
        updated_at = excluded.updated_at;

  delete from public.loyalty_point_levels where owner_id = owner_id_value;
  insert into public.loyalty_point_levels(owner_id, name, min_points, benefit)
  select owner_id_value, trim(x.name), x.min_points, trim(x.benefit)
  from jsonb_to_recordset(levels_input) as x(name text, min_points integer, benefit text);

  return public.get_owner_loyalty_points_configuration();
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.save_owner_loyalty_points_configuration(boolean, integer, integer, jsonb) from public, anon;
grant execute on function public.save_owner_loyalty_points_configuration(boolean, integer, integer, jsonb) to authenticated;

-- Keep the prior RPC signature working for an already-open or cached frontend.
create or replace function public.save_owner_loyalty_points_configuration(
  is_enabled_input boolean,
  points_per_visit_input integer,
  levels_input jsonb
)
returns jsonb as $$
declare
  owner_id_value uuid;
  welcome_points_value integer := 0;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid() and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active owner authentication required.'; end if;

  select p.welcome_points into welcome_points_value
  from public.loyalty_points_programs p
  where p.owner_id = owner_id_value;

  return public.save_owner_loyalty_points_configuration(
    is_enabled_input,
    points_per_visit_input,
    coalesce(welcome_points_value, 0),
    levels_input
  );
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.save_owner_loyalty_points_configuration(boolean, integer, jsonb) from public, anon;
grant execute on function public.save_owner_loyalty_points_configuration(boolean, integer, jsonb) to authenticated;

create or replace function public.get_public_campaign_signup_context(slug_input text, campaign_id_input text)
returns jsonb as $$
declare
  owner_row record;
  campaign_row record;
  points_enabled_value boolean := false;
  welcome_points_value integer := 0;
begin
  select id, slug, business_name
  into owner_row
  from public.profiles
  where slug = slug_input and role = 'owner';
  if not found then return null; end if;

  select id, name, is_enabled
  into campaign_row
  from public.campaigns
  where id = campaign_id_input
    and owner_id = owner_row.id;
  if not found then return null; end if;

  select p.is_enabled, p.welcome_points
  into points_enabled_value, welcome_points_value
  from public.loyalty_points_programs p
  where p.owner_id = owner_row.id;
  if not found then
    points_enabled_value := false;
    welcome_points_value := 0;
  end if;

  return jsonb_build_object(
    'owner', jsonb_build_object(
      'id', owner_row.id,
      'slug', owner_row.slug,
      'businessName', owner_row.business_name
    ),
    'campaign', jsonb_build_object(
      'id', campaign_row.id,
      'name', campaign_row.name,
      'isEnabled', campaign_row.is_enabled
    ),
    'pointsEnabled', coalesce(points_enabled_value, false),
    'welcomePoints', coalesce(welcome_points_value, 0)
  );
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_public_campaign_signup_context(text, text) from public;
grant execute on function public.get_public_campaign_signup_context(text, text) to anon, authenticated;

create or replace function public.get_public_referral_link(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_id_value uuid;
  card_row record;
  campaign_row record;
  points_enabled_value boolean := false;
  welcome_points_value integer := 0;
  referral_code_value uuid;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.slug = slug_input and p.role = 'owner';
  if owner_id_value is null then return null; end if;

  select c.id, c.campaign_id, c.customer_id, c.status
  into card_row
  from public.issued_cards c
  where c.unique_id = card_unique_id and c.owner_id = owner_id_value;
  if not found or card_row.campaign_id is null then return null; end if;

  select c.id, c.is_enabled
  into campaign_row
  from public.campaigns c
  where c.id = card_row.campaign_id and c.owner_id = owner_id_value;
  if not found or not coalesce(campaign_row.is_enabled, false) then return null; end if;

  select p.is_enabled, p.welcome_points
  into points_enabled_value, welcome_points_value
  from public.loyalty_points_programs p
  where p.owner_id = owner_id_value;
  if not found or not coalesce(points_enabled_value, false) or coalesce(welcome_points_value, 0) < 2 then
    return null;
  end if;

  insert into public.customer_referral_links(owner_id, campaign_id, referrer_customer_id)
  values (owner_id_value, card_row.campaign_id, card_row.customer_id)
  on conflict (owner_id, campaign_id, referrer_customer_id) do nothing;

  select l.referral_code into referral_code_value
  from public.customer_referral_links l
  where l.owner_id = owner_id_value
    and l.campaign_id = card_row.campaign_id
    and l.referrer_customer_id = card_row.customer_id;

  return jsonb_build_object('referralCode', referral_code_value::text);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_public_referral_link(text, uuid) from public;
grant execute on function public.get_public_referral_link(text, uuid) to anon, authenticated;

drop function if exists public.register_public_campaign_signup(text, text, text, text, text);
create or replace function public.register_public_campaign_signup(
  slug_input text,
  campaign_id_input text,
  customer_name_input text,
  customer_email_input text default null,
  customer_mobile_input text default null,
  referral_code_input text default null
)
returns jsonb as $$
declare
  owner_row record;
  campaign_row public.campaigns%rowtype;
  customer_row public.customers%rowtype;
  referral_link_row public.customer_referral_links%rowtype;
  existing_card_row record;
  points_program_row public.loyalty_points_programs%rowtype;
  normalized_name text;
  normalized_email text;
  normalized_mobile text;
  normalized_referral_code text;
  now_ts timestamptz := now();
  new_card_id text;
  new_unique_id uuid;
  is_new_customer boolean := false;
  welcome_points_value integer := 0;
  referrer_points_value integer := 0;
begin
  normalized_name := trim(coalesce(customer_name_input, ''));
  normalized_email := nullif(lower(trim(coalesce(customer_email_input, ''))), '');
  normalized_mobile := nullif(regexp_replace(coalesce(customer_mobile_input, ''), '[^0-9]+', '', 'g'), '');
  normalized_referral_code := nullif(trim(coalesce(referral_code_input, '')), '');

  if normalized_name = '' then
    return jsonb_build_object('outcome', 'error', 'error', 'Name is required.');
  end if;

  select id, slug, business_name
  into owner_row
  from public.profiles
  where slug = slug_input and role = 'owner';
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Business not found.');
  end if;

  select * into campaign_row
  from public.campaigns
  where id = campaign_id_input and owner_id = owner_row.id;
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Campaign not found.');
  end if;

  if normalized_email is not null then
    perform pg_advisory_xact_lock(hashtext(owner_row.id::text), hashtext('signup-email:' || normalized_email));
  end if;
  if normalized_mobile is not null then
    perform pg_advisory_xact_lock(hashtext(owner_row.id::text), hashtext('signup-mobile:' || normalized_mobile));
  end if;

  if normalized_email is not null or normalized_mobile is not null then
    select * into customer_row
    from public.customers c
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
    from public.issued_cards ic
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

  if normalized_referral_code is not null and normalized_email is null and normalized_mobile is null then
    return jsonb_build_object('outcome', 'error', 'error', 'Add an email or mobile number to qualify for welcome or referral points.');
  end if;

  select * into points_program_row
  from public.loyalty_points_programs p
  where p.owner_id = owner_row.id;
  if found then
    welcome_points_value := case when points_program_row.is_enabled then points_program_row.welcome_points else 0 end;
  end if;

  if normalized_referral_code is not null then
    select l.* into referral_link_row
    from public.customer_referral_links l
    join public.customers referrer on referrer.id = l.referrer_customer_id and referrer.owner_id = owner_row.id
    where l.owner_id = owner_row.id
      and l.campaign_id = campaign_row.id
      and l.referral_code::text = normalized_referral_code;
    if not found then
      return jsonb_build_object('outcome', 'error', 'error', 'Referral link is invalid or the campaign is unavailable. Open a current invitation link or continue without it.');
    end if;
  end if;

  if customer_row.id is null then
    insert into public.customers (id, owner_id, name, email, mobile, status)
    values (
      gen_random_uuid()::text,
      owner_row.id,
      normalized_name,
      coalesce(normalized_email, ''),
      normalized_mobile,
      'Active'
    ) returning * into customer_row;
    is_new_customer := true;
  end if;

  new_card_id := gen_random_uuid()::text;
  new_unique_id := gen_random_uuid();

  insert into public.issued_cards (
    id, unique_id, customer_id, campaign_id, owner_id, campaign_name,
    stamps, last_visit, status, template_snapshot
  ) values (
    new_card_id, new_unique_id, customer_row.id, campaign_row.id, owner_row.id,
    campaign_row.name, 0, current_date, 'Active',
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
      'social', campaign_row.social
    )
  );

  insert into public.transactions (
    id, card_id, type, amount, date, "timestamp", title
  ) values (
    gen_random_uuid()::text, new_card_id, 'issued', 0,
    to_char(now_ts, 'Mon FMDD, YYYY FMHH12:MI AM'),
    floor(extract(epoch from now_ts) * 1000)::bigint,
    'Card Issued'
  );

  if is_new_customer and welcome_points_value > 0 and (normalized_email is not null or normalized_mobile is not null) then
    insert into public.customer_loyalty_points_ledger(
      owner_id, customer_id, card_id, entry_type, points_delta,
      idempotency_key, description, created_at
    ) values (
      owner_row.id, customer_row.id, new_card_id, 'welcome_bonus', welcome_points_value,
      'welcome:' || customer_row.id, 'Welcome bonus', now_ts
    ) on conflict (owner_id, idempotency_key) do nothing;
  end if;

  if is_new_customer and referral_link_row.id is not null and welcome_points_value > 0 then
    referrer_points_value := floor(welcome_points_value::numeric / 2)::integer;
    if referrer_points_value > 0 then
      insert into public.customer_referrals(
        owner_id, campaign_id, referral_link_id, referrer_customer_id,
        referred_customer_id, signup_card_id, referrer_points
      ) values (
        owner_row.id, campaign_row.id, referral_link_row.id,
        referral_link_row.referrer_customer_id, customer_row.id,
        new_card_id, referrer_points_value
      ) on conflict (owner_id, referred_customer_id) do nothing;
    end if;
  end if;

  return jsonb_build_object('outcome', 'issued', 'uniqueId', new_unique_id);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.register_public_campaign_signup(text, text, text, text, text, text) from public;
grant execute on function public.register_public_campaign_signup(text, text, text, text, text, text) to anon, authenticated;

create or replace function public.track_loyalty_points()
returns trigger as $$
declare
  card_row public.issued_cards%rowtype;
  program_row public.loyalty_points_programs%rowtype;
  credit_row public.customer_loyalty_points_ledger%rowtype;
  referral_row public.customer_referrals%rowtype;
  current_balance bigint;
  reversal_amount integer;
  visit_inserted boolean := false;
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

  select * into program_row
  from public.loyalty_points_programs p
  where p.owner_id = card_row.owner_id;
  if not found then return new; end if;

  if new.type = 'stamp_add' then
    if program_row.is_enabled then
      insert into public.customer_loyalty_points_ledger(
        owner_id, customer_id, card_id, source_transaction_id, entry_type,
        points_delta, idempotency_key, description, actor_id, created_at
      ) values (
        card_row.owner_id, card_row.customer_id, card_row.id, new.id, 'visit',
        program_row.points_per_visit * new.amount, 'visit:' || new.id,
        'Verified visit', new.actor_id, new.created_at
      ) on conflict do nothing;
      visit_inserted := found;

      if visit_inserted then
        insert into public.customer_loyalty_badges(owner_id, customer_id, badge_key, source_key, earned_at)
        values (card_row.owner_id, card_row.customer_id, 'first_visit', 'first', new.created_at)
        on conflict do nothing;
      end if;
    end if;

    select * into referral_row
    from public.customer_referrals r
    where r.owner_id = card_row.owner_id
      and r.referred_customer_id = card_row.customer_id
      and r.signup_card_id = card_row.id
      and r.status = 'pending'
      and r.referrer_points > 0
    for update;

    if found then
      perform pg_advisory_xact_lock(hashtext(card_row.owner_id::text), hashtext(referral_row.referrer_customer_id));
      insert into public.customer_loyalty_points_ledger(
        owner_id, customer_id, entry_type, points_delta, idempotency_key,
        description, actor_id, created_at
      ) values (
        card_row.owner_id, referral_row.referrer_customer_id, 'referral_reward',
        referral_row.referrer_points, 'referral:' || referral_row.id::text,
        'Referral reward', new.actor_id, new.created_at
      ) on conflict (owner_id, idempotency_key) do nothing;

      update public.customer_referrals
      set status = 'rewarded', qualifying_transaction_id = new.id, qualified_at = new.created_at
      where id = referral_row.id and status = 'pending';
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

notify pgrst, 'reload schema';
