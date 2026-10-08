-- Tenant-scoped Zernio setup, explicit WhatsApp consent, and an idempotent notification outbox.
-- Additive patch for existing Stampfy databases. Provider keys are stored encrypted by the Vercel API.

create table if not exists public.company_communication_integrations (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  zernio_api_key_ciphertext text,
  zernio_profile_id text,
  whatsapp_account_id text,
  whatsapp_display_name text,
  instagram_account_id text,
  instagram_username text,
  phone_country_code text not null default '55' check (phone_country_code ~ '^[0-9]{1,3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.company_communication_integrations enable row level security;
revoke all on public.company_communication_integrations from public, anon, authenticated;
grant all on public.company_communication_integrations to service_role;

create table if not exists public.customer_notification_preferences (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  whatsapp_marketing_opt_in boolean not null default false,
  whatsapp_consented_at timestamptz,
  whatsapp_revoked_at timestamptz,
  consent_source text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, customer_id),
  constraint customer_notification_consent_audit check (
    not whatsapp_marketing_opt_in or (whatsapp_consented_at is not null and whatsapp_revoked_at is null)
  )
);
alter table public.customer_notification_preferences enable row level security;
revoke all on public.customer_notification_preferences from public, anon, authenticated;
grant all on public.customer_notification_preferences to service_role;

create table if not exists public.company_notification_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('visit_validated', 'mission_completed', 'reward_claimed')),
  account_id text not null,
  template_name text not null,
  template_language text not null,
  template_status text not null default 'PENDING',
  template_parameter_count integer not null default 0 check (template_parameter_count between 0 and 20),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (owner_id, event_type)
);
alter table public.company_notification_templates enable row level security;
revoke all on public.company_notification_templates from public, anon, authenticated;
grant all on public.company_notification_templates to service_role;

create table if not exists public.communication_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  event_type text not null check (event_type in ('visit_validated', 'mission_completed', 'reward_claimed')),
  event_key text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (owner_id, event_key)
);
create index if not exists communication_outbox_pending_idx
  on public.communication_notification_outbox(status, next_attempt_at, created_at)
  where status in ('pending', 'processing');
create index if not exists communication_outbox_owner_created_idx
  on public.communication_notification_outbox(owner_id, created_at desc);
alter table public.communication_notification_outbox enable row level security;
revoke all on public.communication_notification_outbox from public, anon, authenticated;
grant all on public.communication_notification_outbox to service_role;

create table if not exists public.communication_notification_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  outbox_id uuid not null references public.communication_notification_outbox(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 5),
  outcome text not null check (outcome in ('sent', 'retry', 'failed', 'skipped')),
  error_code text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index if not exists communication_notification_attempts_owner_created_idx
  on public.communication_notification_attempts(owner_id, created_at desc);
create index if not exists communication_notification_attempts_outbox_created_idx
  on public.communication_notification_attempts(outbox_id, created_at desc);
alter table public.communication_notification_attempts enable row level security;
revoke all on public.communication_notification_attempts from public, anon, authenticated;
grant all on public.communication_notification_attempts to service_role;

create or replace function public.register_public_campaign_signup_with_consent(
  slug_input text,
  campaign_id_input text,
  customer_name_input text,
  customer_email_input text default null,
  customer_mobile_input text default null,
  referral_code_input text default null,
  whatsapp_opt_in_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_result jsonb;
  card_row public.issued_cards%rowtype;
begin
  signup_result := public.register_public_campaign_signup(
    slug_input, campaign_id_input, customer_name_input, customer_email_input,
    customer_mobile_input, referral_code_input
  );

  if coalesce(whatsapp_opt_in_input, false)
     and nullif(regexp_replace(coalesce(customer_mobile_input, ''), '[^0-9]+', '', 'g'), '') is not null
     and signup_result->>'outcome' in ('issued', 'redirect_existing') then
    select ic.* into card_row
    from public.issued_cards ic
    join public.profiles p on p.id = ic.owner_id
    where ic.unique_id = (signup_result->>'uniqueId')::uuid
      and p.slug = slug_input and p.role = 'owner' and p.access = 'active'
    limit 1;

    if found then
      insert into public.customer_notification_preferences(
        owner_id, customer_id, whatsapp_marketing_opt_in,
        whatsapp_consented_at, whatsapp_revoked_at, consent_source, updated_at
      ) values (
        card_row.owner_id, card_row.customer_id, true, now(), null,
        'public_campaign_signup', now()
      )
      on conflict (owner_id, customer_id) do update
        set whatsapp_marketing_opt_in = true,
            whatsapp_consented_at = excluded.whatsapp_consented_at,
            whatsapp_revoked_at = null,
            consent_source = excluded.consent_source,
            updated_at = now();
    end if;
  end if;

  return signup_result;
end;
$$;
revoke all on function public.register_public_campaign_signup_with_consent(text, text, text, text, text, text, boolean) from public;
grant execute on function public.register_public_campaign_signup_with_consent(text, text, text, text, text, text, boolean) to anon, authenticated;

create or replace function public.revoke_public_whatsapp_notification_consent(slug_input text, card_unique_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id_value uuid;
  customer_id_value text;
begin
  select ic.owner_id, ic.customer_id into owner_id_value, customer_id_value
  from public.issued_cards ic
  join public.profiles p on p.id = ic.owner_id
  where ic.unique_id = card_unique_id and p.slug = slug_input and p.role = 'owner'
  limit 1;
  if owner_id_value is null then return false; end if;

  update public.customer_notification_preferences
  set whatsapp_marketing_opt_in = false, whatsapp_revoked_at = now(), updated_at = now()
  where owner_id = owner_id_value and customer_id = customer_id_value;
  if not found then return false; end if;

  update public.communication_notification_outbox
  set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
  where owner_id = owner_id_value and customer_id = customer_id_value and status = 'pending';
  return true;
end;
$$;
revoke all on function public.revoke_public_whatsapp_notification_consent(text, uuid) from public;
grant execute on function public.revoke_public_whatsapp_notification_consent(text, uuid) to anon, authenticated;

create or replace function public.enqueue_communication_notification(
  owner_id_input uuid, customer_id_input text, event_type_input text, event_key_input text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if event_type_input not in ('visit_validated', 'mission_completed', 'reward_claimed') then return; end if;
  if not exists (
    select 1 from public.customer_notification_preferences p
    where p.owner_id = owner_id_input and p.customer_id = customer_id_input
      and p.whatsapp_marketing_opt_in and p.whatsapp_revoked_at is null
  ) then return; end if;
  if not exists (
    select 1
    from public.company_communication_integrations i
    join public.company_notification_templates t
      on t.owner_id = i.owner_id and t.account_id = i.whatsapp_account_id
    where i.owner_id = owner_id_input and i.zernio_api_key_ciphertext is not null
      and i.whatsapp_account_id is not null
      and exists (select 1 from public.profiles p where p.id = i.owner_id and p.role = 'owner' and p.access = 'active')
      and t.event_type = event_type_input and t.enabled and t.template_status = 'APPROVED'
      and t.template_parameter_count = 0
  ) then return; end if;

  insert into public.communication_notification_outbox(owner_id, customer_id, event_type, event_key)
  values (owner_id_input, customer_id_input, event_type_input, event_key_input)
  on conflict (owner_id, event_key) do nothing;
end;
$$;
revoke all on function public.enqueue_communication_notification(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.enqueue_stamp_visit_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id_value uuid;
  customer_id_value text;
begin
  if new.type <> 'stamp_add' then return new; end if;
  select ic.owner_id, ic.customer_id into owner_id_value, customer_id_value
  from public.issued_cards ic where ic.id = new.card_id;
  if owner_id_value is not null then
    perform public.enqueue_communication_notification(owner_id_value, customer_id_value, 'visit_validated', 'visit:' || new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_stamp_visit_notification() from public, anon, authenticated;
drop trigger if exists transaction_zz_communication_notification on public.transactions;
create trigger transaction_zz_communication_notification
  after insert on public.transactions
  for each row execute function public.enqueue_stamp_visit_notification();

create or replace function public.enqueue_mission_completion_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id_value uuid;
begin
  select m.owner_id into owner_id_value from public.loyalty_missions m where m.id = new.mission_id;
  if owner_id_value is not null then
    perform public.enqueue_communication_notification(owner_id_value, new.customer_id, 'mission_completed', 'mission:' || new.id::text);
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_mission_completion_notification() from public, anon, authenticated;
drop trigger if exists mission_completion_zz_communication_notification on public.mission_completions;
create trigger mission_completion_zz_communication_notification
  after insert on public.mission_completions
  for each row execute function public.enqueue_mission_completion_notification();

create or replace function public.enqueue_reward_claim_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'issued' then
    perform public.enqueue_communication_notification(new.owner_id, new.customer_id, 'reward_claimed', 'reward:' || new.id::text);
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_reward_claim_notification() from public, anon, authenticated;
drop trigger if exists reward_redemption_zz_communication_notification on public.loyalty_reward_redemptions;
create trigger reward_redemption_zz_communication_notification
  after insert on public.loyalty_reward_redemptions
  for each row execute function public.enqueue_reward_claim_notification();

create or replace function public.claim_communication_notifications()
returns table (
  outbox_id uuid, owner_id uuid, customer_id text, customer_name text,
  participant_id text, account_id text, event_type text, template_name text, template_language text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.communication_notification_outbox o
  set status = 'skipped', locked_at = null, last_error_code = 'integration_or_template_disabled'
  where o.status = 'pending'
    and not exists (
      select 1
      from public.company_communication_integrations i
      join public.company_notification_templates t
        on t.owner_id = i.owner_id and t.account_id = i.whatsapp_account_id
      join public.profiles p on p.id = i.owner_id and p.role = 'owner' and p.access = 'active'
      where i.owner_id = o.owner_id and i.zernio_api_key_ciphertext is not null
        and i.whatsapp_account_id is not null
        and t.event_type = o.event_type and t.enabled and t.template_status = 'APPROVED'
        and t.template_parameter_count = 0
    );

  update public.communication_notification_outbox o
  set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
  where o.status = 'pending'
    and exists (
      select 1 from public.customer_notification_preferences pref
      where pref.owner_id = o.owner_id and pref.customer_id = o.customer_id
        and (not pref.whatsapp_marketing_opt_in or pref.whatsapp_revoked_at is not null)
    );

  update public.communication_notification_outbox o
  set status = 'failed', locked_at = null, last_error_code = 'attempt_limit_reached'
  where o.status = 'processing' and o.locked_at < now() - interval '5 minutes' and o.attempt_count >= 5;

  return query
  with candidates as (
    select o.id
    from public.communication_notification_outbox o
    join public.customer_notification_preferences pref
      on pref.owner_id = o.owner_id and pref.customer_id = o.customer_id
      and pref.whatsapp_marketing_opt_in and pref.whatsapp_revoked_at is null
    join public.company_communication_integrations integration on integration.owner_id = o.owner_id
    join public.company_notification_templates template
      on template.owner_id = o.owner_id and template.event_type = o.event_type
      and template.account_id = integration.whatsapp_account_id
      and template.enabled and template.template_status = 'APPROVED'
      and template.template_parameter_count = 0
    join public.customers customer on customer.id = o.customer_id and customer.owner_id = o.owner_id
    join public.profiles profile on profile.id = o.owner_id and profile.role = 'owner' and profile.access = 'active'
    where (o.status = 'pending' or (o.status = 'processing' and o.locked_at < now() - interval '5 minutes'))
      and o.next_attempt_at <= now() and o.attempt_count < 5
      and integration.whatsapp_account_id is not null
      and integration.zernio_api_key_ciphertext is not null
      and nullif(regexp_replace(coalesce(customer.mobile, ''), '[^0-9]+', '', 'g'), '') is not null
    order by o.created_at
    for update of o skip locked
    limit 5
  ), claimed as (
    update public.communication_notification_outbox o
    set status = 'processing', attempt_count = o.attempt_count + 1, locked_at = now()
    from candidates c where o.id = c.id
    returning o.*
  )
  select
    claimed.id,
    claimed.owner_id,
    claimed.customer_id,
    customer.name,
    case
      when length(phone.digits) between 12 and 15 and phone.digits like integration.phone_country_code || '%' then phone.digits
      when length(phone.digits) between 10 and 11 then integration.phone_country_code || phone.digits
      else null
    end,
    integration.whatsapp_account_id,
    claimed.event_type,
    template.template_name,
    template.template_language
  from claimed
  join public.customers customer on customer.id = claimed.customer_id and customer.owner_id = claimed.owner_id
  join public.company_communication_integrations integration on integration.owner_id = claimed.owner_id
  join public.company_notification_templates template
    on template.owner_id = claimed.owner_id and template.event_type = claimed.event_type
    and template.account_id = integration.whatsapp_account_id
  cross join lateral (select regexp_replace(coalesce(customer.mobile, ''), '[^0-9]+', '', 'g') as digits) phone;
end;
$$;
revoke all on function public.claim_communication_notifications() from public, anon, authenticated;
grant execute on function public.claim_communication_notifications() to service_role;

create or replace function public.authorize_communication_notification(
  outbox_id_input uuid,
  account_id_input text,
  template_name_input text,
  template_language_input text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.communication_notification_outbox o
    join public.customer_notification_preferences pref
      on pref.owner_id = o.owner_id and pref.customer_id = o.customer_id
      and pref.whatsapp_marketing_opt_in and pref.whatsapp_revoked_at is null
    join public.company_communication_integrations i
      on i.owner_id = o.owner_id and i.whatsapp_account_id = account_id_input
      and i.zernio_api_key_ciphertext is not null
    join public.company_notification_templates t
      on t.owner_id = o.owner_id and t.account_id = i.whatsapp_account_id
      and t.event_type = o.event_type and t.enabled
      and t.template_name = template_name_input and t.template_language = template_language_input
      and t.template_status = 'APPROVED' and t.template_parameter_count = 0
    join public.profiles p on p.id = o.owner_id and p.role = 'owner' and p.access = 'active'
    where o.id = outbox_id_input and o.status = 'processing'
  )
$$;
revoke all on function public.authorize_communication_notification(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.authorize_communication_notification(uuid, text, text, text) to service_role;

create or replace function public.finish_communication_notification(
  outbox_id_input uuid,
  outcome_input text,
  error_code_input text default null,
  provider_message_id_input text default null,
  retry_after_seconds_input integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  outbox_row public.communication_notification_outbox%rowtype;
  final_outcome text;
begin
  if outcome_input not in ('sent', 'retry', 'failed', 'skipped') then return false; end if;
  select * into outbox_row
  from public.communication_notification_outbox o
  where o.id = outbox_id_input and o.status = 'processing'
  for update;
  if not found then return false; end if;

  final_outcome := case
    when outcome_input = 'retry' and outbox_row.attempt_count < 5 then 'retry'
    when outcome_input = 'retry' then 'failed'
    else outcome_input
  end;
  insert into public.communication_notification_attempts(
    owner_id, outbox_id, attempt_number, outcome, error_code, provider_message_id
  ) values (
    outbox_row.owner_id, outbox_row.id, greatest(outbox_row.attempt_count, 1), final_outcome,
    case when final_outcome in ('retry', 'failed') then left(error_code_input, 120) else null end,
    case when final_outcome = 'sent' then left(provider_message_id_input, 200) else null end
  );

  update public.communication_notification_outbox o
  set status = case when final_outcome = 'retry' then 'pending' else final_outcome end,
      next_attempt_at = case when final_outcome = 'retry'
        then now() + make_interval(secs => greatest(30, least(coalesce(retry_after_seconds_input, 60), 3600)))
        else o.next_attempt_at end,
      sent_at = case when final_outcome = 'sent' then now() else o.sent_at end,
      provider_message_id = case when final_outcome = 'sent' then left(provider_message_id_input, 200) else o.provider_message_id end,
      last_error_code = case when final_outcome in ('retry', 'failed') then left(error_code_input, 120) else null end,
      locked_at = null
  where o.id = outbox_row.id and o.status = 'processing';
  return found;
end;
$$;
revoke all on function public.finish_communication_notification(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.finish_communication_notification(uuid, text, text, text, integer) to service_role;

notify pgrst, 'reload schema';
