-- Adds the first Stampfy SaaS control-plane foundation.
-- Apply after the current canonical migration on existing Supabase projects.
-- Each owner profile remains one tenant; existing owner_id columns keep isolating business data.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'staff', 'platform_admin'));

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  )
$$;
revoke all on function public.is_platform_admin() from public, anon, authenticated;

create or replace function public.guard_profile_privilege_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_platform_admin boolean := public.is_platform_admin();
begin
  if actor_id is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role or new.owner_id is distinct from old.owner_id then
    raise exception 'Profile role and tenant ownership cannot be changed by a client.';
  end if;

  if (new.status is distinct from old.status
      or new.tier is distinct from old.tier
      or new.tier_expires_at is distinct from old.tier_expires_at)
     and not actor_is_platform_admin then
    raise exception 'Only platform administrators can change account status or plan.';
  end if;

  if new.access is distinct from old.access
     and not actor_is_platform_admin
     and not (old.role = 'staff' and old.owner_id = actor_id) then
    raise exception 'Only the business owner or a platform administrator can change access.';
  end if;

  return new;
end;
$$;
drop trigger if exists guard_profile_privilege_changes on public.profiles;
create trigger guard_profile_privilege_changes
  before update on public.profiles
  for each row execute function public.guard_profile_privilege_changes();

drop policy if exists "Allow trigger insert for new signups" on public.profiles;
create policy "Allow trigger insert for new signups"
  on public.profiles for insert
  with check (auth.uid() = id and role = 'owner');

-- Never trust user-editable auth metadata for elevated application roles.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role text;
  v_owner_id uuid;
begin
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
$$ language plpgsql security definer
set search_path = public;

-- Staff can only be created through this owner-authenticated database function.
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
    select 1 from public.profiles where id = owner_uid and role = 'owner' and access = 'active'
  ) then
    raise exception 'Only active owners can create staff accounts';
  end if;

  if exists (select 1 from auth.users where email = lower(trim(staff_email))) then
    raise exception 'Email already in use';
  end if;
  if length(staff_pin) < 4 or length(staff_pin) > 6 or staff_pin !~ '^[0-9]+$' then
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
    jsonb_build_object(
      'provider', 'email',
      'providers', array_to_json(array['email']),
      'stampfy_role', 'staff',
      'stampfy_owner_id', owner_uid::text
    ),
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
revoke all on function public.create_staff_account(text, text, text) from public, anon;
grant execute on function public.create_staff_account(text, text, text) to authenticated;

create or replace function public.platform_list_tenants()
returns table (
  id uuid,
  business_name text,
  email text,
  slug text,
  access text,
  tier text,
  created_at timestamptz,
  staff_count bigint,
  campaign_count bigint,
  customer_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required.';
  end if;

  return query
  select
    p.id,
    p.business_name,
    p.email,
    p.slug,
    p.access,
    p.tier,
    p.created_at,
    (select count(*) from public.profiles staff where staff.owner_id = p.id and staff.role = 'staff'),
    (select count(*) from public.campaigns c where c.owner_id = p.id),
    (select count(*) from public.customers c where c.owner_id = p.id)
  from public.profiles p
  where p.role = 'owner'
  order by p.created_at desc;
end;
$$;
revoke all on function public.platform_list_tenants() from public, anon;
grant execute on function public.platform_list_tenants() to authenticated;

create or replace function public.platform_set_tenant_access(owner_uid uuid, access_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required.';
  end if;
  if access_value not in ('active', 'disabled') then
    raise exception 'Invalid tenant access state.';
  end if;

  update public.profiles
  set access = access_value
  where id = owner_uid and role = 'owner';

  if not found then
    raise exception 'Business tenant not found.';
  end if;
end;
$$;
revoke all on function public.platform_set_tenant_access(uuid, text) from public, anon;
grant execute on function public.platform_set_tenant_access(uuid, text) to authenticated;

create or replace function public.current_tenant_access_active()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles actor
    join public.profiles tenant
      on tenant.id = case when actor.role = 'owner' then actor.id else actor.owner_id end
    where actor.id = (select auth.uid())
      and actor.role in ('owner', 'staff')
      and tenant.role = 'owner'
      and tenant.access = 'active'
  )
$$;
revoke all on function public.current_tenant_access_active() from public, anon;
grant execute on function public.current_tenant_access_active() to authenticated;

do $$
declare
  tenant_table record;
begin
  for tenant_table in
    select distinct t.table_name
    from information_schema.tables t
    join information_schema.columns c
      on c.table_schema = t.table_schema and c.table_name = t.table_name
    where t.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.column_name = 'owner_id'
      and t.table_name not in ('profiles', 'platform_admins')
  loop
    execute format('alter table public.%I enable row level security', tenant_table.table_name);
    execute format('drop policy if exists tenant_active_access_guard on public.%I', tenant_table.table_name);
    execute format(
      'create policy tenant_active_access_guard on public.%I as restrictive for all to authenticated using (public.current_tenant_access_active()) with check (public.current_tenant_access_active())',
      tenant_table.table_name
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
