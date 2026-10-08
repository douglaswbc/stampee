-- Add private business-site lead storage and a public, rate-limited submission RPC.
-- Execute this additive patch on existing projects; it does not alter existing records.

create table if not exists public.business_site_leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);

create index if not exists business_site_leads_owner_created_idx
  on public.business_site_leads(owner_id, created_at desc);

alter table public.business_site_leads enable row level security;
revoke all on public.business_site_leads from public, anon, authenticated;

create table if not exists public.business_site_lead_rate_limits (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  ip_fingerprint text not null,
  created_at timestamptz not null default now()
);

create index if not exists business_site_lead_rate_limits_lookup_idx
  on public.business_site_lead_rate_limits(owner_id, ip_fingerprint, created_at desc);

alter table public.business_site_lead_rate_limits enable row level security;
revoke all on public.business_site_lead_rate_limits from public, anon, authenticated;

create or replace function public.submit_business_site_lead(
  slug_input text,
  name_input text,
  email_input text,
  phone_input text,
  message_input text,
  consent_input boolean,
  honeypot_input text,
  ip_fingerprint_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id_value uuid;
  name_value text := trim(coalesce(name_input, ''));
  email_value text := nullif(lower(trim(coalesce(email_input, ''))), '');
  phone_value text := nullif(trim(coalesce(phone_input, '')), '');
  message_value text := trim(coalesce(message_input, ''));
  recent_count integer;
begin
  -- A filled honeypot is accepted without storing a lead to avoid exposing the trap.
  if nullif(trim(coalesce(honeypot_input, '')), '') is not null then
    return jsonb_build_object('outcome', 'accepted');
  end if;

  if coalesce(consent_input, false) is not true then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if length(name_value) < 2 or length(name_value) > 120
     or length(message_value) < 5 or length(message_value) > 3000
     or (email_value is null and phone_value is null)
     or (email_value is not null and (length(email_value) > 254 or email_value !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
     or (phone_value is not null and length(phone_value) > 40)
     or coalesce(ip_fingerprint_input, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select p.id into owner_id_value
  from public.business_sites site
  join public.profiles p on p.id = site.owner_id
  where lower(site.slug) = lower(trim(coalesce(slug_input, '')))
    and site.published_content is not null
    and p.role = 'owner'
    and p.access = 'active'
  limit 1;
  if owner_id_value is null then
    return jsonb_build_object('outcome', 'unavailable');
  end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext(ip_fingerprint_input));
  delete from public.business_site_lead_rate_limits
  where owner_id = owner_id_value and created_at < now() - interval '1 day';

  select count(*)::integer into recent_count
  from public.business_site_lead_rate_limits
  where owner_id = owner_id_value
    and ip_fingerprint = ip_fingerprint_input
    and created_at > now() - interval '10 minutes';
  if recent_count >= 5 then
    return jsonb_build_object('outcome', 'rate_limited');
  end if;

  insert into public.business_site_lead_rate_limits(owner_id, ip_fingerprint)
  values (owner_id_value, ip_fingerprint_input);
  insert into public.business_site_leads(owner_id, name, email, phone, message, consented_at)
  values (owner_id_value, name_value, email_value, phone_value, message_value, now());

  return jsonb_build_object('outcome', 'created');
end;
$$;
revoke all on function public.submit_business_site_lead(text, text, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.submit_business_site_lead(text, text, text, text, text, boolean, text, text) to service_role;

create or replace function public.get_business_site_leads()
returns table (
  id uuid,
  name text,
  email text,
  phone text,
  message text,
  status text,
  consented_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id_value uuid;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active business owner access required.'; end if;

  return query
  select lead.id, lead.name, lead.email, lead.phone, lead.message, lead.status, lead.consented_at, lead.created_at
  from public.business_site_leads lead
  where lead.owner_id = owner_id_value
  order by lead.created_at desc
  limit 200;
end;
$$;
revoke all on function public.get_business_site_leads() from public, anon;
grant execute on function public.get_business_site_leads() to authenticated;

create or replace function public.update_business_site_lead_status(lead_id_input uuid, status_input text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id_value uuid;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'owner' and p.access = 'active';
  if owner_id_value is null then raise exception 'Active business owner access required.'; end if;
  if status_input not in ('new', 'contacted', 'closed') then raise exception 'Invalid lead status.'; end if;

  update public.business_site_leads
  set status = status_input, updated_at = now()
  where id = lead_id_input and owner_id = owner_id_value;
  return found;
end;
$$;
revoke all on function public.update_business_site_lead_status(uuid, text) from public, anon;
grant execute on function public.update_business_site_lead_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
