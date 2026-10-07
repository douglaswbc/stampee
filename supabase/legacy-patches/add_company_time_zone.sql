-- Adds a company time zone. The application supplies the browser time zone
-- when an owner signs up; existing owners can review and save it in Settings.
alter table public.profiles
  add column if not exists time_zone text;

-- Preserve the browser time zone from signup metadata when the profile is
-- created by the auth trigger.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role text;
  v_owner_id uuid;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'owner');

  if v_role = 'staff'
    and (new.raw_user_meta_data->>'owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_owner_id := (new.raw_user_meta_data->>'owner_id')::uuid;
  else
    v_owner_id := null;
  end if;

  insert into public.profiles (id, business_name, email, slug, role, owner_id, status, access, tier, time_zone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'business_name', ''),
    new.email,
    case when v_role = 'owner' then new.raw_user_meta_data->>'slug' else null end,
    v_role,
    v_owner_id,
    'unverified',
    'active',
    'free',
    case when v_role = 'owner' then nullif(new.raw_user_meta_data->>'time_zone', '') else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer
set search_path = public;

-- Return the company's time zone to the public loyalty card so mission
-- boundaries are shown in the same time zone the owner configured.
create or replace function public.get_public_card(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_row record;
  card_row record;
  customer_row record;
  campaign_payload jsonb;
  history_data jsonb;
  missions_payload jsonb;
begin
  select id, slug, business_name, time_zone into owner_row
  from public.profiles where slug = slug_input and role = 'owner';
  if not found then return null; end if;

  select * into card_row
  from public.issued_cards where unique_id = card_unique_id and owner_id = owner_row.id;
  if not found then return null; end if;

  select * into customer_row
  from public.customers where id = card_row.customer_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'reward_name', c.reward_name, 'tagline', c.tagline,
    'background_image', c.background_image, 'background_opacity', c.background_opacity,
    'logo_image', c.logo_image, 'show_logo', c.show_logo, 'title_size', c.title_size,
    'icon_key', c.icon_key, 'colors', c.colors,
    'total_stamps', c.total_stamps, 'social', c.social
  ) into campaign_payload
  from public.campaigns c where c.id = card_row.campaign_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'type', t.type, 'amount', t.amount,
    'date', t.date, 'timestamp', t."timestamp", 'title', t.title
  ) order by t."timestamp"), '[]'::jsonb)
  into history_data
  from public.transactions t where t.card_id = card_row.id;

  select coalesce(jsonb_agg(
    public.mission_progress_payload(m.id, card_row.customer_id, card_row.id, false)
    order by m.ends_at asc
  ), '[]'::jsonb)
  into missions_payload
  from public.loyalty_missions m
  where m.owner_id = owner_row.id
    and m.campaign_id = card_row.campaign_id
    and (
      m.is_active
      or exists (
        select 1 from public.mission_completions c
        where c.mission_id = m.id and c.customer_id = card_row.customer_id
          and (c.card_id is null or c.card_id = card_row.id)
      )
    );

  return jsonb_build_object(
    'card', jsonb_build_object(
      'id', card_row.id, 'uniqueId', card_row.unique_id,
      'campaignId', card_row.campaign_id, 'campaignName', card_row.campaign_name,
      'stamps', card_row.stamps, 'lastVisit', card_row.last_visit,
      'status', card_row.status, 'completedDate', card_row.completed_date,
      'templateSnapshot', card_row.template_snapshot, 'history', history_data
    ),
    'customer', jsonb_build_object('id', customer_row.id, 'name', customer_row.name),
    'campaign', campaign_payload,
    'missions', missions_payload,
    'timeZone', owner_row.time_zone
  );
end;
$$ language plpgsql security definer
set search_path = public;

grant execute on function public.get_public_card(text, uuid) to anon, authenticated;
