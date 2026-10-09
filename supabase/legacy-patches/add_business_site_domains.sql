-- Adds one custom-domain pair per published business site.
-- DNS and Vercel challenge values are stored for the authenticated owner only.

create table if not exists public.business_site_domains (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  apex_domain text not null unique,
  primary_domain text not null unique,
  status text not null default 'pending_dns' check (status in ('pending_dns', 'active')),
  dns_records jsonb not null default '{"primary":[],"apex":[]}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (apex_domain = lower(apex_domain)),
  check (primary_domain = lower(primary_domain)),
  check (primary_domain = 'www.' || apex_domain)
);

alter table public.business_site_domains enable row level security;
revoke all on public.business_site_domains from public, anon, authenticated;

create or replace function public.get_business_site_domain()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare owner_id_value uuid; result_value jsonb;
begin
  select p.id into owner_id_value from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active business owner access required.'; end if;

  select jsonb_build_object(
    'apexDomain', apex_domain,
    'primaryDomain', primary_domain,
    'status', status,
    'dnsRecords', dns_records,
    'verifiedAt', verified_at
  ) into result_value
  from public.business_site_domains where owner_id = owner_id_value;
  return result_value;
end;
$$;
revoke all on function public.get_business_site_domain() from public, anon;
grant execute on function public.get_business_site_domain() to authenticated;

create or replace function public.get_public_business_site_by_host(host_input text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select public.get_public_business_site(s.slug)
  from public.business_site_domains d
  join public.business_sites s on s.owner_id = d.owner_id
  join public.profiles p on p.id = d.owner_id
  where d.primary_domain = lower(trim(coalesce(host_input, '')))
    and d.status = 'active'
    and p.role = 'owner'
    and p.access = 'active'
    and s.published_content is not null
  limit 1
$$;
revoke all on function public.get_public_business_site_by_host(text) from public;
grant execute on function public.get_public_business_site_by_host(text) to anon, authenticated;

notify pgrst, 'reload schema';
