-- ============================================================
-- Stampfy: Preserve Issued Cards When Deleting Campaigns
-- Upgrade script for existing Supabase projects.
-- Converts issued_cards.campaign_id to ON DELETE SET NULL,
-- backfills template snapshots, and adds an RPC that preserves
-- issued cards before deleting a campaign.
-- New projects should use migration.sql instead.
-- ============================================================

update public.issued_cards ic
set template_snapshot = coalesce(
      ic.template_snapshot,
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'rewardName', c.reward_name,
        'tagline', c.tagline,
        'backgroundImage', c.background_image,
        'backgroundOpacity', c.background_opacity,
        'logoImage', c.logo_image,
        'showLogo', c.show_logo,
        'titleSize', c.title_size,
        'iconKey', c.icon_key,
        'colors', c.colors,
        'totalStamps', c.total_stamps,
        'social', c.social
      )
    ),
    campaign_name = coalesce(nullif(ic.campaign_name, ''), c.name)
from public.campaigns c
where ic.campaign_id = c.id
  and (ic.template_snapshot is null or nullif(ic.campaign_name, '') is null);

do $$
declare
  issued_cards_campaign_fk text;
begin
  select conname
  into issued_cards_campaign_fk
  from pg_constraint
  where conrelid = 'public.issued_cards'::regclass
    and contype = 'f'
    and confrelid = 'public.campaigns'::regclass
    and array_position(
      conkey,
      (
        select attnum
        from pg_attribute
        where attrelid = 'public.issued_cards'::regclass
          and attname = 'campaign_id'
      )
    ) is not null
  limit 1;

  if issued_cards_campaign_fk is not null then
    execute format(
      'alter table public.issued_cards drop constraint %I',
      issued_cards_campaign_fk
    );
  end if;
end;
$$;

alter table public.issued_cards
  alter column campaign_id drop not null;

alter table public.issued_cards
  add constraint issued_cards_campaign_id_fkey
  foreign key (campaign_id)
  references public.campaigns(id)
  on delete set null;

create or replace function public.delete_campaign_preserve_cards(campaign_id_input text)
returns jsonb as $$
declare
  campaign_row public.campaigns%rowtype;
  campaign_snapshot jsonb;
begin
  select *
  into campaign_row
  from public.campaigns
  where id = campaign_id_input
    and owner_id = auth.uid();

  if not found then
    raise exception 'Campaign not found or not owned by current user';
  end if;

  campaign_snapshot := jsonb_build_object(
    'id', campaign_row.id,
    'name', campaign_row.name,
    'description', campaign_row.description,
    'rewardName', campaign_row.reward_name,
    'tagline', campaign_row.tagline,
    'backgroundImage', campaign_row.background_image,
    'backgroundOpacity', campaign_row.background_opacity,
    'logoImage', campaign_row.logo_image,
    'showLogo', campaign_row.show_logo,
    'titleSize', campaign_row.title_size,
    'iconKey', campaign_row.icon_key,
    'colors', campaign_row.colors,
    'totalStamps', campaign_row.total_stamps,
    'social', campaign_row.social
  );

  update public.issued_cards
  set template_snapshot = coalesce(template_snapshot, campaign_snapshot),
      campaign_name = coalesce(nullif(campaign_name, ''), campaign_row.name)
  where campaign_id = campaign_row.id;

  delete from public.campaigns
  where id = campaign_row.id;

  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer
set search_path = public;
