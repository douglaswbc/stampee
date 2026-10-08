-- Device-scoped Web Push subscriptions and independent delivery queue.
-- Apply after add_communications_zernio.sql and add_customer_portal.sql.

create table if not exists public.customer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint_hash text not null unique check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  endpoint_url text not null,
  p256dh_key text not null,
  auth_secret text not null,
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.customer_push_subscriptions enable row level security;
revoke all on public.customer_push_subscriptions from public, anon, authenticated;
grant all on public.customer_push_subscriptions to service_role;

create table if not exists public.customer_push_subscription_links (
  subscription_id uuid not null references public.customer_push_subscriptions(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  card_unique_id uuid not null references public.issued_cards(unique_id) on delete cascade,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (subscription_id, owner_id, customer_id, card_unique_id)
);
create index if not exists customer_push_subscription_links_customer_idx
  on public.customer_push_subscription_links(owner_id, customer_id) where revoked_at is null;
alter table public.customer_push_subscription_links enable row level security;
revoke all on public.customer_push_subscription_links from public, anon, authenticated;
grant all on public.customer_push_subscription_links to service_role;

create or replace function public.prune_customer_push_subscription_after_card_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.customer_push_subscription_links l
    where l.subscription_id = old.subscription_id and l.revoked_at is null
  ) then
    update public.customer_push_subscriptions
    set revoked_at = now(), endpoint_url = '', p256dh_key = '', auth_secret = '', updated_at = now()
    where id = old.subscription_id and revoked_at is null;
  end if;
  return old;
end;
$$;
revoke all on function public.prune_customer_push_subscription_after_card_delete() from public, anon, authenticated;
drop trigger if exists prune_customer_push_subscription_after_card_delete on public.customer_push_subscription_links;
create trigger prune_customer_push_subscription_after_card_delete
  after delete on public.customer_push_subscription_links
  for each row execute function public.prune_customer_push_subscription_after_card_delete();

create table if not exists public.customer_push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.communication_notification_outbox(id) on delete cascade,
  subscription_id uuid not null references public.customer_push_subscriptions(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  card_unique_id uuid not null references public.issued_cards(unique_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'retry', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (outbox_id, subscription_id, owner_id, customer_id, card_unique_id)
);
create index if not exists customer_push_deliveries_pending_idx
  on public.customer_push_notification_deliveries(status, next_attempt_at, created_at)
  where status in ('pending', 'retry', 'processing');
create index if not exists customer_push_deliveries_owner_created_idx
  on public.customer_push_notification_deliveries(owner_id, created_at desc);
alter table public.customer_push_notification_deliveries enable row level security;
revoke all on public.customer_push_notification_deliveries from public, anon, authenticated;
grant all on public.customer_push_notification_deliveries to service_role;

create table if not exists public.customer_push_notification_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.customer_push_notification_deliveries(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 5),
  outcome text not null check (outcome in ('sent', 'retry', 'failed', 'skipped')),
  error_code text,
  created_at timestamptz not null default now(),
  unique (delivery_id, attempt_number)
);
create index if not exists customer_push_attempts_delivery_idx
  on public.customer_push_notification_attempts(delivery_id, created_at desc);
alter table public.customer_push_notification_attempts enable row level security;
revoke all on public.customer_push_notification_attempts from public, anon, authenticated;
grant all on public.customer_push_notification_attempts to service_role;

create table if not exists public.customer_push_consent_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  card_unique_id uuid references public.issued_cards(unique_id) on delete set null,
  enabled boolean not null,
  source text not null check (source in ('public_card', 'customer_portal', 'customer_portal_unlinked')),
  consent_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists customer_push_consent_events_customer_idx
  on public.customer_push_consent_events(owner_id, customer_id, created_at desc);
alter table public.customer_push_consent_events enable row level security;
revoke all on public.customer_push_consent_events from public, anon, authenticated;
grant all on public.customer_push_consent_events to service_role;

create or replace function public.register_public_customer_push_subscription(
  slug_input text,
  card_unique_id_input uuid,
  endpoint_input text,
  p256dh_input text,
  auth_input text,
  expiration_time_input timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  card_row public.issued_cards%rowtype;
  subscription_id_value uuid;
  endpoint_hash_value text;
  link_was_active boolean := false;
  preference_was_enabled boolean := false;
begin
  if endpoint_input is null or p256dh_input is null or auth_input is null
    or length(endpoint_input) > 2048
    or endpoint_input !~ '^https://([A-Za-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)/[^[:space:]]+$'
    or length(coalesce(p256dh_input, '')) not between 32 and 256
    or p256dh_input !~ '^[A-Za-z0-9_-]+$'
    or length(coalesce(auth_input, '')) not between 16 and 128
    or auth_input !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception 'Invalid push subscription.';
  end if;

  select ic.* into card_row
  from public.issued_cards ic
  join public.profiles p on p.id = ic.owner_id
  where ic.unique_id = card_unique_id_input
    and p.slug = lower(trim(slug_input))
    and p.role = 'owner'
    and p.access = 'active'
  limit 1;
  if not found then return jsonb_build_object('ok', false); end if;

  perform 1 from public.customers c
  where c.id = card_row.customer_id and c.owner_id = card_row.owner_id
  for update;

  endpoint_hash_value := encode(digest(convert_to(endpoint_input, 'UTF8'), 'sha256'), 'hex');
  select exists (
    select 1
    from public.customer_push_subscriptions s
    join public.customer_push_subscription_links l on l.subscription_id = s.id
    where s.endpoint_hash = endpoint_hash_value
      and s.revoked_at is null
      and l.owner_id = card_row.owner_id and l.customer_id = card_row.customer_id
      and l.card_unique_id = card_row.unique_id and l.revoked_at is null
  ) into link_was_active;
  select coalesce((
    select pref.enabled and pref.revoked_at is null
    from public.customer_portal_communication_preferences pref
    where pref.owner_id = card_row.owner_id and pref.customer_id = card_row.customer_id
      and pref.channel = 'push' and pref.category = 'loyalty_updates'
  ), false) into preference_was_enabled;

  if not exists (
    select 1 from public.customer_push_subscriptions s
    where s.endpoint_hash = endpoint_hash_value and s.revoked_at is null
  ) and (
    select count(distinct l.subscription_id)
    from public.customer_push_subscription_links l
    join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
    where l.owner_id = card_row.owner_id and l.customer_id = card_row.customer_id and l.revoked_at is null
  ) >= 10 then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.customer_push_subscriptions (
    endpoint_hash, endpoint_url, p256dh_key, auth_secret, expiration_time,
    updated_at, last_seen_at, revoked_at
  ) values (
    endpoint_hash_value, endpoint_input, p256dh_input, auth_input, expiration_time_input,
    now(), now(), null
  ) on conflict (endpoint_hash) do update set
    endpoint_url = excluded.endpoint_url,
    p256dh_key = excluded.p256dh_key,
    auth_secret = excluded.auth_secret,
    expiration_time = excluded.expiration_time,
    updated_at = now(),
    last_seen_at = now(),
    revoked_at = null
  returning id into subscription_id_value;

  insert into public.customer_push_subscription_links(subscription_id, owner_id, customer_id, card_unique_id, linked_at, revoked_at)
  values (subscription_id_value, card_row.owner_id, card_row.customer_id, card_row.unique_id, now(), null)
  on conflict (subscription_id, owner_id, customer_id, card_unique_id) do update set
    linked_at = now(), revoked_at = null;

  insert into public.customer_portal_communication_preferences (
    owner_id, customer_id, channel, category, enabled, consent_at, revoked_at,
    consent_source, consent_version, updated_at
  ) values (
    card_row.owner_id, card_row.customer_id, 'push', 'loyalty_updates', true,
    now(), null, 'public_card_push', 'public_card_push_v1', now()
  ) on conflict (owner_id, customer_id, channel, category) do update set
    enabled = true,
    consent_at = now(),
    revoked_at = null,
    consent_source = 'public_card_push',
    consent_version = 'public_card_push_v1',
    updated_at = now();

  if not link_was_active or not preference_was_enabled then
    insert into public.customer_push_consent_events(
      owner_id, customer_id, card_unique_id, enabled, source, consent_version
    ) values (card_row.owner_id, card_row.customer_id, card_row.unique_id, true, 'public_card', 'public_card_push_v1');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.register_public_customer_push_subscription(text, uuid, text, text, text, timestamptz) from public;
grant execute on function public.register_public_customer_push_subscription(text, uuid, text, text, text, timestamptz) to anon, authenticated;

create or replace function public.get_public_customer_push_subscription_status(
  slug_input text,
  card_unique_id_input uuid,
  endpoint_input text
)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.issued_cards ic
    join public.profiles p on p.id = ic.owner_id and p.slug = lower(trim(slug_input)) and p.role = 'owner' and p.access = 'active'
    join public.customer_push_subscriptions s
      on s.endpoint_hash = encode(digest(convert_to(endpoint_input, 'UTF8'), 'sha256'), 'hex')
      and s.revoked_at is null
    join public.customer_push_subscription_links l
      on l.subscription_id = s.id and l.owner_id = ic.owner_id and l.customer_id = ic.customer_id
      and l.card_unique_id = ic.unique_id and l.revoked_at is null
    join public.customer_portal_communication_preferences pref
      on pref.owner_id = ic.owner_id and pref.customer_id = ic.customer_id
      and pref.channel = 'push' and pref.category = 'loyalty_updates'
      and pref.enabled and pref.revoked_at is null
    where ic.unique_id = card_unique_id_input
  )
$$;
revoke all on function public.get_public_customer_push_subscription_status(text, uuid, text) from public;
grant execute on function public.get_public_customer_push_subscription_status(text, uuid, text) to anon, authenticated;

create or replace function public.revoke_public_customer_push_subscription(
  slug_input text,
  card_unique_id_input uuid,
  endpoint_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  card_row public.issued_cards%rowtype;
  subscription_id_value uuid;
  browser_can_unsubscribe boolean := false;
begin
  select ic.* into card_row
  from public.issued_cards ic
  join public.profiles p on p.id = ic.owner_id
  where ic.unique_id = card_unique_id_input
    and p.slug = lower(trim(slug_input))
    and p.role = 'owner'
    and p.access = 'active'
  limit 1;
  if not found then return jsonb_build_object('ok', false, 'unsubscribeBrowser', false); end if;

  select s.id into subscription_id_value
  from public.customer_push_subscriptions s
  join public.customer_push_subscription_links l on l.subscription_id = s.id
  where s.endpoint_hash = encode(digest(convert_to(endpoint_input, 'UTF8'), 'sha256'), 'hex')
    and l.owner_id = card_row.owner_id and l.customer_id = card_row.customer_id
    and l.card_unique_id = card_row.unique_id and l.revoked_at is null
  limit 1;
  if subscription_id_value is null then return jsonb_build_object('ok', false, 'unsubscribeBrowser', false); end if;

  update public.customer_push_subscription_links
  set revoked_at = now()
  where subscription_id = subscription_id_value and owner_id = card_row.owner_id
    and customer_id = card_row.customer_id and card_unique_id = card_row.unique_id and revoked_at is null;

  update public.customer_portal_communication_preferences
  set enabled = false, revoked_at = now(), consent_source = 'public_card_push_revoked', updated_at = now()
  where owner_id = card_row.owner_id and customer_id = card_row.customer_id
    and channel = 'push' and category = 'loyalty_updates';

  insert into public.customer_push_consent_events(
    owner_id, customer_id, card_unique_id, enabled, source, consent_version
  ) values (card_row.owner_id, card_row.customer_id, card_row.unique_id, false, 'public_card', 'public_card_push_v1');

  update public.customer_push_notification_deliveries
  set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
  where subscription_id = subscription_id_value and owner_id = card_row.owner_id
    and customer_id = card_row.customer_id and card_unique_id = card_row.unique_id
    and status in ('pending', 'retry', 'processing');

  select not exists (
    select 1 from public.customer_push_subscription_links l
    where l.subscription_id = subscription_id_value and l.revoked_at is null
  ) into browser_can_unsubscribe;

  if browser_can_unsubscribe then
    update public.customer_push_subscriptions
    set revoked_at = now(), endpoint_url = '', p256dh_key = '', auth_secret = '', updated_at = now()
    where id = subscription_id_value;
  end if;

  return jsonb_build_object('ok', true, 'unsubscribeBrowser', browser_can_unsubscribe);
end;
$$;
revoke all on function public.revoke_public_customer_push_subscription(text, uuid, text) from public;
grant execute on function public.revoke_public_customer_push_subscription(text, uuid, text) to anon, authenticated;

create or replace function public.get_customer_portal_push_preferences()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  user_id_value uuid := auth.uid();
  preferences_value jsonb;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ownerId', p.id,
    'customerId', c.id,
    'enabled', coalesce(pref.enabled, false),
    'hasSubscription', exists (
      select 1
      from public.customer_push_subscription_links l
      join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
      where l.owner_id = c.owner_id and l.customer_id = c.id and l.revoked_at is null
    )
  )), '[]'::jsonb)
  into preferences_value
  from public.customer_portal_identity_links identity_link
  join public.customers c on c.id = identity_link.customer_id and c.owner_id = identity_link.owner_id
  join public.profiles p on p.id = c.owner_id and p.role = 'owner'
  left join public.customer_portal_communication_preferences pref
    on pref.owner_id = c.owner_id and pref.customer_id = c.id
    and pref.channel = 'push' and pref.category = 'loyalty_updates'
  where identity_link.user_id = user_id_value;
  return preferences_value;
end;
$$;
revoke all on function public.get_customer_portal_push_preferences() from public, anon;
grant execute on function public.get_customer_portal_push_preferences() to authenticated;

create or replace function public.set_customer_portal_push_preference(
  owner_id_input uuid,
  customer_id_input text,
  enabled_input boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  user_id_value uuid := auth.uid();
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  perform public.ensure_customer_portal_account();
  if not exists (
    select 1 from public.customer_portal_identity_links l
    where l.owner_id = owner_id_input and l.customer_id = customer_id_input and l.user_id = user_id_value
  ) then return false; end if;
  if enabled_input and not exists (
    select 1
    from public.customer_push_subscription_links l
    join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
    where l.owner_id = owner_id_input and l.customer_id = customer_id_input and l.revoked_at is null
  ) then return false; end if;

  insert into public.customer_portal_communication_preferences (
    owner_id, customer_id, channel, category, enabled, consent_at, revoked_at,
    consent_source, consent_version, updated_at
  ) values (
    owner_id_input, customer_id_input, 'push', 'loyalty_updates', enabled_input,
    case when enabled_input then now() else null end,
    case when enabled_input then null else now() end,
    'customer_portal', case when enabled_input then 'customer_portal_push_v1' else null end, now()
  ) on conflict (owner_id, customer_id, channel, category) do update set
    enabled = excluded.enabled,
    consent_at = case when excluded.enabled then now() else public.customer_portal_communication_preferences.consent_at end,
    revoked_at = case when excluded.enabled then null else now() end,
    consent_source = 'customer_portal',
    consent_version = case when excluded.enabled then excluded.consent_version else public.customer_portal_communication_preferences.consent_version end,
    updated_at = now();

  insert into public.customer_push_consent_events(
    owner_id, customer_id, enabled, source, consent_version
  ) values (
    owner_id_input, customer_id_input, enabled_input, 'customer_portal', 'customer_portal_push_v1'
  );

  if not enabled_input then
    update public.customer_push_notification_deliveries
    set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
  where owner_id = owner_id_input and customer_id = customer_id_input and status in ('pending', 'retry', 'processing');
  end if;
  return true;
end;
$$;
revoke all on function public.set_customer_portal_push_preference(uuid, text, boolean) from public, anon;
grant execute on function public.set_customer_portal_push_preference(uuid, text, boolean) to authenticated;

create or replace function public.revoke_push_after_customer_portal_unlink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customer_push_subscription_links
  set revoked_at = now()
  where owner_id = old.owner_id and customer_id = old.customer_id and revoked_at is null;
  update public.customer_portal_communication_preferences
  set enabled = false, revoked_at = now(), consent_source = 'customer_portal_unlinked', updated_at = now()
  where owner_id = old.owner_id and customer_id = old.customer_id
    and channel = 'push' and category = 'loyalty_updates';
  insert into public.customer_push_consent_events(owner_id, customer_id, enabled, source, consent_version)
  values (old.owner_id, old.customer_id, false, 'customer_portal_unlinked', 'customer_portal_push_v1');
  update public.customer_push_notification_deliveries
  set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
  where owner_id = old.owner_id and customer_id = old.customer_id and status in ('pending', 'retry', 'processing');
  update public.customer_push_subscriptions s
  set revoked_at = now(), endpoint_url = '', p256dh_key = '', auth_secret = '', updated_at = now()
  where s.revoked_at is null and not exists (
    select 1 from public.customer_push_subscription_links l
    where l.subscription_id = s.id and l.revoked_at is null
  );
  return old;
end;
$$;
revoke all on function public.revoke_push_after_customer_portal_unlink() from public, anon, authenticated;
drop trigger if exists revoke_push_after_customer_portal_unlink on public.customer_portal_identity_links;
create trigger revoke_push_after_customer_portal_unlink
  after delete on public.customer_portal_identity_links
  for each row execute function public.revoke_push_after_customer_portal_unlink();

create or replace function public.enqueue_customer_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_card_id text;
  event_card_unique_id uuid;
begin
  if new.event_type = 'visit_validated' then
    select t.card_id into event_card_id
    from public.transactions t
    where t.id::text = split_part(new.event_key, ':', 2)
      and t.type = 'stamp_add';
  elsif new.event_type = 'mission_completed' then
    select coalesce(mc.card_id, latest_visit.card_id) into event_card_id
    from public.mission_completions mc
    join public.loyalty_missions m on m.id = mc.mission_id and m.owner_id = new.owner_id
    left join lateral (
      select t.card_id
      from public.transactions t
      join public.issued_cards ic on ic.id = t.card_id
      where ic.owner_id = new.owner_id and ic.customer_id = new.customer_id
        and t.type = 'stamp_add'
        and to_timestamp(t."timestamp" / 1000.0) <= mc.completed_at
      order by t."timestamp" desc
      limit 1
    ) latest_visit on true
    where mc.id::text = split_part(new.event_key, ':', 2)
      and mc.customer_id = new.customer_id;
  elsif new.event_type = 'reward_claimed' then
    select coalesce(rr.card_id, latest_card.id) into event_card_id
    from public.loyalty_reward_redemptions rr
    left join lateral (
      select ic.id
      from public.issued_cards ic
      where ic.owner_id = new.owner_id and ic.customer_id = new.customer_id
        and ic.created_at <= rr.issued_at
      order by ic.created_at desc
      limit 1
    ) latest_card on true
    where rr.id::text = split_part(new.event_key, ':', 2)
      and rr.owner_id = new.owner_id and rr.customer_id = new.customer_id;
  end if;

  select ic.unique_id into event_card_unique_id
  from public.issued_cards ic
  where ic.id = event_card_id and ic.owner_id = new.owner_id and ic.customer_id = new.customer_id;
  if event_card_unique_id is null then return new; end if;

  insert into public.customer_push_notification_deliveries(outbox_id, subscription_id, owner_id, customer_id, card_unique_id)
  select new.id, l.subscription_id, new.owner_id, new.customer_id, event_card_unique_id
  from public.customer_push_subscription_links l
  join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
  join public.customer_portal_communication_preferences pref
    on pref.owner_id = l.owner_id and pref.customer_id = l.customer_id
    and pref.channel = 'push' and pref.category = 'loyalty_updates'
    and pref.enabled and pref.revoked_at is null
  where l.owner_id = new.owner_id and l.customer_id = new.customer_id
    and l.card_unique_id = event_card_unique_id and l.revoked_at is null
  on conflict (outbox_id, subscription_id, owner_id, customer_id, card_unique_id) do nothing;
  return new;
end;
$$;
revoke all on function public.enqueue_customer_push_deliveries() from public, anon, authenticated;
drop trigger if exists enqueue_customer_push_deliveries on public.communication_notification_outbox;
create trigger enqueue_customer_push_deliveries
  after insert on public.communication_notification_outbox
  for each row execute function public.enqueue_customer_push_deliveries();

create or replace function public.claim_customer_push_deliveries(batch_limit integer default 50)
returns table (
  delivery_id uuid,
  owner_id uuid,
  customer_id text,
  customer_name text,
  business_name text,
  business_slug text,
  interface_language text,
  event_type text,
  endpoint_url text,
  p256dh_key text,
  auth_secret text,
  subscription_id uuid,
  card_unique_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customer_push_subscriptions s
  set revoked_at = now(), endpoint_url = '', p256dh_key = '', auth_secret = '', updated_at = now()
  where s.revoked_at is null and s.expiration_time is not null and s.expiration_time <= now();

  update public.customer_push_notification_deliveries d
  set status = 'failed', locked_at = null, last_error_code = 'attempt_limit_reached'
  where d.status = 'processing' and d.locked_at < now() - interval '10 minutes'
    and d.attempt_count >= 5;

  update public.customer_push_notification_deliveries d
  set status = 'skipped', locked_at = null, last_error_code = 'consent_or_subscription_revoked'
  where d.status in ('pending', 'retry')
    and not exists (
      select 1
      from public.customer_push_subscription_links l
      join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
      join public.customer_portal_communication_preferences pref
        on pref.owner_id = l.owner_id and pref.customer_id = l.customer_id
        and pref.channel = 'push' and pref.category = 'loyalty_updates'
        and pref.enabled and pref.revoked_at is null
      where l.subscription_id = d.subscription_id and l.owner_id = d.owner_id
        and l.customer_id = d.customer_id and l.card_unique_id = d.card_unique_id and l.revoked_at is null
    );

  return query
  with candidates as (
    select d.id
    from public.customer_push_notification_deliveries d
    where (
        (d.status in ('pending', 'retry') and d.next_attempt_at <= now())
        or (d.status = 'processing' and d.locked_at < now() - interval '10 minutes')
      )
      and d.attempt_count < 5
      and exists (
        select 1
        from public.customer_push_subscription_links l
        join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
        join public.customer_portal_communication_preferences pref
          on pref.owner_id = l.owner_id and pref.customer_id = l.customer_id
          and pref.channel = 'push' and pref.category = 'loyalty_updates'
          and pref.enabled and pref.revoked_at is null
        where l.subscription_id = d.subscription_id and l.owner_id = d.owner_id
          and l.customer_id = d.customer_id and l.card_unique_id = d.card_unique_id and l.revoked_at is null
      )
    order by d.created_at
    for update skip locked
    limit greatest(1, least(coalesce(batch_limit, 50), 100))
  ), claimed as (
    update public.customer_push_notification_deliveries d
    set status = 'processing', locked_at = now(), attempt_count = d.attempt_count + 1
    from candidates c
    where d.id = c.id
    returning d.*
  )
  select c.id, c.owner_id, c.customer_id, cu.name, p.business_name, p.slug,
    p.interface_language, o.event_type, s.endpoint_url, s.p256dh_key, s.auth_secret,
    s.id, c.card_unique_id
  from claimed c
  join public.communication_notification_outbox o on o.id = c.outbox_id
  join public.customer_push_subscriptions s on s.id = c.subscription_id
  join public.customers cu on cu.id = c.customer_id and cu.owner_id = c.owner_id
  join public.profiles p on p.id = c.owner_id;
end;
$$;
revoke all on function public.claim_customer_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_customer_push_deliveries(integer) to service_role;

create or replace function public.authorize_customer_push_delivery(delivery_id_input uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_push_notification_deliveries d
    join public.customer_push_subscription_links l
      on l.subscription_id = d.subscription_id and l.owner_id = d.owner_id
      and l.customer_id = d.customer_id and l.card_unique_id = d.card_unique_id and l.revoked_at is null
    join public.customer_push_subscriptions s on s.id = d.subscription_id and s.revoked_at is null
    join public.customer_portal_communication_preferences pref
      on pref.owner_id = d.owner_id and pref.customer_id = d.customer_id
      and pref.channel = 'push' and pref.category = 'loyalty_updates'
      and pref.enabled and pref.revoked_at is null
    where d.id = delivery_id_input and d.status = 'processing'
  )
$$;
revoke all on function public.authorize_customer_push_delivery(uuid) from public, anon, authenticated;
grant execute on function public.authorize_customer_push_delivery(uuid) to service_role;

create or replace function public.finish_customer_push_delivery(
  delivery_id_input uuid,
  outcome_input text,
  error_code_input text default null,
  retry_after_seconds_input integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  delivery_row public.customer_push_notification_deliveries%rowtype;
  final_outcome text;
begin
  if outcome_input not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'Invalid push delivery outcome.';
  end if;
  select * into delivery_row
  from public.customer_push_notification_deliveries
  where id = delivery_id_input and status = 'processing'
  for update;
  if not found then return false; end if;

  final_outcome := case
    when outcome_input = 'retry' and delivery_row.attempt_count >= 5 then 'failed'
    else outcome_input
  end;

  update public.customer_push_notification_deliveries
  set status = final_outcome,
      locked_at = null,
      sent_at = case when final_outcome = 'sent' then now() else sent_at end,
      last_error_code = case when final_outcome = 'sent' then null else left(error_code_input, 100) end,
      next_attempt_at = case when final_outcome = 'retry'
        then now() + make_interval(secs => greatest(30, least(coalesce(retry_after_seconds_input, 60), 3600)))
        else next_attempt_at end
  where id = delivery_row.id;

  insert into public.customer_push_notification_attempts(delivery_id, attempt_number, outcome, error_code)
  values (delivery_row.id, delivery_row.attempt_count, final_outcome, case when final_outcome = 'sent' then null else left(error_code_input, 100) end)
  on conflict (delivery_id, attempt_number) do nothing;

  if error_code_input in ('subscription_expired', 'subscription_invalid') then
    update public.customer_push_subscriptions
    set revoked_at = now(), endpoint_url = '', p256dh_key = '', auth_secret = '', updated_at = now()
    where id = delivery_row.subscription_id;
    update public.customer_push_notification_deliveries
    set status = 'skipped', locked_at = null, last_error_code = error_code_input
    where subscription_id = delivery_row.subscription_id and status in ('pending', 'retry');
  end if;

  return true;
end;
$$;
revoke all on function public.finish_customer_push_delivery(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.finish_customer_push_delivery(uuid, text, text, integer) to service_role;

notify pgrst, 'reload schema';
