-- ============================================================
-- Stampfy: Full Database Schema (Idempotent)
-- Canonical fresh-install script for new Supabase projects.
-- Safe to re-run in Supabase SQL Editor.
-- For existing or older projects, use the targeted upgrade/repair
-- scripts in legacy-patches/ only when needed.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- 1. PROFILES TABLE
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null,
  email text not null,
  slug text unique,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  owner_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  access text not null default 'active' check (access in ('active', 'disabled')),
  tier text not null default 'free' check (tier in ('free', 'pro')),
  interface_language text not null default 'pt-BR' check (interface_language in ('pt-BR', 'es', 'en')),
  currency_code text not null default 'BRL' check (currency_code in ('BRL', 'USD', 'EUR', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'UYU')),
  tier_expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.current_staff_owner_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select p.owner_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.role = 'staff'
  limit 1
$$;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  using ((select auth.uid()) = id);

drop policy if exists "Owners can read own staff profiles" on public.profiles;
create policy "Owners can read own staff profiles"
  on public.profiles for select
  using (
    role = 'staff' and owner_id = (select auth.uid())
  );

drop policy if exists "Staff can read owner profile" on public.profiles;
create policy "Staff can read owner profile"
  on public.profiles for select
  using (
    id = (select public.current_staff_owner_id())
  );

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using ((select auth.uid()) = id);

drop policy if exists "Owners can update own staff profiles" on public.profiles;
create policy "Owners can update own staff profiles"
  on public.profiles for update
  using (
    role = 'staff' and owner_id = (select auth.uid())
  );

drop policy if exists "Owners can insert staff profiles" on public.profiles;
create policy "Owners can insert staff profiles"
  on public.profiles for insert
  with check (
    role = 'staff' AND owner_id = (select auth.uid())
  );

drop policy if exists "Allow trigger insert for new signups" on public.profiles;
create policy "Allow trigger insert for new signups"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role text;
  v_owner_id uuid;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'owner');

  if v_role = 'staff'
    and (new.raw_user_meta_data->>'owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_owner_id := (new.raw_user_meta_data->>'owner_id')::uuid;
  else
    v_owner_id := null;
  end if;

  insert into public.profiles (id, business_name, email, slug, role, owner_id, status, access, tier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'business_name', ''),
    new.email,
    case when v_role = 'owner' then new.raw_user_meta_data->>'slug' else null end,
    v_role,
    v_owner_id,
    'unverified',
    'active',
    'free'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer
set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2. CAMPAIGNS TABLE
create table if not exists public.campaigns (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  is_enabled boolean not null default true,
  description text not null default '',
  reward_name text not null default '',
  tagline text,
  background_image text,
  background_opacity int default 100,
  logo_image text,
  show_logo boolean default true,
  title_size text,
  icon_key text not null default 'Coffee',
  colors jsonb not null,
  total_stamps int not null default 10,
  social jsonb,
  created_at timestamptz not null default now()
);

alter table public.campaigns
  add column if not exists is_enabled boolean not null default true;

alter table public.campaigns enable row level security;

drop policy if exists "Owners can manage own campaigns" on public.campaigns;
create policy "Owners can manage own campaigns"
  on public.campaigns for all
  using ((select auth.uid()) = owner_id);

drop policy if exists "Staff can read owner campaigns" on public.campaigns;
create policy "Staff can read owner campaigns"
  on public.campaigns for select
  using (
    owner_id = (select owner_id from public.profiles where id = auth.uid())
  );


-- 3. CUSTOMERS TABLE
create table if not exists public.customers (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  email text not null,
  mobile text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now()
);

alter table public.customers enable row level security;

drop policy if exists "Owners can manage own customers" on public.customers;
create policy "Owners can manage own customers"
  on public.customers for all
  using (auth.uid() = owner_id);

drop policy if exists "Staff can read owner customers" on public.customers;
create policy "Staff can read owner customers"
  on public.customers for select
  using (
    owner_id = (select owner_id from public.profiles where id = auth.uid())
  );

drop policy if exists "Staff can update owner customers" on public.customers;
create policy "Staff can update owner customers"
  on public.customers for update
  using (
    owner_id = (select owner_id from public.profiles where id = auth.uid())
  );


-- 4. ISSUED CARDS TABLE
create table if not exists public.issued_cards (
  id text primary key default gen_random_uuid()::text,
  unique_id uuid not null default gen_random_uuid() unique,
  customer_id text not null references public.customers(id) on delete cascade,
  campaign_id text references public.campaigns(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_name text not null,
  stamps int not null default 0,
  last_visit date not null default current_date,
  status text not null default 'Active' check (status in ('Active', 'Redeemed')),
  completed_date date,
  template_snapshot jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.prevent_issuing_disabled_campaign_card()
returns trigger as $$
declare
  campaign_enabled boolean;
begin
  if new.campaign_id is null then
    return new;
  end if;

  select c.is_enabled
  into campaign_enabled
  from public.campaigns c
  where c.id = new.campaign_id;

  if found and campaign_enabled = false then
    raise exception 'CAMPAIGN_DISABLED: This campaign is disabled and cannot issue new cards.';
  end if;

  return new;
end;
$$ language plpgsql
set search_path = public;

drop trigger if exists issued_cards_block_disabled_campaign on public.issued_cards;
create trigger issued_cards_block_disabled_campaign
  before insert on public.issued_cards
  for each row
  execute function public.prevent_issuing_disabled_campaign_card();

update public.issued_cards ic
set template_snapshot = coalesce(
      ic.template_snapshot,
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'rewardName', c.reward_name,
        'tagline', c.tagline,
        'backgroundImage', c.background_image,
        'backgroundOpacity', c.background_opacity,
        'logoImage', c.logo_image,
        'showLogo', c.show_logo,
        'titleSize', c.title_size,
        'iconKey', c.icon_key,
        'colors', c.colors,
        'totalStamps', c.total_stamps,
        'social', c.social
      )
    ),
    campaign_name = coalesce(nullif(ic.campaign_name, ''), c.name)
from public.campaigns c
where ic.campaign_id = c.id
  and (ic.template_snapshot is null or nullif(ic.campaign_name, '') is null);

do $$
declare
  issued_cards_campaign_fk text;
begin
  select conname
  into issued_cards_campaign_fk
  from pg_constraint
  where conrelid = 'public.issued_cards'::regclass
    and contype = 'f'
    and confrelid = 'public.campaigns'::regclass
    and array_position(
      conkey,
      (
        select attnum
        from pg_attribute
        where attrelid = 'public.issued_cards'::regclass
          and attname = 'campaign_id'
      )
    ) is not null
  limit 1;

  if issued_cards_campaign_fk is not null then
    execute format(
      'alter table public.issued_cards drop constraint %I',
      issued_cards_campaign_fk
    );
  end if;
end;
$$;

alter table public.issued_cards
  alter column campaign_id drop not null;

alter table public.issued_cards
  add constraint issued_cards_campaign_id_fkey
  foreign key (campaign_id)
  references public.campaigns(id)
  on delete set null;

alter table public.issued_cards enable row level security;

drop policy if exists "Owners can manage own issued cards" on public.issued_cards;
create policy "Owners can manage own issued cards"
  on public.issued_cards for all
  using (auth.uid() = owner_id);

drop policy if exists "Staff can read owner issued cards" on public.issued_cards;
create policy "Staff can read owner issued cards"
  on public.issued_cards for select
  using (
    owner_id = (select owner_id from public.profiles where id = auth.uid())
  );

drop policy if exists "Staff can update owner issued cards" on public.issued_cards;
create policy "Staff can update owner issued cards"
  on public.issued_cards for update
  using (
    owner_id = (select owner_id from public.profiles where id = auth.uid())
  );

-- Public card access is handled only via security definer RPCs.
drop policy if exists "Anyone can read issued cards by unique_id" on public.issued_cards;


-- 5. TRANSACTIONS TABLE
create table if not exists public.transactions (
  id text primary key default gen_random_uuid()::text,
  card_id text not null references public.issued_cards(id) on delete cascade,
  type text not null check (type in ('stamp_add', 'stamp_remove', 'redeem', 'issued')),
  amount int not null default 0,
  date text not null,
  "timestamp" bigint not null,
  title text not null,
  remarks text,
  actor_id uuid,
  actor_name text,
  actor_role text
);

alter table public.transactions enable row level security;

drop policy if exists "Owners can manage transactions for own cards" on public.transactions;
create policy "Owners can manage transactions for own cards"
  on public.transactions for all
  using (
    card_id in (select id from public.issued_cards where owner_id = (select auth.uid()))
  );

drop policy if exists "Staff can read owner transactions" on public.transactions;
create policy "Staff can read owner transactions"
  on public.transactions for select
  using (
    card_id in (
      select ic.id from public.issued_cards ic
      where ic.owner_id = (
        select owner_id from public.profiles where id = (select auth.uid())
      )
    )
  );

drop policy if exists "Staff can insert transactions for owner cards" on public.transactions;
create policy "Staff can insert transactions for owner cards"
  on public.transactions for insert
  with check (
    card_id in (
      select ic.id from public.issued_cards ic
      where ic.owner_id = (
        select owner_id from public.profiles where id = (select auth.uid())
      )
    )
  );

-- Public card history is exposed only through get_public_card().
drop policy if exists "Anyone can read transactions for public cards" on public.transactions;


-- 6. LICENSE KEYS TABLE
create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  license_key text not null unique,
  platform text not null default 'gumroad',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.license_keys enable row level security;

drop policy if exists "Users can read own license keys" on public.license_keys;
create policy "Users can read own license keys"
  on public.license_keys for select
  using (profile_id = (select auth.uid()));

-- License activation is handled through activate_license_key().
drop policy if exists "Users can read unclaimed keys by key value" on public.license_keys;

drop policy if exists "Users can claim a license key" on public.license_keys;
create policy "Users can claim a license key"
  on public.license_keys for update
  using (profile_id is null OR profile_id = auth.uid());


-- 7. PUBLIC ACCESS HELPERS
-- Public access is handled through security definer RPCs instead of table-wide read policies.
drop policy if exists "Anyone can read profiles by slug" on public.profiles;

drop policy if exists "Anyone can read campaigns" on public.campaigns;

drop policy if exists "Anyone can read customers" on public.customers;

-- 7A. CAMPAIGN ASSET STORAGE (PUBLIC BUCKET + OBJECT POLICIES)
insert into storage.buckets (id, name, public)
values ('campaign-assets', 'campaign-assets', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Campaign assets are publicly readable" on storage.objects;
create policy "Campaign assets are publicly readable"
  on storage.objects for select
  using (bucket_id = 'campaign-assets');

drop policy if exists "Users can upload own campaign assets" on storage.objects;
create policy "Users can upload own campaign assets"
  on storage.objects for insert
  with check (
    bucket_id = 'campaign-assets'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can update own campaign assets" on storage.objects;
create policy "Users can update own campaign assets"
  on storage.objects for update
  using (
    bucket_id = 'campaign-assets'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'campaign-assets'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can delete own campaign assets" on storage.objects;
create policy "Users can delete own campaign assets"
  on storage.objects for delete
  using (
    bucket_id = 'campaign-assets'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );


-- 8. ACTIVATE LICENSE KEY FUNCTION (RPC)
create or replace function public.activate_license_key(key_input text)
returns jsonb as $$
declare
  key_row public.license_keys%rowtype;
  one_year_later timestamptz;
begin
  select * into key_row
  from public.license_keys
  where license_key = key_input
    and status = 'active'
    and profile_id is null
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid or already used license key');
  end if;

  one_year_later := now() + interval '1 year';

  update public.license_keys
  set profile_id = auth.uid(),
      activated_at = now(),
      expires_at = one_year_later
  where id = key_row.id;

  update public.profiles
  set tier = 'pro',
      tier_expires_at = one_year_later
  where id = auth.uid();

  return jsonb_build_object('success', true, 'expires_at', one_year_later);
end;
$$ language plpgsql security definer
set search_path = public;

create or replace function public.get_scan_entry_context(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_row record;
  card_row record;
begin
  select id, slug, business_name into owner_row
  from public.profiles
  where slug = slug_input and role = 'owner';
  if not found then return null; end if;

  select unique_id into card_row
  from public.issued_cards
  where unique_id = card_unique_id and owner_id = owner_row.id;
  if not found then return null; end if;

  return jsonb_build_object(
    'owner', jsonb_build_object(
      'id', owner_row.id,
      'slug', owner_row.slug,
      'businessName', owner_row.business_name
    ),
    'card', jsonb_build_object(
      'uniqueId', card_row.unique_id
    )
  );
end;
$$ language plpgsql security definer
set search_path = public;

create or replace function public.inspect_scanned_card(card_unique_id uuid)
returns jsonb as $$
declare
  actor_row record;
  card_row record;
  actor_owner_id uuid;
begin
  select id, role, owner_id into actor_row
  from public.profiles
  where id = auth.uid();
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  actor_owner_id := case
    when actor_row.role = 'owner' then actor_row.id
    else actor_row.owner_id
  end;

  if actor_owner_id is null then
    return jsonb_build_object('status', 'missing');
  end if;

  select owner_id into card_row
  from public.issued_cards
  where unique_id = card_unique_id;

  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  if card_row.owner_id <> actor_owner_id then
    return jsonb_build_object('status', 'foreign');
  end if;

  return jsonb_build_object('status', 'owned');
end;
$$ language plpgsql security definer
set search_path = public;


-- 9. CREATE STAFF ACCOUNT (RPC)
create or replace function public.create_staff_account(
  staff_email text,
  staff_pin text,
  staff_name text
)
returns uuid as $$
declare
  new_uid uuid := gen_random_uuid();
  owner_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.profiles where id = owner_uid and role = 'owner'
  ) then
    raise exception 'Only owners can create staff accounts';
  end if;

  if exists (select 1 from auth.users where email = lower(trim(staff_email))) then
    raise exception 'Email already in use';
  end if;

  if length(staff_pin) < 4 or length(staff_pin) > 6 then
    raise exception 'PIN must be 4-6 digits';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    created_at, updated_at, is_sso_user
  ) values (
    new_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    lower(trim(staff_email)),
    crypt(staff_pin, gen_salt('bf')),
    now(),
    jsonb_build_object('role', 'staff', 'owner_id', owner_uid::text, 'business_name', staff_name),
    jsonb_build_object('provider', 'email', 'providers', array_to_json(array['email'])),
    now(),
    now(),
    false
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    new_uid,
    new_uid,
    jsonb_build_object('sub', new_uid::text, 'email', lower(trim(staff_email))),
    'email',
    new_uid::text,
    now(),
    now(),
    now()
  );

  return new_uid;
end;
$$ language plpgsql security definer
set search_path = public;


-- 10. UPDATE STAFF PIN (RPC)
create or replace function public.update_staff_pin(staff_id uuid, new_pin text)
returns void as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = staff_id and role = 'staff' and owner_id = auth.uid()
  ) then
    raise exception 'Not your staff member';
  end if;

  update auth.users
  set encrypted_password = crypt(new_pin, gen_salt('bf')),
      updated_at = now()
  where id = staff_id;
end;
$$ language plpgsql security definer
set search_path = public;


-- 11. DELETE STAFF ACCOUNT (RPC)
create or replace function public.delete_staff_account(staff_id uuid)
returns void as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = staff_id and role = 'staff' and owner_id = auth.uid()
  ) then
    raise exception 'Not your staff member';
  end if;

  delete from auth.users
  where id = staff_id;
end;
$$ language plpgsql security definer
set search_path = public;


-- 12. DELETE OWN ACCOUNT (RPC)
create or replace function public.delete_own_account()
returns void as $$
declare
  uid uuid := auth.uid();
begin
  delete from auth.users where id in (
    select id from public.profiles where owner_id = uid and role = 'staff'
  );
  delete from auth.users where id = uid;
end;
$$ language plpgsql security definer
set search_path = public;


-- 13. CHECK SLUG AVAILABILITY (RPC)
create or replace function public.is_slug_available(slug_input text)
returns boolean as $$
begin
  return not exists (
    select 1 from public.profiles
    where slug = lower(trim(slug_input))
    and role = 'owner'
  );
end;
$$ language plpgsql security definer
set search_path = public;

create or replace function public.get_public_campaign_signup_context(slug_input text, campaign_id_input text)
returns jsonb as $$
declare
  owner_row record;
  campaign_row record;
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
    )
  );
end;
$$ language plpgsql security definer
set search_path = public;

create or replace function public.register_public_campaign_signup(
  slug_input text,
  campaign_id_input text,
  customer_name_input text,
  customer_email_input text default null,
  customer_mobile_input text default null
)
returns jsonb as $$
declare
  owner_row record;
  campaign_row public.campaigns%rowtype;
  customer_row public.customers%rowtype;
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
  from public.profiles
  where slug = slug_input and role = 'owner';
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Business not found.');
  end if;

  select *
  into campaign_row
  from public.campaigns
  where id = campaign_id_input
    and owner_id = owner_row.id;
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Campaign not found.');
  end if;

  if normalized_email is not null or normalized_mobile is not null then
    select *
    into customer_row
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

  if customer_row.id is null then
    insert into public.customers (id, owner_id, name, email, mobile, status)
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

  insert into public.issued_cards (
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
    0,
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
      'social', campaign_row.social
    )
  );

  insert into public.transactions (
    id,
    card_id,
    type,
    amount,
    date,
    "timestamp",
    title
  )
  values (
    gen_random_uuid()::text,
    new_card_id,
    'issued',
    0,
    to_char(now_ts, 'Mon FMDD, YYYY FMHH12:MI AM'),
    floor(extract(epoch from now_ts) * 1000)::bigint,
    'Card Issued'
  );

  return jsonb_build_object('outcome', 'issued', 'uniqueId', new_unique_id);
end;
$$ language plpgsql security definer
set search_path = public;

create or replace function public.delete_campaign_preserve_cards(campaign_id_input text)
returns jsonb as $$
declare
  campaign_row public.campaigns%rowtype;
  campaign_snapshot jsonb;
begin
  select *
  into campaign_row
  from public.campaigns
  where id = campaign_id_input
    and owner_id = auth.uid();

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
    'social', campaign_row.social
  );

  update public.issued_cards
  set template_snapshot = coalesce(template_snapshot, campaign_snapshot),
      campaign_name = coalesce(nullif(campaign_name, ''), campaign_row.name)
  where campaign_id = campaign_row.id;

  delete from public.campaigns
  where id = campaign_row.id;

  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer
set search_path = public;


-- 14. GET PUBLIC CARD DATA (RPC)
create or replace function public.get_public_card(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_row record;
  card_row record;
  customer_row record;
  campaign_payload jsonb;
  history_data jsonb;
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
    'id', c.id,
    'name', c.name,
    'description', c.description,
    'reward_name', c.reward_name,
    'tagline', c.tagline,
    'background_image', c.background_image,
    'background_opacity', c.background_opacity,
    'logo_image', c.logo_image,
    'show_logo', c.show_logo,
    'title_size', c.title_size,
    'icon_key', c.icon_key,
    'colors', c.colors,
    'total_stamps', c.total_stamps,
    'social', c.social
  )
  into campaign_payload
  from public.campaigns c
  where c.id = card_row.campaign_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'type', t.type, 'amount', t.amount,
      'date', t.date, 'timestamp', t."timestamp", 'title', t.title
    ) order by t."timestamp"
  ), '[]'::jsonb)
  into history_data
  from public.transactions t where t.card_id = card_row.id;

  return jsonb_build_object(
    'card', jsonb_build_object(
      'id', card_row.id, 'uniqueId', card_row.unique_id,
      'campaignId', card_row.campaign_id, 'campaignName', card_row.campaign_name,
      'stamps', card_row.stamps, 'lastVisit', card_row.last_visit,
      'status', card_row.status, 'completedDate', card_row.completed_date,
      'templateSnapshot', card_row.template_snapshot,
      'history', history_data
    ),
    'customer', jsonb_build_object(
      'id', customer_row.id, 'name', customer_row.name
    ),
    'campaign', campaign_payload
  );
end;
$$ language plpgsql security definer
set search_path = public;

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
-- Adds company-wide interface language and currency preferences.
alter table public.profiles
  add column if not exists interface_language text not null default 'pt-BR',
  add column if not exists currency_code text not null default 'BRL';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_interface_language_check'
  ) then
    alter table public.profiles
      add constraint profiles_interface_language_check
      check (interface_language in ('pt-BR', 'es', 'en'));
  end if;

end;
$$;

alter table public.profiles
  drop constraint if exists profiles_currency_code_check;
alter table public.profiles
  add constraint profiles_currency_code_check
  check (currency_code in ('BRL', 'USD', 'EUR', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'UYU'));

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

-- Owner-only reset for operational business data. Keeps owner/staff accounts,
-- company profile, locale preferences, license keys, and the database schema.

create or replace function public.reset_owner_business_data()
returns jsonb as $$
declare
  owner_id_value uuid;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid()
    and p.role = 'owner'
    and p.access = 'active'
  for update;

  if owner_id_value is null then
    raise exception 'Active owner authentication required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('reset-business-data'));

  delete from public.trusted_card_action_events e
  using public.transactions t
  join public.issued_cards c on c.id = t.card_id
  where e.transaction_id = t.id
    and c.owner_id = owner_id_value;

  -- Delete restricted reward-code references before the reward catalog.
  delete from public.loyalty_reward_redemptions
  where owner_id = owner_id_value;
  delete from public.loyalty_rewards
  where owner_id = owner_id_value;

  -- Mission progress, completions, and delivery history cascade from missions.
  delete from public.loyalty_missions
  where owner_id = owner_id_value;

  -- Customer deletion cascades cards, transactions, points, badges, and claims.
  delete from public.customers
  where owner_id = owner_id_value;

  delete from public.campaigns
  where owner_id = owner_id_value;
  delete from public.loyalty_point_levels
  where owner_id = owner_id_value;
  delete from public.loyalty_points_programs
  where owner_id = owner_id_value;

  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.reset_owner_business_data() from public, anon;
grant execute on function public.reset_owner_business_data() to authenticated;

notify pgrst, 'reload schema';
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
