-- Stampfy upgrade script: set a stable search_path on
-- public.is_slug_available for existing projects.
-- New projects should use migration.sql instead.

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
