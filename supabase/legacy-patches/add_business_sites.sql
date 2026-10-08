-- Adds one public institutional site per Stampfy business tenant.
-- Additive migration: existing loyalty data and campaign URLs are preserved.

create table if not exists public.business_sites (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  slug text not null unique,
  draft_content jsonb not null,
  published_content jsonb,
  published_revision integer not null default 0 check (published_revision >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_site_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (owner_id, revision)
);

alter table public.business_sites enable row level security;
alter table public.business_site_revisions enable row level security;
revoke all on public.business_sites from public, anon, authenticated;
revoke all on public.business_site_revisions from public, anon, authenticated;

create or replace function public.default_business_site_content(business_name_input text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'version', 1,
    'branding', jsonb_build_object(
      'logoUrl', '',
      'primaryColor', '#1d4ed8',
      'accentColor', '#f59e0b'
    ),
    'hero', jsonb_build_object(
      'eyebrow', '',
      'title', coalesce(nullif(trim(business_name_input), ''), 'Sua empresa'),
      'description', '',
      'ctaLabel', 'Fale conosco',
      'ctaUrl', '',
      'imageUrl', ''
    ),
    'about', jsonb_build_object('title', 'Sobre a empresa', 'body', ''),
    'contact', jsonb_build_object(
      'email', '', 'phone', '', 'whatsapp', '', 'address', '',
      'city', '', 'region', '', 'postalCode', '', 'country', '',
      'serviceArea', '', 'openingHours', '', 'googleBusinessUrl', '',
      'instagramUrl', '', 'facebookUrl', ''
    ),
    'seo', jsonb_build_object('title', '', 'description', '', 'indexable', true, 'language', 'pt-BR'),
    'pages', jsonb_build_array(
      jsonb_build_object('id', 'about', 'slug', 'sobre', 'kind', 'about', 'title', 'Sobre', 'body', '', 'metaTitle', '', 'metaDescription', '', 'indexable', true, 'showInNavigation', true, 'enabled', true, 'featuredItemIds', '[]'::jsonb),
      jsonb_build_object('id', 'contact', 'slug', 'contato', 'kind', 'contact', 'title', 'Contato', 'body', '', 'metaTitle', '', 'metaDescription', '', 'indexable', true, 'showInNavigation', true, 'enabled', true, 'featuredItemIds', '[]'::jsonb),
      jsonb_build_object('id', 'privacy', 'slug', 'privacidade', 'kind', 'privacy', 'title', 'Privacidade', 'body', '', 'metaTitle', '', 'metaDescription', '', 'indexable', true, 'showInNavigation', false, 'enabled', false, 'featuredItemIds', '[]'::jsonb),
      jsonb_build_object('id', 'faq', 'slug', 'perguntas-frequentes', 'kind', 'faq', 'title', 'Perguntas frequentes', 'body', '', 'metaTitle', '', 'metaDescription', '', 'indexable', true, 'showInNavigation', true, 'enabled', false, 'featuredItemIds', '[]'::jsonb)
    ),
    'items', '[]'::jsonb
  )
$$;
revoke all on function public.default_business_site_content(text) from public, anon, authenticated;

create or replace function public.validate_business_site_content(content_input jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if jsonb_typeof(content_input) is distinct from 'object'
    or octet_length(content_input::text) > 524288
    or jsonb_typeof(content_input->'branding') is distinct from 'object'
    or jsonb_typeof(content_input->'hero') is distinct from 'object'
    or jsonb_typeof(content_input->'about') is distinct from 'object'
    or jsonb_typeof(content_input->'contact') is distinct from 'object'
    or jsonb_typeof(content_input->'seo') is distinct from 'object'
    or jsonb_typeof(content_input->'pages') is distinct from 'array'
    or jsonb_typeof(content_input->'items') is distinct from 'array' then
    raise exception 'Invalid business site content.';
  end if;

  if coalesce(content_input #>> '{seo,language}', 'pt-BR') not in ('pt-BR', 'es', 'en') then
    raise exception 'Unsupported business site language.';
  end if;
  if jsonb_typeof(content_input #> '{seo,indexable}') is distinct from 'boolean' then
    raise exception 'The site indexability setting must be a boolean.';
  end if;

  if jsonb_array_length(content_input->'pages') > 40
    or jsonb_array_length(content_input->'items') > 200 then
    raise exception 'Business site content exceeds the allowed limits.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(content_input->'pages') page
    where jsonb_typeof(page) is distinct from 'object'
      or coalesce(page->>'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or page->>'slug' in ('produtos-servicos', 'products-services')
      or length(coalesce(page->>'title', '')) not between 1 and 120
      or length(coalesce(page->>'body', '')) > 20000
      or jsonb_typeof(page->'enabled') is distinct from 'boolean'
      or jsonb_typeof(page->'indexable') is distinct from 'boolean'
      or jsonb_typeof(page->'showInNavigation') is distinct from 'boolean'
  ) then
    raise exception 'A page has an invalid URL, title, or body.';
  end if;

  if exists (
    select page->>'slug'
    from jsonb_array_elements(content_input->'pages') page
    group by page->>'slug'
    having count(*) > 1
  ) then
    raise exception 'Page URLs must be unique.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(content_input->'items') item
    where jsonb_typeof(item) is distinct from 'object'
      or coalesce(item->>'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or coalesce(item->>'kind', '') not in ('product', 'service')
      or length(coalesce(item->>'name', '')) not between 1 and 120
      or (coalesce(item->>'category', '') <> '' and coalesce(item->>'categorySlug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
      or length(coalesce(item->>'description', '')) > 20000
      or jsonb_typeof(item->'enabled') is distinct from 'boolean'
      or jsonb_typeof(item->'indexable') is distinct from 'boolean'
      or jsonb_typeof(item->'featured') is distinct from 'boolean'
  ) then
    raise exception 'A product or service has invalid data.';
  end if;

  if exists (
    select item->>'kind', item->>'slug'
    from jsonb_array_elements(content_input->'items') item
    group by item->>'kind', item->>'slug'
    having count(*) > 1
  ) then
    raise exception 'Product and service URLs must be unique within each type.';
  end if;
end;
$$;
revoke all on function public.validate_business_site_content(jsonb) from public, anon, authenticated;

create or replace function public.get_business_site_draft()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_row public.profiles%rowtype;
  site_row public.business_sites%rowtype;
  revisions_json jsonb;
begin
  select * into owner_row
  from public.profiles
  where id = (select auth.uid()) and role = 'owner' and access = 'active';

  if not found then
    raise exception 'Active business owner access required.';
  end if;
  if coalesce(owner_row.slug, '') = '' then
    raise exception 'A public business URL is required before creating a site.';
  end if;

  insert into public.business_sites(owner_id, slug, draft_content)
  values (owner_row.id, owner_row.slug, public.default_business_site_content(owner_row.business_name))
  on conflict (owner_id) do update set slug = excluded.slug;

  select * into site_row from public.business_sites where owner_id = owner_row.id;
  select coalesce(jsonb_agg(jsonb_build_object('revision', r.revision, 'createdAt', r.created_at) order by r.revision desc), '[]'::jsonb)
    into revisions_json
  from (
    select revision, created_at
    from public.business_site_revisions
    where owner_id = owner_row.id
    order by revision desc
    limit 20
  ) r;

  return jsonb_build_object(
    'businessName', owner_row.business_name,
    'slug', owner_row.slug,
    'draftContent', site_row.draft_content,
    'publishedContent', site_row.published_content,
    'publishedRevision', site_row.published_revision,
    'publishedAt', site_row.published_at,
    'updatedAt', site_row.updated_at,
    'hasUnpublishedChanges', site_row.published_content is not null and site_row.draft_content is distinct from site_row.published_content,
    'revisions', revisions_json
  );
end;
$$;
revoke all on function public.get_business_site_draft() from public, anon;
grant execute on function public.get_business_site_draft() to authenticated;

create or replace function public.save_business_site_draft(content_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_row public.profiles%rowtype;
begin
  select * into owner_row
  from public.profiles
  where id = (select auth.uid()) and role = 'owner' and access = 'active';
  if not found then raise exception 'Active business owner access required.'; end if;
  if coalesce(owner_row.slug, '') = '' then raise exception 'A public business URL is required before creating a site.'; end if;

  perform public.validate_business_site_content(content_input);
  insert into public.business_sites(owner_id, slug, draft_content)
  values (owner_row.id, owner_row.slug, content_input)
  on conflict (owner_id) do update
    set slug = excluded.slug, draft_content = excluded.draft_content, updated_at = now();

  return public.get_business_site_draft();
end;
$$;
revoke all on function public.save_business_site_draft(jsonb) from public, anon;
grant execute on function public.save_business_site_draft(jsonb) to authenticated;

create or replace function public.publish_business_site()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_row public.profiles%rowtype;
  site_row public.business_sites%rowtype;
  next_revision integer;
begin
  select * into owner_row
  from public.profiles
  where id = (select auth.uid()) and role = 'owner' and access = 'active';
  if not found then raise exception 'Active business owner access required.'; end if;

  select * into site_row from public.business_sites where owner_id = owner_row.id for update;
  if not found then raise exception 'Save the site draft before publishing.'; end if;
  perform public.validate_business_site_content(site_row.draft_content);
  if length(trim(coalesce(site_row.draft_content #>> '{hero,title}', ''))) = 0 then
    raise exception 'Add a homepage title before publishing.';
  end if;

  select coalesce(max(revision), 0) + 1 into next_revision
  from public.business_site_revisions where owner_id = owner_row.id;

  insert into public.business_site_revisions(owner_id, revision, snapshot, created_by)
  values (owner_row.id, next_revision, site_row.draft_content, owner_row.id);

  update public.business_sites
  set slug = owner_row.slug,
      published_content = site_row.draft_content,
      published_revision = next_revision,
      published_at = now(),
      updated_at = now()
  where owner_id = owner_row.id;

  return public.get_business_site_draft();
end;
$$;
revoke all on function public.publish_business_site() from public, anon;
grant execute on function public.publish_business_site() to authenticated;

create or replace function public.restore_business_site_revision(revision_input integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_row public.profiles%rowtype;
  site_row public.business_sites%rowtype;
  snapshot_content jsonb;
  next_revision integer;
begin
  select * into owner_row
  from public.profiles
  where id = (select auth.uid()) and role = 'owner' and access = 'active';
  if not found then raise exception 'Active business owner access required.'; end if;

  select r.snapshot into snapshot_content
  from public.business_site_revisions r
  where r.owner_id = owner_row.id and r.revision = revision_input;
  if snapshot_content is null then raise exception 'Site revision not found.'; end if;
  perform public.validate_business_site_content(snapshot_content);

  select * into site_row from public.business_sites where owner_id = owner_row.id for update;
  if not found then raise exception 'Business site not found.'; end if;
  select coalesce(max(revision), 0) + 1 into next_revision
  from public.business_site_revisions where owner_id = owner_row.id;

  insert into public.business_site_revisions(owner_id, revision, snapshot, created_by)
  values (owner_row.id, next_revision, snapshot_content, owner_row.id);
  update public.business_sites
  set draft_content = snapshot_content,
      published_content = snapshot_content,
      published_revision = next_revision,
      published_at = now(),
      updated_at = now()
  where owner_id = owner_row.id;

  return public.get_business_site_draft();
end;
$$;
revoke all on function public.restore_business_site_revision(integer) from public, anon;
grant execute on function public.restore_business_site_revision(integer) to authenticated;

create or replace function public.get_public_business_site(slug_input text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'businessName', p.business_name,
    'slug', s.slug,
    'content', jsonb_set(
      jsonb_set(
        s.published_content,
        '{pages}',
        coalesce((
          select jsonb_agg(page.value order by page.ordinality)
          from jsonb_array_elements(s.published_content->'pages') with ordinality as page(value, ordinality)
          where coalesce(page.value->'enabled', 'true'::jsonb) = 'true'::jsonb
        ), '[]'::jsonb),
        true
      ),
      '{items}',
      coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(s.published_content->'items') with ordinality as item(value, ordinality)
        where coalesce(item.value->'enabled', 'true'::jsonb) = 'true'::jsonb
      ), '[]'::jsonb),
      true
    ),
    'revision', s.published_revision,
    'publishedAt', s.published_at
  )
  from public.business_sites s
  join public.profiles p on p.id = s.owner_id
  where lower(s.slug) = lower(trim(slug_input))
    and p.role = 'owner'
    and p.access = 'active'
    and s.published_content is not null
  limit 1
$$;
revoke all on function public.get_public_business_site(text) from public;
grant execute on function public.get_public_business_site(text) to anon, authenticated;

create or replace function public.list_public_business_site_urls()
returns table (url_path text, last_modified timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select '/empresa/' || s.slug, s.published_at
  from public.business_sites s
  join public.profiles p on p.id = s.owner_id
  where p.role = 'owner' and p.access = 'active'
    and s.published_content is not null
    and coalesce(s.published_content #> '{seo,indexable}', 'true'::jsonb) = 'true'::jsonb

  union all

  select '/empresa/' || s.slug || '/produtos-servicos', s.published_at
  from public.business_sites s
  join public.profiles p on p.id = s.owner_id
  where p.role = 'owner' and p.access = 'active'
    and s.published_content is not null
    and coalesce(s.published_content #> '{seo,indexable}', 'true'::jsonb) = 'true'::jsonb
    and exists (
      select 1
      from jsonb_array_elements(s.published_content->'items') item
      where coalesce(item->'enabled', 'true'::jsonb) = 'true'::jsonb
    )

  union all

  select '/empresa/' || s.slug || '/' || (page->>'slug'), s.published_at
  from public.business_sites s
  join public.profiles p on p.id = s.owner_id
  cross join lateral jsonb_array_elements(s.published_content->'pages') page
  where p.role = 'owner' and p.access = 'active'
    and s.published_content is not null
    and coalesce(s.published_content #> '{seo,indexable}', 'true'::jsonb) = 'true'::jsonb
    and coalesce(page->'enabled', 'true'::jsonb) = 'true'::jsonb
    and coalesce(page->'indexable', 'true'::jsonb) = 'true'::jsonb

  union all

  select '/empresa/' || s.slug || '/' || (item->>'kind') || '/' || (item->>'slug'), s.published_at
  from public.business_sites s
  join public.profiles p on p.id = s.owner_id
  cross join lateral jsonb_array_elements(s.published_content->'items') item
  where p.role = 'owner' and p.access = 'active'
    and s.published_content is not null
    and coalesce(s.published_content #> '{seo,indexable}', 'true'::jsonb) = 'true'::jsonb
    and coalesce(item->'enabled', 'true'::jsonb) = 'true'::jsonb
    and coalesce(item->'indexable', 'true'::jsonb) = 'true'::jsonb

  union all

  select distinct '/empresa/' || s.slug || '/categoria/' || (item->>'categorySlug'), s.published_at
  from public.business_sites s
  join public.profiles p on p.id = s.owner_id
  cross join lateral jsonb_array_elements(s.published_content->'items') item
  where p.role = 'owner' and p.access = 'active'
    and s.published_content is not null
    and coalesce(s.published_content #> '{seo,indexable}', 'true'::jsonb) = 'true'::jsonb
    and coalesce(item->'enabled', 'true'::jsonb) = 'true'::jsonb
    and coalesce(item->'indexable', 'true'::jsonb) = 'true'::jsonb
    and nullif(item->>'categorySlug', '') is not null
$$;
revoke all on function public.list_public_business_site_urls() from public;
grant execute on function public.list_public_business_site_urls() to anon, authenticated;

notify pgrst, 'reload schema';
