-- Optional cross-business customer account, verified email access, and account-owned card history.
-- Apply after the core schema, loyalty patches, and add_communications_zernio.sql.

-- New users who explicitly start customer account login must not be provisioned as business owners.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_owner_id uuid;
begin
  -- This marker only opts the user's own auth account out of business profile creation.
  -- It never grants a role or tenant access.
  if new.raw_user_meta_data->>'stampfy_account_type' = 'customer' then
    return new;
  end if;

  v_role := case when new.raw_app_meta_data->>'stampfy_role' = 'staff' then 'staff' else 'owner' end;
  if v_role = 'staff'
    and (new.raw_app_meta_data->>'stampfy_owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_owner_id := (new.raw_app_meta_data->>'stampfy_owner_id')::uuid;
  else
    v_owner_id := null;
  end if;

  insert into public.profiles (id, business_name, email, slug, role, owner_id, status, access, tier, time_zone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'business_name', ''),
    new.email,
    case when v_role = 'owner' then new.raw_user_meta_data->>'slug' else null end,
    v_role,
    v_owner_id,
    'unverified',
    'active',
    'free',
    case when v_role = 'owner' then nullif(new.raw_user_meta_data->>'time_zone', '') else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create table if not exists public.customer_portal_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_portal_accounts enable row level security;
revoke all on public.customer_portal_accounts from public, anon, authenticated;
grant all on public.customer_portal_accounts to service_role;

-- Keep cross-business identity mappings out of the tenant-readable customers table.
create table if not exists public.customer_portal_identity_links (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  user_id uuid not null references public.customer_portal_accounts(user_id) on delete cascade,
  link_method text not null check (link_method in ('verified_email', 'card_link')),
  linked_at timestamptz not null default now(),
  primary key (owner_id, customer_id)
);
create index if not exists customer_portal_identity_links_user_idx
  on public.customer_portal_identity_links(user_id, linked_at desc);
alter table public.customer_portal_identity_links enable row level security;
revoke all on public.customer_portal_identity_links from public, anon, authenticated;
grant all on public.customer_portal_identity_links to service_role;

-- Preferences are customer-owned and tenant-scoped. Push can be enabled by a later phase.
create table if not exists public.customer_portal_communication_preferences (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'whatsapp', 'push')),
  category text not null check (category in ('loyalty_updates', 'marketing')),
  enabled boolean not null default false,
  consent_at timestamptz,
  revoked_at timestamptz,
  consent_source text,
  consent_version text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, customer_id, channel, category),
  constraint customer_portal_preference_consent_audit check (
    (not enabled or (consent_at is not null and revoked_at is null and consent_version is not null))
  )
);
alter table public.customer_portal_communication_preferences
  add column if not exists consent_version text;
alter table public.customer_portal_communication_preferences enable row level security;
revoke all on public.customer_portal_communication_preferences from public, anon, authenticated;
grant all on public.customer_portal_communication_preferences to service_role;

create or replace function public.customer_portal_is_available()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select to_regclass('public.customer_portal_accounts') is not null
    and to_regprocedure('public.get_customer_portal_data()') is not null
$$;
revoke all on function public.customer_portal_is_available() from public;
grant execute on function public.customer_portal_is_available() to anon, authenticated;

-- Preserve current WhatsApp loyalty-update consent in the account preference center.
insert into public.customer_portal_communication_preferences (
  owner_id, customer_id, channel, category, enabled, consent_at, revoked_at, consent_source, consent_version, updated_at
)
select owner_id, customer_id, 'whatsapp', 'loyalty_updates', whatsapp_marketing_opt_in,
  whatsapp_consented_at,
  whatsapp_revoked_at, coalesce(consent_source, 'existing_whatsapp_preference'),
  case when whatsapp_consented_at is null then null
    when consent_source = 'customer_portal' then 'customer_portal_whatsapp_v1'
    when consent_source = 'public_campaign_signup' then 'campaign_signup_whatsapp_v1'
    else 'legacy_whatsapp_consent' end,
  updated_at
from public.customer_notification_preferences
on conflict (owner_id, customer_id, channel, category) do nothing;

create or replace function public.sync_customer_portal_whatsapp_preference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customer_portal_communication_preferences (
    owner_id, customer_id, channel, category, enabled, consent_at, revoked_at, consent_source, consent_version, updated_at
  ) values (
    new.owner_id, new.customer_id, 'whatsapp', 'loyalty_updates', new.whatsapp_marketing_opt_in,
    new.whatsapp_consented_at,
    new.whatsapp_revoked_at, coalesce(new.consent_source, 'whatsapp_signup'),
    case when new.whatsapp_consented_at is null then null
      when new.consent_source like 'customer_portal%' then 'customer_portal_whatsapp_v1'
      when new.consent_source = 'public_campaign_signup' then 'campaign_signup_whatsapp_v1'
      else 'legacy_whatsapp_consent' end,
    now()
  ) on conflict (owner_id, customer_id, channel, category) do update set
    enabled = excluded.enabled,
    consent_at = excluded.consent_at,
    revoked_at = excluded.revoked_at,
    consent_source = excluded.consent_source,
    consent_version = excluded.consent_version,
    updated_at = now();
  return new;
end;
$$;
revoke all on function public.sync_customer_portal_whatsapp_preference() from public, anon, authenticated;
drop trigger if exists sync_customer_portal_whatsapp_preference on public.customer_notification_preferences;
create trigger sync_customer_portal_whatsapp_preference
  after insert or update on public.customer_notification_preferences
  for each row execute function public.sync_customer_portal_whatsapp_preference();

create or replace function public.ensure_customer_portal_account()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  user_id_value uuid := auth.uid();
  user_email text;
  user_name text;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;

  select lower(trim(u.email)), nullif(trim(u.raw_user_meta_data->>'full_name'), '')
    into user_email, user_name
  from auth.users u
  where u.id = user_id_value and u.email_confirmed_at is not null;
  if user_email is null then raise exception 'Verify your email before opening the customer account.'; end if;

  insert into public.customer_portal_accounts(user_id, email, display_name)
  values (user_id_value, user_email, user_name)
  on conflict (user_id) do update set
    email = excluded.email,
    display_name = coalesce(public.customer_portal_accounts.display_name, excluded.display_name),
    updated_at = now();

  return jsonb_build_object('email', user_email, 'displayName', user_name);
end;
$$;
revoke all on function public.ensure_customer_portal_account() from public, anon;
grant execute on function public.ensure_customer_portal_account() to authenticated;

create or replace function public.claim_customer_portal_records_by_email()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  user_id_value uuid := auth.uid();
  email_value text;
  linked_count integer := 0;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  perform public.ensure_customer_portal_account();

  select lower(trim(u.email)) into email_value
  from auth.users u
  where u.id = user_id_value and u.email_confirmed_at is not null;
  if email_value is null then raise exception 'Verify your email before linking cards.'; end if;

  insert into public.customer_portal_identity_links(owner_id, customer_id, user_id, link_method)
  select c.owner_id, c.id, user_id_value, 'verified_email'
  from public.customers c
  where lower(trim(coalesce(c.email, ''))) = email_value
  on conflict (owner_id, customer_id) do nothing;
  get diagnostics linked_count = row_count;

  return jsonb_build_object('linkedCount', linked_count);
end;
$$;
revoke all on function public.claim_customer_portal_records_by_email() from public, anon;
grant execute on function public.claim_customer_portal_records_by_email() to authenticated;

create or replace function public.claim_customer_portal_card(slug_input text, card_unique_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_id_value uuid := auth.uid();
  card_row public.issued_cards%rowtype;
  linked_user_id uuid;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  perform public.ensure_customer_portal_account();

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
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select l.user_id into linked_user_id
  from public.customer_portal_identity_links l
  where l.owner_id = card_row.owner_id and l.customer_id = card_row.customer_id;
  if found and linked_user_id <> user_id_value then return jsonb_build_object('ok', false); end if;

  insert into public.customer_portal_identity_links(owner_id, customer_id, user_id, link_method)
  values (card_row.owner_id, card_row.customer_id, user_id_value, 'card_link')
  on conflict (owner_id, customer_id) do nothing;
  select l.user_id into linked_user_id
  from public.customer_portal_identity_links l
  where l.owner_id = card_row.owner_id and l.customer_id = card_row.customer_id;
  if linked_user_id <> user_id_value then return jsonb_build_object('ok', false); end if;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.claim_customer_portal_card(text, uuid) from public, anon;
grant execute on function public.claim_customer_portal_card(text, uuid) to authenticated;

create or replace function public.set_customer_portal_whatsapp_preference(
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
  mobile_value text;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  perform public.ensure_customer_portal_account();

  select c.mobile into mobile_value
  from public.customers c
  where c.id = customer_id_input
    and c.owner_id = owner_id_input
    and exists (
      select 1 from public.customer_portal_identity_links l
      where l.owner_id = c.owner_id and l.customer_id = c.id and l.user_id = user_id_value
    );
  if not found then return false; end if;
  if enabled_input and nullif(regexp_replace(coalesce(mobile_value, ''), '[^0-9]+', '', 'g'), '') is null then
    return false;
  end if;

  insert into public.customer_portal_communication_preferences (
    owner_id, customer_id, channel, category, enabled, consent_at, revoked_at, consent_source, consent_version, updated_at
  ) values (
    owner_id_input, customer_id_input, 'whatsapp', 'loyalty_updates', enabled_input,
    case when enabled_input then now() else null end,
    case when enabled_input then null else now() end,
    'customer_portal', case when enabled_input then 'customer_portal_whatsapp_v1' else null end, now()
  ) on conflict (owner_id, customer_id, channel, category) do update set
    enabled = excluded.enabled,
    consent_at = case when excluded.enabled then now() else public.customer_portal_communication_preferences.consent_at end,
    revoked_at = case when excluded.enabled then null else now() end,
    consent_source = 'customer_portal',
    consent_version = case when excluded.enabled then excluded.consent_version else public.customer_portal_communication_preferences.consent_version end,
    updated_at = now();

  if enabled_input then
    insert into public.customer_notification_preferences (
      owner_id, customer_id, whatsapp_marketing_opt_in, whatsapp_consented_at,
      whatsapp_revoked_at, consent_source, updated_at
    ) values (owner_id_input, customer_id_input, true, now(), null, 'customer_portal', now())
    on conflict (owner_id, customer_id) do update set
      whatsapp_marketing_opt_in = true,
      whatsapp_consented_at = now(),
      whatsapp_revoked_at = null,
      consent_source = 'customer_portal',
      updated_at = now();
  else
    update public.customer_notification_preferences
    set whatsapp_marketing_opt_in = false,
        whatsapp_revoked_at = now(),
        consent_source = 'customer_portal',
        updated_at = now()
    where owner_id = owner_id_input and customer_id = customer_id_input;

    update public.communication_notification_outbox
    set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
    where owner_id = owner_id_input and customer_id = customer_id_input and status = 'pending';
  end if;

  return true;
end;
$$;
revoke all on function public.set_customer_portal_whatsapp_preference(uuid, text, boolean) from public, anon;
grant execute on function public.set_customer_portal_whatsapp_preference(uuid, text, boolean) to authenticated;

create or replace function public.unlink_customer_portal_business(owner_id_input uuid, customer_id_input text)
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

  perform 1 from public.customer_portal_identity_links l
  where l.owner_id = owner_id_input and l.customer_id = customer_id_input and l.user_id = user_id_value
  for update;
  if not found then return false; end if;

  update public.customer_portal_communication_preferences
  set enabled = false, revoked_at = now(), consent_source = 'customer_portal_unlinked', updated_at = now()
  where owner_id = owner_id_input and customer_id = customer_id_input
    and channel = 'whatsapp' and category = 'loyalty_updates';

  update public.customer_notification_preferences
  set whatsapp_marketing_opt_in = false,
      whatsapp_revoked_at = now(),
      consent_source = 'customer_portal_unlinked',
      updated_at = now()
  where owner_id = owner_id_input and customer_id = customer_id_input
    and whatsapp_marketing_opt_in = true;

  update public.communication_notification_outbox
  set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
  where owner_id = owner_id_input and customer_id = customer_id_input and status = 'pending';

  delete from public.customer_portal_identity_links
  where owner_id = owner_id_input and customer_id = customer_id_input and user_id = user_id_value;
  return found;
end;
$$;
revoke all on function public.unlink_customer_portal_business(uuid, text) from public, anon;
grant execute on function public.unlink_customer_portal_business(uuid, text) to authenticated;

create or replace function public.get_customer_portal_data()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  user_id_value uuid := auth.uid();
  email_value text;
  businesses_value jsonb;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  select lower(trim(u.email)) into email_value
  from auth.users u where u.id = user_id_value and u.email_confirmed_at is not null;
  if email_value is null then raise exception 'Verify your email before opening the customer account.'; end if;

  if not exists (select 1 from public.customer_portal_accounts a where a.user_id = user_id_value) then
    raise exception 'Customer account is not initialized.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ownerId', p.id,
    'businessName', p.business_name,
    'slug', p.slug,
    'customerId', c.id,
    'customerName', c.name,
    'hasMobile', nullif(regexp_replace(coalesce(c.mobile, ''), '[^0-9]+', '', 'g'), '') is not null,
    'whatsappLoyaltyEnabled', coalesce(pref.enabled, legacy.whatsapp_marketing_opt_in, false),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'uniqueId', ic.unique_id,
        'campaignName', ic.campaign_name,
        'stamps', ic.stamps,
        'totalStamps', (select campaign.total_stamps from public.campaigns campaign where campaign.id = ic.campaign_id and campaign.owner_id = ic.owner_id),
        'status', ic.status,
        'lastVisit', ic.last_visit,
        'completedDate', ic.completed_date,
        'createdAt', ic.created_at
      ) order by ic.created_at desc)
      from public.issued_cards ic
      where ic.customer_id = c.id and ic.owner_id = c.owner_id
    ), '[]'::jsonb),
    'pointsBalance', coalesce((
      select sum(l.points_delta)::integer from public.customer_loyalty_points_ledger l
      where l.owner_id = c.owner_id and l.customer_id = c.id
    ), 0),
    'pointsHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'delta', l.points_delta, 'description', l.description, 'createdAt', l.created_at
      ) order by l.created_at desc)
      from (
        select points_delta, description, created_at
        from public.customer_loyalty_points_ledger
        where owner_id = c.owner_id and customer_id = c.id
        order by created_at desc limit 20
      ) l
    ), '[]'::jsonb),
    'activeMissions', coalesce((
      select jsonb_agg(
        public.mission_progress_payload(m.id, c.id, ic.id, true)
        order by m.ends_at asc
      )
      from public.loyalty_missions m
      left join public.issued_cards ic
        on ic.owner_id = c.owner_id and ic.customer_id = c.id
        and ic.campaign_id = m.campaign_id
        and m.mission_type = 'card_stamps'
      where m.owner_id = c.owner_id
        and m.is_active = true
        and m.starts_at <= now()
        and m.ends_at > now()
        and exists (
          select 1 from public.campaigns campaign
          where campaign.id = m.campaign_id and campaign.owner_id = m.owner_id and campaign.is_enabled = true
        )
        and (m.mission_type = 'visit_count' or ic.id is not null)
    ), '[]'::jsonb),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', m.name, 'rewardDescription', mc.reward_description,
        'completedAt', mc.completed_at, 'redeemedAt', mc.redeemed_at
      ) order by mc.completed_at desc)
      from public.mission_completions mc
      join public.loyalty_missions m on m.id = mc.mission_id
      where mc.customer_id = c.id and m.owner_id = c.owner_id
    ), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', rr.reward_name, 'description', rr.reward_description,
        'code', rr.redemption_code, 'status', rr.status,
        'issuedAt', rr.issued_at, 'expiresAt', rr.expires_at, 'redeemedAt', rr.redeemed_at
      ) order by rr.issued_at desc)
      from public.loyalty_reward_redemptions rr
      where rr.owner_id = c.owner_id and rr.customer_id = c.id
    ), '[]'::jsonb)
  ) order by p.business_name), '[]'::jsonb)
  into businesses_value
  from public.customers c
  join public.customer_portal_identity_links identity_link
    on identity_link.owner_id = c.owner_id and identity_link.customer_id = c.id
    and identity_link.user_id = user_id_value
  join public.profiles p on p.id = c.owner_id and p.role = 'owner'
  left join public.customer_portal_communication_preferences pref
    on pref.owner_id = c.owner_id and pref.customer_id = c.id
    and pref.channel = 'whatsapp' and pref.category = 'loyalty_updates'
  left join public.customer_notification_preferences legacy
    on legacy.owner_id = c.owner_id and legacy.customer_id = c.id
  where identity_link.user_id = user_id_value;

  return jsonb_build_object('email', email_value, 'businesses', businesses_value);
end;
$$;
revoke all on function public.get_customer_portal_data() from public, anon;
grant execute on function public.get_customer_portal_data() to authenticated;

notify pgrst, 'reload schema';
