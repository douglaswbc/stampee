-- Enable approved WhatsApp templates that use supported Stampfy variables and buttons.
-- Apply after add_communications_zernio.sql. Safe to re-run.

create table if not exists public.communication_schema_capabilities (
  capability text primary key,
  applied_at timestamptz not null default now()
);
alter table public.communication_schema_capabilities enable row level security;
revoke all on public.communication_schema_capabilities from public, anon, authenticated;
grant all on public.communication_schema_capabilities to service_role;
insert into public.communication_schema_capabilities(capability)
values ('whatsapp_named_template_variables_v1')
on conflict (capability) do nothing;

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
  ) then return; end if;

  insert into public.communication_notification_outbox(owner_id, customer_id, event_type, event_key)
  values (owner_id_input, customer_id_input, event_type_input, event_key_input)
  on conflict (owner_id, event_key) do nothing;
end;
$$;
revoke all on function public.enqueue_communication_notification(uuid, text, text, text) from public, anon, authenticated;

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
      and t.template_status = 'APPROVED'
    join public.profiles p on p.id = o.owner_id and p.role = 'owner' and p.access = 'active'
    where o.id = outbox_id_input and o.status = 'processing'
  )
$$;
revoke all on function public.authorize_communication_notification(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.authorize_communication_notification(uuid, text, text, text) to service_role;
