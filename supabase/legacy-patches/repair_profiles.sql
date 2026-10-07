-- ============================================================
-- Stampfy: Repair Missing Profiles
-- Repair script for existing Supabase projects.
-- Run this once in Supabase SQL Editor if users exist in auth.users
-- but are missing rows in public.profiles.
-- New projects should use migration.sql instead.
-- ============================================================

do $$
declare
  u record;
  v_role text;
  v_owner_id uuid;
  v_slug text;
begin
  for u in
    select
      au.id,
      au.email,
      au.raw_user_meta_data,
      au.created_at
    from auth.users au
    left join public.profiles p on p.id = au.id
    where p.id is null
      and au.email is not null
  loop
    v_role := case
      when coalesce(u.raw_user_meta_data->>'role', 'owner') = 'staff' then 'staff'
      else 'owner'
    end;

    if v_role = 'staff'
      and (u.raw_user_meta_data->>'owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      v_owner_id := (u.raw_user_meta_data->>'owner_id')::uuid;
    else
      v_owner_id := null;
    end if;

    if v_role = 'owner' then
      v_slug := nullif(lower(trim(u.raw_user_meta_data->>'slug')), '');
    else
      v_slug := null;
    end if;

    begin
      insert into public.profiles (
        id,
        business_name,
        email,
        slug,
        role,
        owner_id,
        status,
        access,
        tier,
        created_at
      )
      values (
        u.id,
        coalesce(
          nullif(trim(u.raw_user_meta_data->>'business_name'), ''),
          split_part(lower(u.email), '@', 1)
        ),
        lower(u.email),
        v_slug,
        v_role,
        v_owner_id,
        'unverified',
        'active',
        'free',
        coalesce(u.created_at, now())
      );
    exception when unique_violation then
      -- Most commonly slug conflict. Retry without slug.
      insert into public.profiles (
        id,
        business_name,
        email,
        slug,
        role,
        owner_id,
        status,
        access,
        tier,
        created_at
      )
      values (
        u.id,
        coalesce(
          nullif(trim(u.raw_user_meta_data->>'business_name'), ''),
          split_part(lower(u.email), '@', 1)
        ),
        lower(u.email),
        null,
        v_role,
        v_owner_id,
        'unverified',
        'active',
        'free',
        coalesce(u.created_at, now())
      )
      on conflict (id) do nothing;
    when others then
      raise notice 'Profile repair failed for % (%): %', u.id, u.email, sqlerrm;
    end;
  end loop;
end
$$ language plpgsql;

update public.profiles p
set owner_id = (au.raw_user_meta_data->>'owner_id')::uuid
from auth.users au
where p.id = au.id
  and p.role = 'staff'
  and p.owner_id is null
  and (au.raw_user_meta_data->>'owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Quick checks
select count(*) as users_missing_profile
from auth.users au
left join public.profiles p on p.id = au.id
where p.id is null;

select id, email, role, slug
from public.profiles
order by created_at desc
limit 20;
