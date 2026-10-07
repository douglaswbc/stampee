-- Owner-only reset for operational business data. Keeps owner/staff accounts,
-- company profile, locale preferences, license keys, and the database schema.

create or replace function public.reset_owner_business_data()
returns jsonb as $$
declare
  owner_id_value uuid;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid()
    and p.role = 'owner'
    and p.access = 'active'
  for update;

  if owner_id_value is null then
    raise exception 'Active owner authentication required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(owner_id_value::text), hashtext('reset-business-data'));

  delete from public.trusted_card_action_events e
  using public.transactions t
  join public.issued_cards c on c.id = t.card_id
  where e.transaction_id = t.id
    and c.owner_id = owner_id_value;

  -- Delete restricted reward-code references before the reward catalog.
  delete from public.loyalty_reward_redemptions
  where owner_id = owner_id_value;
  delete from public.loyalty_rewards
  where owner_id = owner_id_value;

  -- Mission progress, completions, and delivery history cascade from missions.
  delete from public.loyalty_missions
  where owner_id = owner_id_value;

  -- Customer deletion cascades cards, transactions, points, badges, and claims.
  delete from public.customers
  where owner_id = owner_id_value;

  delete from public.campaigns
  where owner_id = owner_id_value;
  delete from public.loyalty_point_levels
  where owner_id = owner_id_value;
  delete from public.loyalty_points_programs
  where owner_id = owner_id_value;

  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.reset_owner_business_data() from public, anon;
grant execute on function public.reset_owner_business_data() to authenticated;

notify pgrst, 'reload schema';
