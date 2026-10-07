-- Stampfy upgrade script: set a stable search_path on
-- public.activate_license_key for existing projects.
-- New projects should use migration.sql instead.

alter function public.activate_license_key(text)
set search_path = public;
