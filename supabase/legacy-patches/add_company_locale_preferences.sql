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
