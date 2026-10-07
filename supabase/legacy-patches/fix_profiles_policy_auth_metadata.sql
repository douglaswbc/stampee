-- Stampfy upgrade script: avoid using editable auth user_metadata in
-- profiles RLS on existing projects.
-- New projects should use migration.sql instead.

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

drop policy if exists "Staff can read owner profile" on public.profiles;

create policy "Staff can read owner profile"
  on public.profiles for select
  using (
    id = (select public.current_staff_owner_id())
  );
