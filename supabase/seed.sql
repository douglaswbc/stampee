-- ============================================================
-- Stampfy: Development Seed Script
-- Local/development use only.
-- ============================================================
-- Run this in the Supabase SQL Editor AFTER running migration.sql.
-- This creates the demo business owner and platform administrator with known
-- credentials for local or development environments only.
--
-- Demo credentials:
--   Email   : admin@stampfy.com
--   Password: teste123
--   Slug    : demo
-- Platform admin credentials:
--   Email   : douglas.cuimar@gmail.com
--   Password: _032507@DwbC
-- ============================================================

do $$
declare
  v_uid uuid := gen_random_uuid();
  v_existing_uid uuid;
  v_column record;
  v_email text := 'admin@stampfy.com';
  v_password text := 'teste123';
  v_business_name text := 'Demo Business';
  v_slug text := 'demo';
begin
  -- Skip if the admin account already exists
  select id into v_existing_uid
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_existing_uid is not null then
    -- GoTrue expects token fields to be empty strings, not NULL. Older versions
    -- of this seed omitted these fields when inserting directly into auth.users.
    for v_column in
      select column_name
      from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'users'
        and column_name in (
          'confirmation_token',
          'recovery_token',
          'email_change',
          'email_change_token_new',
          'email_change_token_current',
          'phone_change',
          'phone_change_token',
          'reauthentication_token'
        )
    loop
      execute format(
        'update auth.users set %1$I = %2$L where id = $1 and %1$I is null',
        v_column.column_name,
        ''
      ) using v_existing_uid;
    end loop;

    raise notice 'Demo admin already exists. Skipping seed.';
    return;
  end if;

  -- Create the Supabase auth user
  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    raw_app_meta_data,
    created_at,
    updated_at,
    is_sso_user
  ) values (
    v_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    jsonb_build_object(
      'role', 'owner',
      'business_name', v_business_name,
      'slug', v_slug
    ),
    jsonb_build_object('provider', 'email', 'providers', array_to_json(array['email'])),
    now(),
    now(),
    false
  );

  -- Keep nullable GoTrue token fields compatible with password sign-in.
  for v_column in
    select column_name
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name in (
        'confirmation_token',
        'recovery_token',
        'email_change',
        'email_change_token_new',
        'email_change_token_current',
        'phone_change',
        'phone_change_token',
        'reauthentication_token'
      )
  loop
    execute format(
      'update auth.users set %1$I = %2$L where id = $1 and %1$I is null',
      v_column.column_name,
      ''
    ) using v_uid;
  end loop;

  -- Create the identity record (required for email/password sign-in)
  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    v_uid,
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email),
    'email',
    v_uid::text,
    now(),
    now(),
    now()
  );

  -- The handle_new_user trigger auto-creates the profile row.
  -- Update it to set verified status and the correct slug.
  update public.profiles
  set
    status = 'verified',
    slug   = v_slug,
    tier   = 'free'
  where id = v_uid;

  raise notice 'Demo admin created successfully.';
  raise notice '  Email   : %', v_email;
  raise notice '  Password: %', v_password;
  raise notice '  Slug    : %', v_slug;
end;
$$;

-- Local/development platform administrator. Never use these credentials in production.
-- Production bootstrap should use a real, individually provisioned Auth user and a unique password.
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_existing_uid uuid;
  v_column record;
  v_email text := 'douglas.cuimar@gmail.com';
  v_password text := '_032507@DwbC';
  v_created boolean := false;
begin
  select id into v_existing_uid
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_existing_uid is not null then
    v_uid := v_existing_uid;
  else
    v_created := true;
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_user_meta_data,
      raw_app_meta_data,
      created_at,
      updated_at,
      is_sso_user
    ) values (
      v_uid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      jsonb_build_object('role', 'owner', 'business_name', 'Stampfy Platform'),
      jsonb_build_object('provider', 'email', 'providers', array_to_json(array['email'])),
      now(),
      now(),
      false
    );
  end if;

  for v_column in
    select column_name
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name in (
        'confirmation_token',
        'recovery_token',
        'email_change',
        'email_change_token_new',
        'email_change_token_current',
        'phone_change',
        'phone_change_token',
        'reauthentication_token'
      )
  loop
    execute format(
      'update auth.users set %1$I = %2$L where id = $1 and %1$I is null',
      v_column.column_name,
      ''
    ) using v_uid;
  end loop;

  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    v_uid,
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email),
    'email',
    v_uid::text,
    now(),
    now(),
    now()
  ) on conflict (id) do nothing;

  -- The auth trigger creates a normal owner profile first. Privilege is then
  -- granted explicitly by this trusted seed and recorded in the private registry.
  update public.profiles
  set role = 'platform_admin',
      business_name = 'Stampfy Platform',
      slug = null,
      status = 'verified',
      access = 'active',
      tier = 'free'
  where id = v_uid;

  if not found then
    raise exception 'Platform profile was not created. Run migration.sql before seed.sql.';
  end if;

  insert into public.platform_admins(user_id, email)
  values (v_uid, v_email)
  on conflict (user_id) do update set email = excluded.email;

  if v_created then
    raise notice 'Development platform administrator is ready: %', v_email;
    raise notice 'Development password: %', v_password;
  else
    raise notice 'Platform administrator already exists; its password was not changed.';
  end if;
end;
$$;
