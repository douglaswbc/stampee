-- Re-engagement reminders with explicit marketing consent, tenant controls and channel-safe delivery.
-- Apply after add_customer_portal.sql, add_communications_zernio.sql, and add_customer_web_push.sql.

alter table public.company_notification_templates
  drop constraint if exists company_notification_templates_event_type_check;
alter table public.company_notification_templates
  add constraint company_notification_templates_event_type_check
  check (event_type in (
    'visit_validated', 'mission_completed', 'reward_claimed',
    'return_reminder', 'mission_reminder', 'reward_expiring'
  ));

alter table public.communication_notification_outbox
  drop constraint if exists communication_notification_outbox_event_type_check;
alter table public.communication_notification_outbox
  add constraint communication_notification_outbox_event_type_check
  check (event_type in (
    'visit_validated', 'mission_completed', 'reward_claimed',
    'return_reminder', 'mission_reminder', 'reward_expiring'
  ));
alter table public.communication_notification_outbox
  add column if not exists engagement_channel text,
  add column if not exists campaign_id text references public.campaigns(id) on delete set null,
  add column if not exists card_id text references public.issued_cards(id) on delete set null,
  add column if not exists reminder_subject_id text,
  add column if not exists activity_snapshot_at timestamptz,
  add column if not exists message_title text,
  add column if not exists message_body text;
alter table public.communication_notification_outbox
  drop constraint if exists communication_notification_outbox_engagement_channel_check;
alter table public.communication_notification_outbox
  add constraint communication_notification_outbox_engagement_channel_check
  check (engagement_channel is null or engagement_channel in ('push', 'whatsapp'));
create index if not exists communication_outbox_engagement_history_idx
  on public.communication_notification_outbox(owner_id, customer_id, created_at desc)
  where event_type in ('return_reminder', 'mission_reminder', 'reward_expiring');

alter table public.customer_push_notification_deliveries
  add column if not exists message_title text,
  add column if not exists message_body text;

create table if not exists public.company_engagement_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  return_enabled boolean not null default false,
  mission_enabled boolean not null default false,
  reward_expiring_enabled boolean not null default false,
  push_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  channel_priority text not null default 'push_first' check (channel_priority in ('push_first', 'whatsapp_first')),
  return_after_days integer not null default 7 check (return_after_days between 1 and 60),
  repeat_interval_days integer not null default 7 check (repeat_interval_days between 1 and 60),
  max_reminders_per_campaign integer not null default 2 check (max_reminders_per_campaign between 1 and 5),
  reward_expiry_days integer not null default 3 check (reward_expiry_days between 1 and 14),
  max_per_customer_per_7d integer not null default 2 check (max_per_customer_per_7d between 1 and 5),
  min_gap_hours integer not null default 48 check (min_gap_hours between 1 and 720),
  quiet_hours_enabled boolean not null default true,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  updated_at timestamptz not null default now(),
  constraint company_engagement_quiet_hours_distinct check (quiet_start <> quiet_end)
);
alter table public.company_engagement_settings enable row level security;
revoke all on public.company_engagement_settings from public, anon, authenticated;
grant all on public.company_engagement_settings to service_role;

create table if not exists public.company_engagement_campaigns (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (owner_id, campaign_id)
);
create index if not exists company_engagement_campaigns_campaign_idx
  on public.company_engagement_campaigns(campaign_id, owner_id) where enabled;
alter table public.company_engagement_campaigns enable row level security;
revoke all on public.company_engagement_campaigns from public, anon, authenticated;
grant all on public.company_engagement_campaigns to service_role;

create table if not exists public.company_engagement_push_templates (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')),
  title text not null check (length(trim(title)) between 1 and 70),
  body text not null check (length(trim(body)) between 1 and 220),
  updated_at timestamptz not null default now(),
  primary key (owner_id, event_type)
);
alter table public.company_engagement_push_templates enable row level security;
revoke all on public.company_engagement_push_templates from public, anon, authenticated;
grant all on public.company_engagement_push_templates to service_role;

create table if not exists public.customer_engagement_preference_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'push')),
  enabled boolean not null,
  source text not null check (source in ('public_card', 'customer_portal')),
  consent_version text not null,
  created_at timestamptz not null default now()
);
alter table public.customer_engagement_preference_events
  drop constraint if exists customer_engagement_preference_events_source_check;
alter table public.customer_engagement_preference_events
  add constraint customer_engagement_preference_events_source_check
  check (source in ('campaign_signup', 'public_card', 'customer_portal'));
create index if not exists customer_engagement_preference_events_customer_idx
  on public.customer_engagement_preference_events(owner_id, customer_id, created_at desc);
alter table public.customer_engagement_preference_events enable row level security;
revoke all on public.customer_engagement_preference_events from public, anon, authenticated;
grant all on public.customer_engagement_preference_events to service_role;

create table if not exists public.communication_schema_capabilities (
  capability text primary key,
  enabled_at timestamptz not null default now()
);
alter table public.communication_schema_capabilities enable row level security;
revoke all on public.communication_schema_capabilities from public, anon, authenticated;
grant all on public.communication_schema_capabilities to service_role;
insert into public.communication_schema_capabilities(capability)
values ('whatsapp_named_template_variables_v1')
on conflict (capability) do nothing;

create or replace function public.get_company_engagement_configuration()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  owner_id_value uuid := auth.uid();
  configuration_value jsonb;
begin
  if owner_id_value is null or not exists (
    select 1 from public.profiles p
    where p.id = owner_id_value and p.role = 'owner' and p.access = 'active'
  ) then
    raise exception 'Active company owner required.';
  end if;

  select jsonb_build_object(
    'settings', jsonb_build_object(
      'enabled', coalesce(s.enabled, false),
      'returnEnabled', coalesce(s.return_enabled, false),
      'missionEnabled', coalesce(s.mission_enabled, false),
      'rewardExpiringEnabled', coalesce(s.reward_expiring_enabled, false),
      'pushEnabled', coalesce(s.push_enabled, true),
      'whatsappEnabled', coalesce(s.whatsapp_enabled, false),
      'channelPriority', coalesce(s.channel_priority, 'push_first'),
      'returnAfterDays', coalesce(s.return_after_days, 7),
      'repeatIntervalDays', coalesce(s.repeat_interval_days, 7),
      'maxRemindersPerCampaign', coalesce(s.max_reminders_per_campaign, 2),
      'rewardExpiryDays', coalesce(s.reward_expiry_days, 3),
      'maxPerCustomerPer7d', coalesce(s.max_per_customer_per_7d, 2),
      'minGapHours', coalesce(s.min_gap_hours, 48),
      'quietHoursEnabled', coalesce(s.quiet_hours_enabled, true),
      'quietStart', to_char(coalesce(s.quiet_start, time '21:00'), 'HH24:MI'),
      'quietEnd', to_char(coalesce(s.quiet_end, time '08:00'), 'HH24:MI'),
      'timeZone', p.time_zone
    ),
    'campaignIds', coalesce((
      select jsonb_agg(ec.campaign_id order by ec.campaign_id)
      from public.company_engagement_campaigns ec
      where ec.owner_id = owner_id_value and ec.enabled
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
      from public.campaigns c
      where c.owner_id = owner_id_value and c.is_enabled
    ), '[]'::jsonb),
    'pushTemplates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', defaults.event_type,
        'title', coalesce(custom.title, defaults.title),
        'body', coalesce(custom.body, defaults.body)
      ) order by defaults.event_type)
      from (values
        ('return_reminder'::text, 'Sentimos sua falta, {{customer_name}}!'::text, 'A campanha {{campaign_name}} continua ativa. Volte para avançar seu cartão.'::text),
        ('mission_reminder'::text, 'Sua missão está em andamento'::text, '{{customer_name}}, você avançou {{mission_progress}} de {{mission_goal}} etapas em {{mission_name}}.'::text),
        ('reward_expiring'::text, 'Sua recompensa vence em breve'::text, '{{customer_name}}, resgate {{reward_name}} até {{reward_expires_at}}.'::text)
      ) as defaults(event_type, title, body)
      left join public.company_engagement_push_templates custom
        on custom.owner_id = owner_id_value and custom.event_type = defaults.event_type
    ), '[]'::jsonb),
    'activity', jsonb_build_object(
      'whatsappSent30d', (select count(*) from public.communication_notification_outbox o
        where o.owner_id = owner_id_value and o.engagement_channel = 'whatsapp'
          and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
          and o.status = 'sent' and o.sent_at >= now() - interval '30 days'),
      'pushAccepted30d', (select count(distinct o.id) from public.customer_push_notification_deliveries d
        join public.communication_notification_outbox o on o.id = d.outbox_id
        where o.owner_id = owner_id_value and o.engagement_channel = 'push'
          and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
          and d.status = 'sent' and d.sent_at >= now() - interval '30 days'),
      'failedAttempts30d', (select count(*) from public.communication_notification_attempts a
        join public.communication_notification_outbox o on o.id = a.outbox_id
        where a.owner_id = owner_id_value and a.outcome = 'failed'
          and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
          and a.created_at >= now() - interval '30 days')
        + (select count(*) from public.customer_push_notification_attempts a
          join public.customer_push_notification_deliveries d on d.id = a.delivery_id
          join public.communication_notification_outbox o on o.id = d.outbox_id
          where o.owner_id = owner_id_value and o.engagement_channel = 'push'
            and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
            and a.outcome = 'failed' and a.created_at >= now() - interval '30 days'),
      'pending', (select count(*) from public.communication_notification_outbox o
        where o.owner_id = owner_id_value and o.engagement_channel = 'whatsapp'
          and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
          and o.status in ('pending', 'processing'))
        + (select count(distinct o.id) from public.customer_push_notification_deliveries d
          join public.communication_notification_outbox o on o.id = d.outbox_id
          where o.owner_id = owner_id_value and o.engagement_channel = 'push'
            and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
            and d.status in ('pending', 'retry', 'processing'))
    )
  ) into configuration_value
  from public.profiles p
  left join public.company_engagement_settings s on s.owner_id = p.id
  where p.id = owner_id_value;
  return configuration_value;
end;
$$;
revoke all on function public.get_company_engagement_configuration() from public, anon;
grant execute on function public.get_company_engagement_configuration() to authenticated;

create or replace function public.save_company_engagement_configuration(
  settings_input jsonb,
  campaign_ids_input text[],
  push_templates_input jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id_value uuid := auth.uid();
  template_row record;
  enabled_campaign_count integer;
begin
  if owner_id_value is null or not exists (
    select 1 from public.profiles p
    where p.id = owner_id_value and p.role = 'owner' and p.access = 'active'
  ) then
    raise exception 'Active company owner required.';
  end if;
  if settings_input is null or jsonb_typeof(settings_input) <> 'object' then
    raise exception 'Invalid reminder settings.';
  end if;

  insert into public.company_engagement_settings (
    owner_id, enabled, return_enabled, mission_enabled, reward_expiring_enabled,
    push_enabled, whatsapp_enabled, channel_priority, return_after_days,
    repeat_interval_days, max_reminders_per_campaign, reward_expiry_days,
    max_per_customer_per_7d, min_gap_hours, quiet_hours_enabled, quiet_start, quiet_end, updated_at
  ) values (
    owner_id_value,
    coalesce((settings_input->>'enabled')::boolean, false),
    coalesce((settings_input->>'returnEnabled')::boolean, false),
    coalesce((settings_input->>'missionEnabled')::boolean, false),
    coalesce((settings_input->>'rewardExpiringEnabled')::boolean, false),
    coalesce((settings_input->>'pushEnabled')::boolean, true),
    coalesce((settings_input->>'whatsappEnabled')::boolean, false),
    coalesce(settings_input->>'channelPriority', 'push_first'),
    coalesce((settings_input->>'returnAfterDays')::integer, 7),
    coalesce((settings_input->>'repeatIntervalDays')::integer, 7),
    coalesce((settings_input->>'maxRemindersPerCampaign')::integer, 2),
    coalesce((settings_input->>'rewardExpiryDays')::integer, 3),
    coalesce((settings_input->>'maxPerCustomerPer7d')::integer, 2),
    coalesce((settings_input->>'minGapHours')::integer, 48),
    coalesce((settings_input->>'quietHoursEnabled')::boolean, true),
    coalesce((settings_input->>'quietStart')::time, time '21:00'),
    coalesce((settings_input->>'quietEnd')::time, time '08:00'),
    now()
  ) on conflict (owner_id) do update set
    enabled = excluded.enabled,
    return_enabled = excluded.return_enabled,
    mission_enabled = excluded.mission_enabled,
    reward_expiring_enabled = excluded.reward_expiring_enabled,
    push_enabled = excluded.push_enabled,
    whatsapp_enabled = excluded.whatsapp_enabled,
    channel_priority = excluded.channel_priority,
    return_after_days = excluded.return_after_days,
    repeat_interval_days = excluded.repeat_interval_days,
    max_reminders_per_campaign = excluded.max_reminders_per_campaign,
    reward_expiry_days = excluded.reward_expiry_days,
    max_per_customer_per_7d = excluded.max_per_customer_per_7d,
    min_gap_hours = excluded.min_gap_hours,
    quiet_hours_enabled = excluded.quiet_hours_enabled,
    quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end,
    updated_at = now();

  if campaign_ids_input is null then campaign_ids_input := '{}'::text[]; end if;
  select count(*) into enabled_campaign_count
  from public.campaigns c
  where c.owner_id = owner_id_value and c.is_enabled and c.id = any(campaign_ids_input);
  if enabled_campaign_count <> cardinality(campaign_ids_input)
     or exists (select 1 from unnest(campaign_ids_input) selected(campaign_id) where selected.campaign_id is null or selected.campaign_id = '')
     or cardinality(campaign_ids_input) <> (select count(distinct selected.campaign_id) from unnest(campaign_ids_input) selected(campaign_id)) then
    raise exception 'One or more selected campaigns are invalid.';
  end if;
  delete from public.company_engagement_campaigns where owner_id = owner_id_value;
  insert into public.company_engagement_campaigns(owner_id, campaign_id, enabled)
  select owner_id_value, selected.campaign_id, true
  from unnest(campaign_ids_input) as selected(campaign_id);

  if push_templates_input is null or jsonb_typeof(push_templates_input) <> 'array'
     or jsonb_array_length(push_templates_input) <> 3 then
    raise exception 'All three push reminder templates are required.';
  end if;
  if (select count(distinct value->>'event_type') from jsonb_array_elements(push_templates_input) values_row(value)) <> 3
     or exists (
       select 1 from jsonb_array_elements(push_templates_input) values_row(value)
       where value->>'event_type' not in ('return_reminder', 'mission_reminder', 'reward_expiring')
     ) then
    raise exception 'All three distinct reminder types are required.';
  end if;
  for template_row in
    select * from jsonb_to_recordset(push_templates_input)
      as values_row(event_type text, title text, body text)
  loop
    if template_row.event_type not in ('return_reminder', 'mission_reminder', 'reward_expiring')
       or length(trim(coalesce(template_row.title, ''))) not between 1 and 70
       or length(trim(coalesce(template_row.body, ''))) not between 1 and 220 then
      raise exception 'A push reminder template has invalid content.';
    end if;
    if regexp_replace(template_row.title || ' ' || template_row.body,
      '\{\{(customer_name|business_name|campaign_name|mission_name|mission_progress|mission_goal|reward_name|reward_expires_at|days_remaining)\}\}', '', 'g') ~ '\{\{|\}\}' then
      raise exception 'A push reminder template contains an unsupported variable.';
    end if;
    if (template_row.event_type = 'return_reminder' and (template_row.title || template_row.body) ~ '\{\{(mission_name|mission_progress|mission_goal|reward_name|reward_expires_at|days_remaining)\}\}')
       or (template_row.event_type = 'mission_reminder' and (template_row.title || template_row.body) ~ '\{\{(reward_name|reward_expires_at|days_remaining)\}\}')
       or (template_row.event_type = 'reward_expiring' and (template_row.title || template_row.body) ~ '\{\{(mission_name|mission_progress|mission_goal)\}\}') then
      raise exception 'A push reminder template uses a variable for another reminder type.';
    end if;
    insert into public.company_engagement_push_templates(owner_id, event_type, title, body, updated_at)
    values (owner_id_value, template_row.event_type, trim(template_row.title), trim(template_row.body), now())
    on conflict (owner_id, event_type) do update set
      title = excluded.title, body = excluded.body, updated_at = now();
  end loop;
  if (select count(*) from public.company_engagement_push_templates t
      where t.owner_id = owner_id_value and t.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')) <> 3 then
    raise exception 'A push reminder template is missing.';
  end if;
  return true;
end;
$$;
revoke all on function public.save_company_engagement_configuration(jsonb, text[], jsonb) from public, anon;
grant execute on function public.save_company_engagement_configuration(jsonb, text[], jsonb) to authenticated;

create or replace function public.sync_customer_engagement_signup_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  consent_changed boolean := true;
  was_opted_in boolean := false;
begin
  if tg_op = 'UPDATE' then
    was_opted_in := coalesce(old.whatsapp_marketing_opt_in, false);
    consent_changed := old.whatsapp_marketing_opt_in is distinct from new.whatsapp_marketing_opt_in
      or old.whatsapp_consented_at is distinct from new.whatsapp_consented_at
      or old.whatsapp_revoked_at is distinct from new.whatsapp_revoked_at
      or old.consent_source is distinct from new.consent_source;
  end if;
  if new.consent_source = 'public_campaign_signup' and new.whatsapp_marketing_opt_in
     and new.whatsapp_revoked_at is null and new.whatsapp_consented_at is not null
     and consent_changed then
    insert into public.customer_portal_communication_preferences (
      owner_id, customer_id, channel, category, enabled, consent_at, revoked_at,
      consent_source, consent_version, updated_at
    ) values (
      new.owner_id, new.customer_id, 'whatsapp', 'marketing', true,
      new.whatsapp_consented_at, null, 'public_campaign_signup', 'campaign_signup_marketing_v1', now()
    ) on conflict (owner_id, customer_id, channel, category) do update set
      enabled = true, consent_at = excluded.consent_at, revoked_at = null,
      consent_source = excluded.consent_source, consent_version = excluded.consent_version, updated_at = now();
    insert into public.customer_engagement_preference_events(owner_id, customer_id, channel, enabled, source, consent_version)
    values (new.owner_id, new.customer_id, 'whatsapp', true, 'campaign_signup', 'campaign_signup_marketing_v1');
  elsif new.consent_source = 'public_campaign_signup'
     and (not new.whatsapp_marketing_opt_in or new.whatsapp_revoked_at is not null)
     and consent_changed then
    update public.customer_portal_communication_preferences
    set enabled = false, revoked_at = coalesce(new.whatsapp_revoked_at, now()),
        consent_source = coalesce(new.consent_source, 'legacy_whatsapp_revoked'), updated_at = now()
    where owner_id = new.owner_id and customer_id = new.customer_id
      and channel = 'whatsapp' and category = 'marketing' and enabled;
    if was_opted_in and not new.whatsapp_marketing_opt_in then
      insert into public.customer_engagement_preference_events(owner_id, customer_id, channel, enabled, source, consent_version)
      values (new.owner_id, new.customer_id, 'whatsapp', false,
        case when new.consent_source = 'customer_portal' then 'customer_portal' else 'public_card' end,
        'campaign_signup_marketing_v1');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_customer_engagement_signup_consent() from public, anon, authenticated;
drop trigger if exists sync_customer_engagement_signup_consent on public.customer_notification_preferences;
create trigger sync_customer_engagement_signup_consent
  after insert or update on public.customer_notification_preferences
  for each row execute function public.sync_customer_engagement_signup_consent();

insert into public.customer_portal_communication_preferences (
  owner_id, customer_id, channel, category, enabled, consent_at, revoked_at,
  consent_source, consent_version, updated_at
)
select owner_id, customer_id, 'whatsapp', 'marketing', true, whatsapp_consented_at, null,
  'public_campaign_signup', 'campaign_signup_marketing_v1', now()
from public.customer_notification_preferences
where consent_source = 'public_campaign_signup' and whatsapp_marketing_opt_in
  and whatsapp_revoked_at is null and whatsapp_consented_at is not null
on conflict (owner_id, customer_id, channel, category) do nothing;

create or replace function public.get_customer_portal_push_preferences()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  user_id_value uuid := auth.uid();
  preferences_value jsonb;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ownerId', p.id,
    'customerId', c.id,
    'enabled', coalesce(push_pref.enabled, false),
    'hasSubscription', exists (
      select 1
      from public.customer_push_subscription_links l
      join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
      where l.owner_id = c.owner_id and l.customer_id = c.id and l.revoked_at is null
        and (s.expiration_time is null or s.expiration_time > now())
    ),
    'pushMarketingEnabled', coalesce(push_marketing.enabled and push_marketing.revoked_at is null, false),
    'whatsappMarketingEnabled', coalesce(whatsapp_marketing.enabled and whatsapp_marketing.revoked_at is null, false),
    'hasMobile', nullif(regexp_replace(coalesce(c.mobile, ''), '[^0-9]+', '', 'g'), '') is not null
  )), '[]'::jsonb)
  into preferences_value
  from public.customer_portal_identity_links identity_link
  join public.customers c on c.id = identity_link.customer_id and c.owner_id = identity_link.owner_id
  join public.profiles p on p.id = c.owner_id and p.role = 'owner'
  left join public.customer_portal_communication_preferences push_pref
    on push_pref.owner_id = c.owner_id and push_pref.customer_id = c.id
    and push_pref.channel = 'push' and push_pref.category = 'loyalty_updates'
  left join public.customer_portal_communication_preferences push_marketing
    on push_marketing.owner_id = c.owner_id and push_marketing.customer_id = c.id
    and push_marketing.channel = 'push' and push_marketing.category = 'marketing'
  left join public.customer_portal_communication_preferences whatsapp_marketing
    on whatsapp_marketing.owner_id = c.owner_id and whatsapp_marketing.customer_id = c.id
    and whatsapp_marketing.channel = 'whatsapp' and whatsapp_marketing.category = 'marketing'
  where identity_link.user_id = user_id_value;
  return preferences_value;
end;
$$;
revoke all on function public.get_customer_portal_push_preferences() from public, anon;
grant execute on function public.get_customer_portal_push_preferences() to authenticated;

create or replace function public.set_customer_portal_engagement_preference(
  owner_id_input uuid,
  customer_id_input text,
  channel_input text,
  enabled_input boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  user_id_value uuid := auth.uid();
  mobile_value text;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  if channel_input not in ('whatsapp', 'push') then return false; end if;
  perform public.ensure_customer_portal_account();
  select c.mobile into mobile_value
  from public.customers c
  where c.id = customer_id_input and c.owner_id = owner_id_input
    and exists (select 1 from public.customer_portal_identity_links l
      where l.owner_id = c.owner_id and l.customer_id = c.id and l.user_id = user_id_value);
  if not found then return false; end if;
  if enabled_input and channel_input = 'whatsapp'
     and nullif(regexp_replace(coalesce(mobile_value, ''), '[^0-9]+', '', 'g'), '') is null then
    return false;
  end if;
  if enabled_input and channel_input = 'push' and not exists (
    select 1 from public.customer_push_subscription_links l
    join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
    where l.owner_id = owner_id_input and l.customer_id = customer_id_input and l.revoked_at is null
      and (s.expiration_time is null or s.expiration_time > now())
  ) then return false; end if;

  insert into public.customer_portal_communication_preferences (
    owner_id, customer_id, channel, category, enabled, consent_at, revoked_at,
    consent_source, consent_version, updated_at
  ) values (
    owner_id_input, customer_id_input, channel_input, 'marketing', enabled_input,
    case when enabled_input then now() else null end,
    case when enabled_input then null else now() end,
    'customer_portal', case when enabled_input then 'customer_portal_marketing_v1' else null end, now()
  ) on conflict (owner_id, customer_id, channel, category) do update set
    enabled = excluded.enabled,
    consent_at = case when excluded.enabled then now() else public.customer_portal_communication_preferences.consent_at end,
    revoked_at = case when excluded.enabled then null else now() end,
    consent_source = 'customer_portal',
    consent_version = case when excluded.enabled then excluded.consent_version else public.customer_portal_communication_preferences.consent_version end,
    updated_at = now();

  insert into public.customer_engagement_preference_events(owner_id, customer_id, channel, enabled, source, consent_version)
  values (owner_id_input, customer_id_input, channel_input, enabled_input, 'customer_portal', 'customer_portal_marketing_v1');
  if not enabled_input then
    update public.communication_notification_outbox
    set status = 'skipped', locked_at = null, last_error_code = 'engagement_consent_revoked'
    where owner_id = owner_id_input and customer_id = customer_id_input
      and event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
      and engagement_channel = channel_input and status in ('pending', 'processing');
    if channel_input = 'push' then
      update public.customer_push_notification_deliveries
      set status = 'skipped', locked_at = null, last_error_code = 'engagement_consent_revoked'
      where owner_id = owner_id_input and customer_id = customer_id_input
        and status in ('pending', 'retry', 'processing')
        and outbox_id in (select o.id from public.communication_notification_outbox o
          where o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring'));
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.set_customer_portal_engagement_preference(uuid, text, text, boolean) from public, anon;
grant execute on function public.set_customer_portal_engagement_preference(uuid, text, text, boolean) to authenticated;

create or replace function public.get_public_customer_engagement_preferences(slug_input text, card_unique_id_input uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'whatsappEnabled', coalesce(whatsapp_pref.enabled and whatsapp_pref.revoked_at is null, false),
    'pushEnabled', coalesce(push_pref.enabled and push_pref.revoked_at is null, false),
    'hasMobile', nullif(regexp_replace(coalesce(c.mobile, ''), '[^0-9]+', '', 'g'), '') is not null,
    'hasPushSubscription', exists (
      select 1 from public.customer_push_subscription_links l
      join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
      where l.owner_id = ic.owner_id and l.customer_id = ic.customer_id
        and l.card_unique_id = ic.unique_id and l.revoked_at is null
        and (s.expiration_time is null or s.expiration_time > now())
    )
  )
  from public.issued_cards ic
  join public.customers c on c.id = ic.customer_id and c.owner_id = ic.owner_id
  join public.profiles p on p.id = ic.owner_id and p.slug = lower(trim(slug_input))
    and p.role = 'owner' and p.access = 'active'
  left join public.customer_portal_communication_preferences whatsapp_pref
    on whatsapp_pref.owner_id = ic.owner_id and whatsapp_pref.customer_id = ic.customer_id
    and whatsapp_pref.channel = 'whatsapp' and whatsapp_pref.category = 'marketing'
  left join public.customer_portal_communication_preferences push_pref
    on push_pref.owner_id = ic.owner_id and push_pref.customer_id = ic.customer_id
    and push_pref.channel = 'push' and push_pref.category = 'marketing'
  where ic.unique_id = card_unique_id_input
$$;
revoke all on function public.get_public_customer_engagement_preferences(text, uuid) from public;
grant execute on function public.get_public_customer_engagement_preferences(text, uuid) to anon, authenticated;

create or replace function public.set_public_customer_engagement_preference(
  slug_input text,
  card_unique_id_input uuid,
  channel_input text,
  enabled_input boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  card_row public.issued_cards%rowtype;
  mobile_value text;
begin
  if channel_input not in ('whatsapp', 'push') then return false; end if;
  select ic.* into card_row
  from public.issued_cards ic
  join public.profiles p on p.id = ic.owner_id and p.slug = lower(trim(slug_input))
    and p.role = 'owner' and p.access = 'active'
  where ic.unique_id = card_unique_id_input;
  if not found then return false; end if;
  select c.mobile into mobile_value from public.customers c
  where c.id = card_row.customer_id and c.owner_id = card_row.owner_id;
  if enabled_input and channel_input = 'whatsapp'
     and nullif(regexp_replace(coalesce(mobile_value, ''), '[^0-9]+', '', 'g'), '') is null then
    return false;
  end if;
  if enabled_input and channel_input = 'push' and not exists (
    select 1 from public.customer_push_subscription_links l
    join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
    where l.owner_id = card_row.owner_id and l.customer_id = card_row.customer_id
      and l.card_unique_id = card_row.unique_id and l.revoked_at is null
      and (s.expiration_time is null or s.expiration_time > now())
  ) then return false; end if;

  insert into public.customer_portal_communication_preferences (
    owner_id, customer_id, channel, category, enabled, consent_at, revoked_at,
    consent_source, consent_version, updated_at
  ) values (
    card_row.owner_id, card_row.customer_id, channel_input, 'marketing', enabled_input,
    case when enabled_input then now() else null end,
    case when enabled_input then null else now() end,
    'public_card', case when enabled_input then 'public_card_marketing_v1' else null end, now()
  ) on conflict (owner_id, customer_id, channel, category) do update set
    enabled = excluded.enabled,
    consent_at = case when excluded.enabled then now() else public.customer_portal_communication_preferences.consent_at end,
    revoked_at = case when excluded.enabled then null else now() end,
    consent_source = 'public_card',
    consent_version = case when excluded.enabled then excluded.consent_version else public.customer_portal_communication_preferences.consent_version end,
    updated_at = now();

  insert into public.customer_engagement_preference_events(owner_id, customer_id, channel, enabled, source, consent_version)
  values (card_row.owner_id, card_row.customer_id, channel_input, enabled_input, 'public_card', 'public_card_marketing_v1');
  if not enabled_input then
    update public.communication_notification_outbox
    set status = 'skipped', locked_at = null, last_error_code = 'engagement_consent_revoked'
    where owner_id = card_row.owner_id and customer_id = card_row.customer_id
      and event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
      and engagement_channel = channel_input and status in ('pending', 'processing');
    if channel_input = 'push' then
      update public.customer_push_notification_deliveries
      set status = 'skipped', locked_at = null, last_error_code = 'engagement_consent_revoked'
      where owner_id = card_row.owner_id and customer_id = card_row.customer_id
        and status in ('pending', 'retry', 'processing')
        and outbox_id in (select o.id from public.communication_notification_outbox o
          where o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring'));
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.set_public_customer_engagement_preference(text, uuid, text, boolean) from public;
grant execute on function public.set_public_customer_engagement_preference(text, uuid, text, boolean) to anon, authenticated;

create or replace function public.get_customer_portal_engagement_history()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  user_id_value uuid := auth.uid();
  history_value jsonb;
begin
  if user_id_value is null then raise exception 'Authentication required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sent.id,
    'ownerId', sent.owner_id,
    'businessName', sent.business_name,
    'eventType', sent.event_type,
    'campaignName', sent.campaign_name,
    'messageTitle', sent.message_title,
    'messageBody', sent.message_body,
    'channel', sent.channel,
    'submittedAt', sent.submitted_at
  ) order by sent.submitted_at desc), '[]'::jsonb)
  into history_value
  from (
    select latest_by_event.*
    from (
      select distinct on (o.id)
        o.id, o.owner_id, p.business_name, o.event_type, c.name as campaign_name,
        o.message_title, o.message_body,
        case when o.engagement_channel = 'push' then 'push' else 'whatsapp' end as channel,
        case when o.engagement_channel = 'push' then d.sent_at else o.sent_at end as submitted_at
      from public.communication_notification_outbox o
      join public.customer_portal_identity_links il
        on il.owner_id = o.owner_id and il.customer_id = o.customer_id and il.user_id = user_id_value
      join public.profiles p on p.id = o.owner_id
      left join public.campaigns c on c.id = o.campaign_id and c.owner_id = o.owner_id
      left join public.customer_push_notification_deliveries d
        on d.outbox_id = o.id and d.status = 'sent'
      where o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
        and ((o.engagement_channel = 'push' and d.id is not null)
          or (o.engagement_channel = 'whatsapp' and o.status = 'sent'))
      order by o.id, coalesce(d.sent_at, o.sent_at) desc nulls last
    ) latest_by_event
    order by latest_by_event.submitted_at desc nulls last
    limit 50
  ) sent;
  return history_value;
end;
$$;
revoke all on function public.get_customer_portal_engagement_history() from public, anon;
grant execute on function public.get_customer_portal_engagement_history() to authenticated;

create or replace function public.engagement_whatsapp_number_is_valid(mobile_input text, country_code_input text)
returns boolean
language sql
immutable
set search_path = public
as $$
  with normalized as (
    select regexp_replace(coalesce(mobile_input, ''), '[^0-9]+', '', 'g') as digits
  )
  select case
    when length(normalized.digits) between 10 and 11 then true
    when length(normalized.digits) between 12 and 15
      then coalesce(normalized.digits like coalesce(country_code_input, '') || '%', false)
    else false
  end
  from normalized
$$;
revoke all on function public.engagement_whatsapp_number_is_valid(text, text) from public, anon, authenticated;
grant execute on function public.engagement_whatsapp_number_is_valid(text, text) to service_role;

create or replace function public.enqueue_due_customer_engagement_reminders(batch_limit integer default 250)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reminder_row record;
  settings_row public.company_engagement_settings%rowtype;
  channel_value text;
  event_key_value text;
  message_title_value text;
  message_body_value text;
  message_template_title text;
  message_template_body text;
  local_time_value time;
  time_zone_value text;
  days_remaining_value text;
  queued_count integer := 0;
begin
  for reminder_row in
    with candidates as (
      select 'return_reminder'::text as event_type, ic.owner_id, ic.customer_id, ic.id as card_id,
        ic.campaign_id, c.name as campaign_name, null::text as subject_id, null::text as mission_name,
        null::integer as progress_count, null::integer as goal_count,
        null::text as reward_name, null::text as redemption_code, null::timestamptz as expires_at,
        floor((extract(epoch from (now() - activity.last_activity)) / 86400 - s.return_after_days)
          / s.repeat_interval_days)::integer + 1 as cycle_no,
        activity.last_activity as due_at
      from public.company_engagement_settings s
      join public.profiles p on p.id = s.owner_id and p.role = 'owner' and p.access = 'active'
      join public.company_engagement_campaigns eligible on eligible.owner_id = s.owner_id and eligible.enabled
      join public.campaigns c on c.id = eligible.campaign_id and c.owner_id = s.owner_id and c.is_enabled
      join public.issued_cards ic on ic.owner_id = s.owner_id and ic.campaign_id = c.id and ic.status = 'Active'
      join public.customers customer on customer.id = ic.customer_id and customer.owner_id = ic.owner_id
      cross join lateral (
        select max(card_activity.last_activity) as last_activity
        from public.issued_cards activity_card
        cross join lateral (
          select coalesce(max(to_timestamp(t."timestamp" / 1000.0)), activity_card.created_at) as last_activity
          from public.transactions t where t.card_id = activity_card.id and t.type = 'stamp_add'
        ) card_activity
        where activity_card.owner_id = ic.owner_id and activity_card.customer_id = ic.customer_id
          and activity_card.campaign_id = ic.campaign_id and activity_card.status = 'Active'
      ) activity
      where s.enabled and s.return_enabled
        and activity.last_activity <= now() - make_interval(days => s.return_after_days)
        and floor((extract(epoch from (now() - activity.last_activity)) / 86400 - s.return_after_days)
          / s.repeat_interval_days)::integer + 1 between 1 and s.max_reminders_per_campaign

      union all

      select 'mission_reminder'::text, ic.owner_id, ic.customer_id, ic.id, c.id, c.name,
        m.id::text, m.name, progress.progress_count::integer, m.goal_count,
        null::text, null::text, null::timestamptz,
        floor((extract(epoch from (now() - progress.last_activity)) / 86400 - s.return_after_days)
          / s.repeat_interval_days)::integer + 1,
        progress.last_activity
      from public.company_engagement_settings s
      join public.profiles p on p.id = s.owner_id and p.role = 'owner' and p.access = 'active'
      join public.company_engagement_campaigns eligible on eligible.owner_id = s.owner_id and eligible.enabled
      join public.campaigns c on c.id = eligible.campaign_id and c.owner_id = s.owner_id and c.is_enabled
      join public.loyalty_missions m on m.owner_id = s.owner_id and m.campaign_id = c.id
        and m.is_active and m.starts_at <= now() and m.ends_at > now()
      join public.issued_cards ic on ic.owner_id = s.owner_id and ic.campaign_id = c.id and ic.status = 'Active'
      join public.customers customer on customer.id = ic.customer_id and customer.owner_id = ic.owner_id and customer.status = 'Active'
      cross join lateral (
        select max(mc.completed_at) as completed_at
        from public.mission_completions mc
        where mc.mission_id = m.id and mc.customer_id = ic.customer_id
          and (mc.card_id = ic.id or mc.card_id is null)
      ) previous
      cross join lateral (
        select count(*)::integer as progress_count, max(e.created_at) as last_activity
        from public.mission_progress_events e
        where e.mission_id = m.id and e.customer_id = ic.customer_id
          and (m.mission_type = 'visit_count' or e.card_id = ic.id)
          and e.created_at > coalesce(previous.completed_at, m.starts_at)
          and e.created_at <= now()
      ) progress
      where s.enabled and s.mission_enabled and progress.progress_count between 1 and m.goal_count - 1
        and progress.last_activity <= now() - make_interval(days => s.return_after_days)
        and floor((extract(epoch from (now() - progress.last_activity)) / 86400 - s.return_after_days)
          / s.repeat_interval_days)::integer + 1 between 1 and s.max_reminders_per_campaign

      union all

      select 'reward_expiring'::text, rr.owner_id, rr.customer_id,
        coalesce(rr.card_id, latest_card.id), rw.campaign_id, c.name, rr.id::text,
        null::text, null::integer, null::integer,
        rr.reward_name, rr.redemption_code, rr.expires_at, 1, rr.issued_at
      from public.company_engagement_settings s
      join public.profiles p on p.id = s.owner_id and p.role = 'owner' and p.access = 'active'
      join public.company_engagement_campaigns eligible on eligible.owner_id = s.owner_id and eligible.enabled
      join public.loyalty_rewards rw on rw.owner_id = s.owner_id and rw.campaign_id = eligible.campaign_id
      join public.campaigns c on c.id = rw.campaign_id and c.owner_id = s.owner_id and c.is_enabled
      join public.loyalty_reward_redemptions rr on rr.owner_id = s.owner_id and rr.reward_id = rw.id
        and rr.status = 'issued' and rr.expires_at > now()
        and rr.expires_at <= now() + make_interval(days => s.reward_expiry_days)
      join public.customers customer on customer.id = rr.customer_id and customer.owner_id = rr.owner_id and customer.status = 'Active'
      left join lateral (
        select ic.id from public.issued_cards ic
        where ic.owner_id = rr.owner_id and ic.customer_id = rr.customer_id
          and (rr.card_id is null or ic.id = rr.card_id)
        order by ic.created_at desc limit 1
      ) latest_card on true
      where s.enabled and s.reward_expiring_enabled and rw.is_active
        and coalesce(rr.card_id, latest_card.id) is not null
    )
    select candidates.*
    from candidates
    join public.company_engagement_settings channel_settings
      on channel_settings.owner_id = candidates.owner_id and channel_settings.enabled
    where (
      (channel_settings.push_enabled and exists (
        select 1 from public.customer_portal_communication_preferences pref
        join public.customer_push_subscription_links link on link.owner_id = pref.owner_id
          and link.customer_id = pref.customer_id and link.card_unique_id = (
            select ic.unique_id from public.issued_cards ic where ic.id = candidates.card_id
              and ic.owner_id = candidates.owner_id and ic.customer_id = candidates.customer_id
          ) and link.revoked_at is null
        join public.customer_push_subscriptions subscription on subscription.id = link.subscription_id
          and subscription.revoked_at is null and (subscription.expiration_time is null or subscription.expiration_time > now())
        where pref.owner_id = candidates.owner_id and pref.customer_id = candidates.customer_id
          and pref.channel = 'push' and pref.category = 'marketing' and pref.enabled and pref.revoked_at is null
      ))
      or (channel_settings.whatsapp_enabled and exists (
        select 1 from public.customers customer
        join public.customer_portal_communication_preferences pref
          on pref.owner_id = customer.owner_id and pref.customer_id = customer.id
          and pref.channel = 'whatsapp' and pref.category = 'marketing' and pref.enabled and pref.revoked_at is null
        join public.company_communication_integrations integration on integration.owner_id = customer.owner_id
          and integration.whatsapp_account_id is not null and integration.zernio_api_key_ciphertext is not null
        join public.company_notification_templates template on template.owner_id = customer.owner_id
          and template.event_type = candidates.event_type and template.account_id = integration.whatsapp_account_id
          and template.enabled and template.template_status = 'APPROVED'
        where customer.owner_id = candidates.owner_id and customer.id = candidates.customer_id
          and public.engagement_whatsapp_number_is_valid(customer.mobile, integration.phone_country_code)
          and exists (select 1 from public.communication_schema_capabilities capability
            where capability.capability = 'whatsapp_named_template_variables_v1')
      ))
    )
    order by due_at asc
    limit greatest(1, least(coalesce(batch_limit, 250), 500))
  loop
    select s.* into settings_row
    from public.company_engagement_settings s
    where s.owner_id = reminder_row.owner_id and s.enabled;
    if not found then continue; end if;

    perform pg_advisory_xact_lock(hashtextextended(reminder_row.owner_id::text || ':' || reminder_row.customer_id, 0));
    event_key_value := case reminder_row.event_type
      when 'return_reminder' then 'return_reminder:' || reminder_row.campaign_id || ':' || reminder_row.customer_id || ':' || reminder_row.cycle_no::text
      when 'mission_reminder' then 'mission_reminder:' || reminder_row.subject_id || ':' || reminder_row.campaign_id || ':' || reminder_row.customer_id || ':' || reminder_row.cycle_no::text
      else 'reward_expiring:' || reminder_row.subject_id
    end;
    if exists (select 1 from public.communication_notification_outbox o
      where o.owner_id = reminder_row.owner_id and o.event_key = event_key_value) then continue; end if;

    if (select count(*) from public.communication_notification_outbox o
        where o.owner_id = reminder_row.owner_id and o.customer_id = reminder_row.customer_id
          and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
          and o.created_at >= now() - interval '7 days') >= settings_row.max_per_customer_per_7d
      or exists (select 1 from public.communication_notification_outbox o
        where o.owner_id = reminder_row.owner_id and o.customer_id = reminder_row.customer_id
          and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
          and o.created_at >= now() - make_interval(hours => settings_row.min_gap_hours)) then
      continue;
    end if;

    select coalesce(p.time_zone, 'UTC') into time_zone_value
    from public.profiles p where p.id = reminder_row.owner_id;
    local_time_value := now() at time zone time_zone_value;
    if settings_row.quiet_hours_enabled and (
      case when settings_row.quiet_start < settings_row.quiet_end
        then local_time_value >= settings_row.quiet_start and local_time_value < settings_row.quiet_end
        else local_time_value >= settings_row.quiet_start or local_time_value < settings_row.quiet_end
      end
    ) then continue; end if;

    channel_value := null;
    if settings_row.channel_priority = 'whatsapp_first' then
      if settings_row.whatsapp_enabled and exists (
        select 1
        from public.customers customer
        join public.customer_portal_communication_preferences pref
          on pref.owner_id = customer.owner_id and pref.customer_id = customer.id
          and pref.channel = 'whatsapp' and pref.category = 'marketing' and pref.enabled and pref.revoked_at is null
        join public.company_communication_integrations integration on integration.owner_id = customer.owner_id
          and integration.whatsapp_account_id is not null and integration.zernio_api_key_ciphertext is not null
        join public.company_notification_templates template on template.owner_id = customer.owner_id
          and template.event_type = reminder_row.event_type and template.account_id = integration.whatsapp_account_id
          and template.enabled and template.template_status = 'APPROVED'
        where customer.id = reminder_row.customer_id and customer.owner_id = reminder_row.owner_id
          and public.engagement_whatsapp_number_is_valid(customer.mobile, integration.phone_country_code)
          and exists (select 1 from public.communication_schema_capabilities capability
            where capability.capability = 'whatsapp_named_template_variables_v1')
      ) then channel_value := 'whatsapp';
      elsif settings_row.push_enabled and exists (
        select 1 from public.customer_portal_communication_preferences pref
        join public.customer_push_subscription_links link on link.owner_id = pref.owner_id
          and link.customer_id = pref.customer_id and link.card_unique_id = (
            select ic.unique_id from public.issued_cards ic where ic.id = reminder_row.card_id
              and ic.owner_id = reminder_row.owner_id and ic.customer_id = reminder_row.customer_id
          ) and link.revoked_at is null
        join public.customer_push_subscriptions subscription on subscription.id = link.subscription_id
          and subscription.revoked_at is null and (subscription.expiration_time is null or subscription.expiration_time > now())
        where pref.owner_id = reminder_row.owner_id and pref.customer_id = reminder_row.customer_id
          and pref.channel = 'push' and pref.category = 'marketing' and pref.enabled and pref.revoked_at is null
      ) then channel_value := 'push'; end if;
    else
      if settings_row.push_enabled and exists (
        select 1 from public.customer_portal_communication_preferences pref
        join public.customer_push_subscription_links link on link.owner_id = pref.owner_id
          and link.customer_id = pref.customer_id and link.card_unique_id = (
            select ic.unique_id from public.issued_cards ic where ic.id = reminder_row.card_id
              and ic.owner_id = reminder_row.owner_id and ic.customer_id = reminder_row.customer_id
          ) and link.revoked_at is null
        join public.customer_push_subscriptions subscription on subscription.id = link.subscription_id
          and subscription.revoked_at is null and (subscription.expiration_time is null or subscription.expiration_time > now())
        where pref.owner_id = reminder_row.owner_id and pref.customer_id = reminder_row.customer_id
          and pref.channel = 'push' and pref.category = 'marketing' and pref.enabled and pref.revoked_at is null
      ) then channel_value := 'push';
      elsif settings_row.whatsapp_enabled and exists (
        select 1
        from public.customers customer
        join public.customer_portal_communication_preferences pref
          on pref.owner_id = customer.owner_id and pref.customer_id = customer.id
          and pref.channel = 'whatsapp' and pref.category = 'marketing' and pref.enabled and pref.revoked_at is null
        join public.company_communication_integrations integration on integration.owner_id = customer.owner_id
          and integration.whatsapp_account_id is not null and integration.zernio_api_key_ciphertext is not null
        join public.company_notification_templates template on template.owner_id = customer.owner_id
          and template.event_type = reminder_row.event_type and template.account_id = integration.whatsapp_account_id
          and template.enabled and template.template_status = 'APPROVED'
        where customer.id = reminder_row.customer_id and customer.owner_id = reminder_row.owner_id
          and public.engagement_whatsapp_number_is_valid(customer.mobile, integration.phone_country_code)
          and exists (select 1 from public.communication_schema_capabilities capability
            where capability.capability = 'whatsapp_named_template_variables_v1')
      ) then channel_value := 'whatsapp'; end if;
    end if;
    if channel_value is null then continue; end if;

    select template.title, template.body into message_template_title, message_template_body
    from public.company_engagement_push_templates template
    where template.owner_id = reminder_row.owner_id and template.event_type = reminder_row.event_type;
    if not found then continue; end if;
    message_title_value := replace(message_template_title, '{{customer_name}}', coalesce((
      select c.name from public.customers c where c.id = reminder_row.customer_id and c.owner_id = reminder_row.owner_id
    ), ''));
    message_title_value := replace(message_title_value, '{{business_name}}', coalesce((
      select p.business_name from public.profiles p where p.id = reminder_row.owner_id
    ), ''));
    message_title_value := replace(message_title_value, '{{campaign_name}}', coalesce(reminder_row.campaign_name, ''));
    message_title_value := replace(message_title_value, '{{mission_name}}', coalesce(reminder_row.mission_name, ''));
    message_title_value := replace(message_title_value, '{{mission_progress}}', coalesce(reminder_row.progress_count::text, ''));
    message_title_value := replace(message_title_value, '{{mission_goal}}', coalesce(reminder_row.goal_count::text, ''));
    message_title_value := replace(message_title_value, '{{reward_name}}', coalesce(reminder_row.reward_name, ''));
    message_title_value := replace(message_title_value, '{{reward_expires_at}}', case when reminder_row.expires_at is null then '' else to_char((reminder_row.expires_at at time zone time_zone_value)::date, 'DD/MM/YYYY') end);
    message_title_value := replace(message_title_value, '{{days_remaining}}', case when reminder_row.expires_at is null then '' else greatest(0, ceil(extract(epoch from (reminder_row.expires_at - now())) / 86400)::integer)::text end);

    message_body_value := replace(message_template_body, '{{customer_name}}', coalesce((
      select c.name from public.customers c where c.id = reminder_row.customer_id and c.owner_id = reminder_row.owner_id
    ), ''));
    message_body_value := replace(message_body_value, '{{business_name}}', coalesce((
      select p.business_name from public.profiles p where p.id = reminder_row.owner_id
    ), ''));
    message_body_value := replace(message_body_value, '{{campaign_name}}', coalesce(reminder_row.campaign_name, ''));
    message_body_value := replace(message_body_value, '{{mission_name}}', coalesce(reminder_row.mission_name, ''));
    message_body_value := replace(message_body_value, '{{mission_progress}}', coalesce(reminder_row.progress_count::text, ''));
    message_body_value := replace(message_body_value, '{{mission_goal}}', coalesce(reminder_row.goal_count::text, ''));
    message_body_value := replace(message_body_value, '{{reward_name}}', coalesce(reminder_row.reward_name, ''));
    message_body_value := replace(message_body_value, '{{reward_expires_at}}', case when reminder_row.expires_at is null then '' else to_char((reminder_row.expires_at at time zone time_zone_value)::date, 'DD/MM/YYYY') end);
    message_body_value := replace(message_body_value, '{{days_remaining}}', case when reminder_row.expires_at is null then '' else greatest(0, ceil(extract(epoch from (reminder_row.expires_at - now())) / 86400)::integer)::text end);

    insert into public.communication_notification_outbox (
      owner_id, customer_id, event_type, event_key, engagement_channel,
      campaign_id, card_id, reminder_subject_id, activity_snapshot_at, message_title, message_body
    ) values (
      reminder_row.owner_id, reminder_row.customer_id, reminder_row.event_type,
      event_key_value, channel_value, reminder_row.campaign_id, reminder_row.card_id,
      reminder_row.subject_id, reminder_row.due_at,
      case when channel_value = 'push' then left(message_title_value, 70) else null end,
      case when channel_value = 'push' then left(message_body_value, 220) else null end
    ) on conflict (owner_id, event_key) do nothing;
    if found then queued_count := queued_count + 1; end if;
  end loop;
  return jsonb_build_object('queued', queued_count);
end;
$$;
revoke all on function public.enqueue_due_customer_engagement_reminders(integer) from public, anon, authenticated;
grant execute on function public.enqueue_due_customer_engagement_reminders(integer) to service_role;

create or replace function public.enqueue_communication_notification(
  owner_id_input uuid, customer_id_input text, event_type_input text, event_key_input text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  whatsapp_eligible boolean;
  push_eligible boolean;
begin
  if event_type_input not in ('visit_validated', 'mission_completed', 'reward_claimed') then return; end if;
  if not exists (select 1 from public.profiles p where p.id = owner_id_input and p.role = 'owner' and p.access = 'active') then return; end if;
  select exists (
    select 1 from public.customer_portal_communication_preferences pref
    join public.company_communication_integrations integration on integration.owner_id = pref.owner_id
      and integration.whatsapp_account_id is not null and integration.zernio_api_key_ciphertext is not null
    join public.customers customer on customer.id = pref.customer_id and customer.owner_id = pref.owner_id
    join public.company_notification_templates template on template.owner_id = pref.owner_id
      and template.event_type = event_type_input and template.account_id = integration.whatsapp_account_id
      and template.enabled and template.template_status = 'APPROVED'
    where pref.owner_id = owner_id_input and pref.customer_id = customer_id_input
      and pref.channel = 'whatsapp' and pref.category = 'loyalty_updates'
      and pref.enabled and pref.revoked_at is null
      and public.engagement_whatsapp_number_is_valid(customer.mobile, integration.phone_country_code)
      and exists (select 1 from public.communication_schema_capabilities capability
        where capability.capability = 'whatsapp_named_template_variables_v1')
  ) into whatsapp_eligible;
  select exists (
    select 1 from public.customer_portal_communication_preferences pref
    join public.customer_push_subscription_links link on link.owner_id = pref.owner_id
      and link.customer_id = pref.customer_id and link.revoked_at is null
    join public.customer_push_subscriptions subscription on subscription.id = link.subscription_id
      and subscription.revoked_at is null and (subscription.expiration_time is null or subscription.expiration_time > now())
    where pref.owner_id = owner_id_input and pref.customer_id = customer_id_input
      and pref.channel = 'push' and pref.category = 'loyalty_updates'
      and pref.enabled and pref.revoked_at is null
  ) into push_eligible;
  if not whatsapp_eligible and not push_eligible then return; end if;
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
  set status = 'skipped', locked_at = null, last_error_code = 'invalid_phone_number'
  from public.customers customer, public.company_communication_integrations integration
  where o.owner_id = customer.owner_id and o.customer_id = customer.id
    and integration.owner_id = o.owner_id
    and o.status = 'pending' and (o.engagement_channel is null or o.engagement_channel = 'whatsapp')
    and not public.engagement_whatsapp_number_is_valid(customer.mobile, integration.phone_country_code)
    and exists (
      select 1 from public.customer_portal_communication_preferences pref
      join public.company_notification_templates template on template.owner_id = pref.owner_id
        and template.event_type = o.event_type and template.account_id = integration.whatsapp_account_id
        and template.enabled and template.template_status = 'APPROVED'
      where pref.owner_id = o.owner_id and pref.customer_id = o.customer_id
        and pref.channel = 'whatsapp'
        and pref.category = case when o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then 'marketing' else 'loyalty_updates' end
        and pref.enabled and pref.revoked_at is null
    );

  update public.communication_notification_outbox o
  set status = 'skipped', locked_at = null, last_error_code = 'integration_or_template_disabled'
  where o.status = 'pending' and (o.engagement_channel is null or o.engagement_channel = 'whatsapp')
    and not exists (
      select 1 from public.company_communication_integrations i
      join public.company_notification_templates t on t.owner_id = i.owner_id and t.account_id = i.whatsapp_account_id
      join public.profiles p on p.id = i.owner_id and p.role = 'owner' and p.access = 'active'
      where i.owner_id = o.owner_id and i.zernio_api_key_ciphertext is not null and i.whatsapp_account_id is not null
        and t.event_type = o.event_type and t.enabled and t.template_status = 'APPROVED'
        and exists (select 1 from public.communication_schema_capabilities capability
          where capability.capability = 'whatsapp_named_template_variables_v1')
    );

  update public.communication_notification_outbox o
  set status = 'skipped', locked_at = null, last_error_code = 'consent_revoked'
  where o.status = 'pending' and (o.engagement_channel is null or o.engagement_channel = 'whatsapp')
    and not exists (
      select 1 from public.customer_portal_communication_preferences pref
      where pref.owner_id = o.owner_id and pref.customer_id = o.customer_id
        and pref.channel = 'whatsapp'
        and pref.category = case when o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then 'marketing' else 'loyalty_updates' end
        and pref.enabled and pref.revoked_at is null
    );

  update public.communication_notification_outbox o
  set status = 'failed', locked_at = null, last_error_code = 'attempt_limit_reached'
  where o.status = 'processing' and o.locked_at < now() - interval '5 minutes' and o.attempt_count >= 5;

  return query
  with candidates as (
    select o.id
    from public.communication_notification_outbox o
    join public.customer_portal_communication_preferences pref
      on pref.owner_id = o.owner_id and pref.customer_id = o.customer_id
      and pref.channel = 'whatsapp'
      and pref.category = case when o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then 'marketing' else 'loyalty_updates' end
      and pref.enabled and pref.revoked_at is null
    join public.company_communication_integrations integration on integration.owner_id = o.owner_id
    join public.company_notification_templates template
      on template.owner_id = o.owner_id and template.event_type = o.event_type
      and template.account_id = integration.whatsapp_account_id
      and template.enabled and template.template_status = 'APPROVED'
    join public.customers customer on customer.id = o.customer_id and customer.owner_id = o.owner_id
    join public.profiles profile on profile.id = o.owner_id and profile.role = 'owner' and profile.access = 'active'
    where (o.engagement_channel is null or o.engagement_channel = 'whatsapp')
      and (o.status = 'pending' or (o.status = 'processing' and o.locked_at < now() - interval '5 minutes'))
      and o.next_attempt_at <= now() and o.attempt_count < 5
      and integration.whatsapp_account_id is not null and integration.zernio_api_key_ciphertext is not null
      and public.engagement_whatsapp_number_is_valid(customer.mobile, integration.phone_country_code)
      and exists (select 1 from public.communication_schema_capabilities capability
        where capability.capability = 'whatsapp_named_template_variables_v1')
    order by o.created_at
    for update of o skip locked
    limit 5
  ), claimed as (
    update public.communication_notification_outbox o
    set status = 'processing', attempt_count = o.attempt_count + 1, locked_at = now()
    from candidates c where o.id = c.id
    returning o.*
  )
  select claimed.id, claimed.owner_id, claimed.customer_id, customer.name,
    case
      when length(phone.digits) between 12 and 15 and phone.digits like integration.phone_country_code || '%' then phone.digits
      when length(phone.digits) between 10 and 11 then integration.phone_country_code || phone.digits
      else null
    end,
    integration.whatsapp_account_id, claimed.event_type, template.template_name, template.template_language
  from claimed
  join public.customers customer on customer.id = claimed.customer_id and customer.owner_id = claimed.owner_id
  join public.company_communication_integrations integration on integration.owner_id = claimed.owner_id
  join public.company_notification_templates template on template.owner_id = claimed.owner_id and template.event_type = claimed.event_type
    and template.account_id = integration.whatsapp_account_id
  cross join lateral (select regexp_replace(coalesce(customer.mobile, ''), '[^0-9]+', '', 'g') as digits) phone;
end;
$$;
revoke all on function public.claim_communication_notifications() from public, anon, authenticated;
grant execute on function public.claim_communication_notifications() to service_role;

create or replace function public.customer_engagement_reminder_is_current(outbox_id_input uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  outbox_row public.communication_notification_outbox%rowtype;
  settings_row public.company_engagement_settings%rowtype;
  time_zone_value text;
  local_time_value time;
begin
  select * into outbox_row from public.communication_notification_outbox o where o.id = outbox_id_input;
  if not found or outbox_row.event_type not in ('return_reminder', 'mission_reminder', 'reward_expiring')
     or outbox_row.engagement_channel is null
     or outbox_row.engagement_channel not in ('push', 'whatsapp')
     or outbox_row.activity_snapshot_at is null then return false; end if;
  select * into settings_row from public.company_engagement_settings s
  where s.owner_id = outbox_row.owner_id and s.enabled;
  if not found then return false; end if;
  if not exists (select 1 from public.customers c
      where c.id = outbox_row.customer_id and c.owner_id = outbox_row.owner_id and c.status = 'Active') then
    return false;
  end if;
  if (outbox_row.event_type = 'return_reminder' and not settings_row.return_enabled)
     or (outbox_row.event_type = 'mission_reminder' and not settings_row.mission_enabled)
     or (outbox_row.event_type = 'reward_expiring' and not settings_row.reward_expiring_enabled)
     or (outbox_row.engagement_channel = 'push' and not settings_row.push_enabled)
     or (outbox_row.engagement_channel = 'whatsapp' and not settings_row.whatsapp_enabled) then return false; end if;
  if not exists (
    select 1 from public.company_engagement_campaigns ec
    join public.campaigns c on c.id = ec.campaign_id and c.owner_id = ec.owner_id and c.is_enabled
    where ec.owner_id = outbox_row.owner_id and ec.campaign_id = outbox_row.campaign_id and ec.enabled
  ) then return false; end if;
  select p.time_zone into time_zone_value from public.profiles p
  where p.id = outbox_row.owner_id and p.role = 'owner' and p.access = 'active';
  if time_zone_value is null then return false; end if;
  local_time_value := now() at time zone time_zone_value;
  if settings_row.quiet_hours_enabled and (
    case when settings_row.quiet_start < settings_row.quiet_end
      then local_time_value >= settings_row.quiet_start and local_time_value < settings_row.quiet_end
      else local_time_value >= settings_row.quiet_start or local_time_value < settings_row.quiet_end
    end
  ) then return false; end if;
  if (select count(*) from public.communication_notification_outbox o
      where o.owner_id = outbox_row.owner_id and o.customer_id = outbox_row.customer_id
        and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
        and o.created_at >= now() - interval '7 days') > settings_row.max_per_customer_per_7d
     or exists (select 1 from public.communication_notification_outbox o
       where o.owner_id = outbox_row.owner_id and o.customer_id = outbox_row.customer_id
         and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
         and o.id <> outbox_row.id
         and o.created_at < outbox_row.created_at
         and o.created_at >= outbox_row.created_at - make_interval(hours => settings_row.min_gap_hours)) then
    return false;
  end if;

  if outbox_row.event_type = 'return_reminder' then
    return exists (
      select 1 from public.issued_cards ic
      where ic.id = outbox_row.card_id and ic.owner_id = outbox_row.owner_id
        and ic.customer_id = outbox_row.customer_id and ic.campaign_id = outbox_row.campaign_id and ic.status = 'Active'
    ) and coalesce((
      select max(coalesce((select max(to_timestamp(t."timestamp" / 1000.0))
          from public.transactions t where t.card_id = ic.id and t.type = 'stamp_add'), ic.created_at))
      from public.issued_cards ic
      where ic.owner_id = outbox_row.owner_id and ic.customer_id = outbox_row.customer_id
        and ic.campaign_id = outbox_row.campaign_id and ic.status = 'Active'
    ), '-infinity'::timestamptz) <= outbox_row.activity_snapshot_at;
  elsif outbox_row.event_type = 'mission_reminder' then
    return exists (
      select 1
      from public.loyalty_missions m
      join public.issued_cards ic on ic.id = outbox_row.card_id and ic.owner_id = m.owner_id
        and ic.customer_id = outbox_row.customer_id and ic.campaign_id = m.campaign_id and ic.status = 'Active'
      where m.id::text = outbox_row.reminder_subject_id and m.owner_id = outbox_row.owner_id
        and m.campaign_id = outbox_row.campaign_id and m.is_active and m.starts_at <= now() and m.ends_at > now()
        and not exists (select 1 from public.mission_progress_events e
          where e.mission_id = m.id and e.customer_id = outbox_row.customer_id
            and (m.mission_type = 'visit_count' or e.card_id = ic.id)
            and e.created_at > outbox_row.activity_snapshot_at)
        and not exists (select 1 from public.mission_completions mc
          where mc.mission_id = m.id and mc.customer_id = outbox_row.customer_id
            and (mc.card_id = ic.id or mc.card_id is null) and mc.completed_at > outbox_row.activity_snapshot_at)
        and (select count(*) from public.mission_progress_events e
          where e.mission_id = m.id and e.customer_id = outbox_row.customer_id
            and (m.mission_type = 'visit_count' or e.card_id = ic.id)
            and e.created_at > coalesce((select max(mc.completed_at) from public.mission_completions mc
              where mc.mission_id = m.id and mc.customer_id = outbox_row.customer_id
                and (mc.card_id = ic.id or mc.card_id is null)), m.starts_at)) between 1 and m.goal_count - 1
    );
  else
    return exists (
      select 1 from public.loyalty_reward_redemptions rr
      join public.loyalty_rewards rw on rw.id = rr.reward_id and rw.owner_id = rr.owner_id
        and rw.campaign_id = outbox_row.campaign_id and rw.is_active
      where rr.id::text = outbox_row.reminder_subject_id and rr.owner_id = outbox_row.owner_id
        and rr.customer_id = outbox_row.customer_id and rr.status = 'issued' and rr.expires_at > now()
    );
  end if;
end;
$$;
revoke all on function public.customer_engagement_reminder_is_current(uuid) from public, anon, authenticated;
grant execute on function public.customer_engagement_reminder_is_current(uuid) to service_role;

create or replace function public.authorize_communication_notification(
  outbox_id_input uuid,
  account_id_input text,
  template_name_input text,
  template_language_input text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.communication_notification_outbox o
    join public.customer_portal_communication_preferences pref
      on pref.owner_id = o.owner_id and pref.customer_id = o.customer_id
      and pref.channel = 'whatsapp'
      and pref.category = case when o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then 'marketing' else 'loyalty_updates' end
      and pref.enabled and pref.revoked_at is null
    join public.company_communication_integrations i
      on i.owner_id = o.owner_id and i.whatsapp_account_id = account_id_input and i.zernio_api_key_ciphertext is not null
    join public.company_notification_templates t
      on t.owner_id = o.owner_id and t.account_id = i.whatsapp_account_id and t.event_type = o.event_type
      and t.enabled and t.template_name = template_name_input and t.template_language = template_language_input
      and t.template_status = 'APPROVED'
    join public.customers customer on customer.id = o.customer_id and customer.owner_id = o.owner_id
    join public.profiles p on p.id = o.owner_id and p.role = 'owner' and p.access = 'active'
    where o.id = outbox_id_input and o.status = 'processing'
      and (o.engagement_channel is null or o.engagement_channel = 'whatsapp')
      and public.engagement_whatsapp_number_is_valid(customer.mobile, i.phone_country_code)
      and (o.event_type not in ('return_reminder', 'mission_reminder', 'reward_expiring')
        or public.customer_engagement_reminder_is_current(o.id))
      and exists (select 1 from public.communication_schema_capabilities capability
        where capability.capability = 'whatsapp_named_template_variables_v1')
  )
$$;
revoke all on function public.authorize_communication_notification(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.authorize_communication_notification(uuid, text, text, text) to service_role;

create or replace function public.enqueue_customer_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_card_id text;
  event_card_unique_id uuid;
  event_category text;
begin
  if new.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then
    if new.engagement_channel is distinct from 'push' then return new; end if;
    event_card_id := new.card_id;
    event_category := 'marketing';
  else
    if new.engagement_channel = 'whatsapp' then return new; end if;
    event_category := 'loyalty_updates';
    if new.event_type = 'visit_validated' then
      select t.card_id into event_card_id
      from public.transactions t
      where t.id::text = split_part(new.event_key, ':', 2) and t.type = 'stamp_add';
    elsif new.event_type = 'mission_completed' then
      select coalesce(mc.card_id, latest_visit.card_id) into event_card_id
      from public.mission_completions mc
      join public.loyalty_missions m on m.id = mc.mission_id and m.owner_id = new.owner_id
      left join lateral (
        select t.card_id
        from public.transactions t
        join public.issued_cards ic on ic.id = t.card_id
        where ic.owner_id = new.owner_id and ic.customer_id = new.customer_id
          and t.type = 'stamp_add' and to_timestamp(t."timestamp" / 1000.0) <= mc.completed_at
        order by t."timestamp" desc limit 1
      ) latest_visit on true
      where mc.id::text = split_part(new.event_key, ':', 2) and mc.customer_id = new.customer_id;
    elsif new.event_type = 'reward_claimed' then
      select coalesce(rr.card_id, latest_card.id) into event_card_id
      from public.loyalty_reward_redemptions rr
      left join lateral (
        select ic.id from public.issued_cards ic
        where ic.owner_id = new.owner_id and ic.customer_id = new.customer_id and ic.created_at <= rr.issued_at
        order by ic.created_at desc limit 1
      ) latest_card on true
      where rr.id::text = split_part(new.event_key, ':', 2)
        and rr.owner_id = new.owner_id and rr.customer_id = new.customer_id;
    end if;
  end if;

  select ic.unique_id into event_card_unique_id
  from public.issued_cards ic
  where ic.id = event_card_id and ic.owner_id = new.owner_id and ic.customer_id = new.customer_id;
  if event_card_unique_id is null then return new; end if;

  insert into public.customer_push_notification_deliveries (
    outbox_id, subscription_id, owner_id, customer_id, card_unique_id, message_title, message_body
  )
  select new.id, l.subscription_id, new.owner_id, new.customer_id, event_card_unique_id,
    case when event_category = 'marketing' then new.message_title else null end,
    case when event_category = 'marketing' then new.message_body else null end
  from public.customer_push_subscription_links l
  join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
  join public.customer_portal_communication_preferences pref
    on pref.owner_id = l.owner_id and pref.customer_id = l.customer_id
    and pref.channel = 'push' and pref.category = event_category
    and pref.enabled and pref.revoked_at is null
  where l.owner_id = new.owner_id and l.customer_id = new.customer_id
    and l.card_unique_id = event_card_unique_id and l.revoked_at is null
    and (s.expiration_time is null or s.expiration_time > now())
  on conflict (outbox_id, subscription_id, owner_id, customer_id, card_unique_id) do nothing;
  return new;
end;
$$;
revoke all on function public.enqueue_customer_push_deliveries() from public, anon, authenticated;
drop trigger if exists enqueue_customer_push_deliveries on public.communication_notification_outbox;
create trigger enqueue_customer_push_deliveries
  after insert on public.communication_notification_outbox
  for each row execute function public.enqueue_customer_push_deliveries();

drop function if exists public.claim_customer_push_deliveries(integer);
create function public.claim_customer_push_deliveries(batch_limit integer default 50)
returns table (
  delivery_id uuid,
  owner_id uuid,
  customer_id text,
  customer_name text,
  business_name text,
  business_slug text,
  interface_language text,
  event_type text,
  endpoint_url text,
  p256dh_key text,
  auth_secret text,
  subscription_id uuid,
  card_unique_id uuid,
  message_title text,
  message_body text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customer_push_subscriptions s
  set revoked_at = now(), endpoint_url = '', p256dh_key = '', auth_secret = '', updated_at = now()
  where s.revoked_at is null and s.expiration_time is not null and s.expiration_time <= now();

  update public.customer_push_notification_deliveries d
  set status = 'failed', locked_at = null, last_error_code = 'attempt_limit_reached'
  where d.status = 'processing' and d.locked_at < now() - interval '10 minutes' and d.attempt_count >= 5;

  update public.customer_push_notification_deliveries d
  set status = 'skipped', locked_at = null, last_error_code = 'outbox_channel_mismatch'
  from public.communication_notification_outbox o
  where o.id = d.outbox_id and d.status in ('pending', 'retry', 'processing')
    and o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring')
    and o.engagement_channel is distinct from 'push';

  update public.customer_push_notification_deliveries d
  set status = 'skipped', locked_at = null, last_error_code = 'consent_or_subscription_revoked'
  where d.status in ('pending', 'retry')
    and not exists (
      select 1
      from public.customer_push_subscription_links l
      join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
      join public.communication_notification_outbox o on o.id = d.outbox_id
      join public.customer_portal_communication_preferences pref
        on pref.owner_id = l.owner_id and pref.customer_id = l.customer_id
        and pref.channel = 'push'
        and pref.category = case when o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then 'marketing' else 'loyalty_updates' end
        and pref.enabled and pref.revoked_at is null
      where l.subscription_id = d.subscription_id and l.owner_id = d.owner_id
        and l.customer_id = d.customer_id and l.card_unique_id = d.card_unique_id and l.revoked_at is null
    );

  return query
  with candidates as (
    select d.id
    from public.customer_push_notification_deliveries d
    join public.communication_notification_outbox o on o.id = d.outbox_id
    where (
        (d.status in ('pending', 'retry') and d.next_attempt_at <= now())
        or (d.status = 'processing' and d.locked_at < now() - interval '10 minutes')
      )
      and d.attempt_count < 5
      and (o.event_type not in ('return_reminder', 'mission_reminder', 'reward_expiring')
        or o.engagement_channel = 'push')
      and exists (
        select 1
        from public.customer_push_subscription_links l
        join public.customer_push_subscriptions s on s.id = l.subscription_id and s.revoked_at is null
        join public.customer_portal_communication_preferences pref
          on pref.owner_id = l.owner_id and pref.customer_id = l.customer_id
          and pref.channel = 'push'
          and pref.category = case when o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then 'marketing' else 'loyalty_updates' end
          and pref.enabled and pref.revoked_at is null
        where l.subscription_id = d.subscription_id and l.owner_id = d.owner_id
          and l.customer_id = d.customer_id and l.card_unique_id = d.card_unique_id and l.revoked_at is null
      )
    order by d.created_at
    for update of d skip locked
    limit greatest(1, least(coalesce(batch_limit, 50), 100))
  ), claimed as (
    update public.customer_push_notification_deliveries d
    set status = 'processing', locked_at = now(), attempt_count = d.attempt_count + 1
    from candidates c where d.id = c.id
    returning d.*
  )
  select c.id, c.owner_id, c.customer_id, cu.name, p.business_name, p.slug,
    p.interface_language, o.event_type, s.endpoint_url, s.p256dh_key, s.auth_secret,
    s.id, c.card_unique_id, c.message_title, c.message_body
  from claimed c
  join public.communication_notification_outbox o on o.id = c.outbox_id
  join public.customer_push_subscriptions s on s.id = c.subscription_id
  join public.customers cu on cu.id = c.customer_id and cu.owner_id = c.owner_id
  join public.profiles p on p.id = c.owner_id;
end;
$$;
revoke all on function public.claim_customer_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_customer_push_deliveries(integer) to service_role;

create or replace function public.authorize_customer_push_delivery(delivery_id_input uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_push_notification_deliveries d
    join public.communication_notification_outbox o on o.id = d.outbox_id
    join public.customer_push_subscription_links l
      on l.subscription_id = d.subscription_id and l.owner_id = d.owner_id
      and l.customer_id = d.customer_id and l.card_unique_id = d.card_unique_id and l.revoked_at is null
    join public.customer_push_subscriptions s on s.id = d.subscription_id and s.revoked_at is null
    join public.customer_portal_communication_preferences pref
      on pref.owner_id = d.owner_id and pref.customer_id = d.customer_id
      and pref.channel = 'push'
      and pref.category = case when o.event_type in ('return_reminder', 'mission_reminder', 'reward_expiring') then 'marketing' else 'loyalty_updates' end
      and pref.enabled and pref.revoked_at is null
    where d.id = delivery_id_input and d.status = 'processing'
      and (o.event_type not in ('return_reminder', 'mission_reminder', 'reward_expiring')
        or o.engagement_channel = 'push')
      and (o.event_type not in ('return_reminder', 'mission_reminder', 'reward_expiring')
        or public.customer_engagement_reminder_is_current(o.id))
  )
$$;
revoke all on function public.authorize_customer_push_delivery(uuid) from public, anon, authenticated;
grant execute on function public.authorize_customer_push_delivery(uuid) to service_role;

notify pgrst, 'reload schema';
