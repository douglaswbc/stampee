-- Production bootstrap for the first Stampfy platform administrator.
-- First create the user in Supabase Authentication with a unique password.
-- Replace the email below, then run this script in the Supabase SQL Editor.
do $$
declare
  admin_email text := 'replace-with-your-admin-email@example.com';
  admin_uid uuid;
begin
  select id into admin_uid
  from auth.users
  where lower(email) = lower(admin_email)
  limit 1;

  if admin_uid is null then
    raise exception 'Create the Auth user first, then rerun this bootstrap.';
  end if;

  update public.profiles
  set role = 'platform_admin',
      business_name = 'Stampfy Platform',
      slug = null,
      status = 'verified',
      access = 'active'
  where id = admin_uid;

  if not found then
    raise exception 'The Auth user has no profile. Run the canonical migration first.';
  end if;

  insert into public.platform_admins(user_id, email)
  values (admin_uid, lower(admin_email))
  on conflict (user_id) do update set email = excluded.email;
end;
$$;
