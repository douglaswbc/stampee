-- Owner-only dashboard aggregates for missions, rewards, points, referrals,
-- and recent loyalty activity. Requires the missions, rewards, and referral patches.
create or replace function public.get_owner_loyalty_dashboard_summary()
returns jsonb as $$
declare
  owner_id_value uuid;
  program_row public.loyalty_points_programs%rowtype;
  result jsonb;
begin
  select p.id into owner_id_value
  from public.profiles p
  where p.id = auth.uid()
    and p.role = 'owner'
    and p.access = 'active';

  if owner_id_value is null then
    raise exception 'Active business owner authentication required.';
  end if;

  perform public.process_loyalty_reward_expirations(owner_id_value);

  select * into program_row
  from public.loyalty_points_programs p
  where p.owner_id = owner_id_value;

  select jsonb_build_object(
    'missionCount', (
      select count(*)::integer from public.loyalty_missions m where m.owner_id = owner_id_value
    ),
    'activeMissionCount', (
      select count(*)::integer
      from public.loyalty_missions m
      where m.owner_id = owner_id_value and m.is_active
        and m.starts_at <= now() and m.ends_at > now()
    ),
    'missionParticipantCount', (
      select count(distinct e.customer_id)::integer
      from public.mission_progress_events e
      join public.loyalty_missions m on m.id = e.mission_id
      where m.owner_id = owner_id_value
    ),
    'missionCompletionCount', (
      select count(*)::integer
      from public.mission_completions c
      join public.loyalty_missions m on m.id = c.mission_id
      where m.owner_id = owner_id_value
    ),
    'activeRewardCount', (
      select count(*)::integer
      from public.loyalty_rewards r
      where r.owner_id = owner_id_value and r.is_active
        and r.starts_at <= now() and r.ends_at > now()
    ),
    'pendingRewardCodeCount', (
      select count(*)::integer
      from public.loyalty_reward_redemptions r
      where r.owner_id = owner_id_value and r.status = 'issued' and r.expires_at > now()
    ),
    'redeemedRewardCodeCount', (
      select count(*)::integer
      from public.loyalty_reward_redemptions r
      where r.owner_id = owner_id_value and r.status = 'redeemed'
    ),
    'pointsEnabled', coalesce(program_row.is_enabled, false),
    'pointsPerVisit', coalesce(program_row.points_per_visit, 10),
    'welcomePoints', coalesce(program_row.welcome_points, 0),
    'loyaltyLevelCount', (
      select count(*)::integer
      from public.loyalty_point_levels l
      where l.owner_id = owner_id_value
    ),
    'pendingReferralCount', (
      select count(*)::integer
      from public.customer_referrals r
      where r.owner_id = owner_id_value and r.status = 'pending'
    ),
    'rewardedReferralCount', (
      select count(*)::integer
      from public.customer_referrals r
      where r.owner_id = owner_id_value and r.status = 'rewarded'
    ),
    'referralPointsAwarded', (
      select coalesce(sum(l.points_delta), 0)::bigint
      from public.customer_loyalty_points_ledger l
      where l.owner_id = owner_id_value and l.entry_type = 'referral_reward'
    ),
    'welcomeBonusCustomerCount', (
      select count(distinct l.customer_id)::integer
      from public.customer_loyalty_points_ledger l
      where l.owner_id = owner_id_value and l.entry_type = 'welcome_bonus'
    ),
    'welcomePointsAwarded', (
      select coalesce(sum(l.points_delta), 0)::bigint
      from public.customer_loyalty_points_ledger l
      where l.owner_id = owner_id_value and l.entry_type = 'welcome_bonus'
    ),
    'recentActivity', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', recent.id,
        'type', recent.event_type,
        'customerName', recent.customer_name,
        'contextName', recent.context_name,
        'pointsDelta', recent.points_delta,
        'timestamp', recent.occurred_at
      ) order by recent.occurred_at desc), '[]'::jsonb)
      from (
        select events.*
        from (
          select
            t.id::text as id,
            t.type::text as event_type,
            c.name::text as customer_name,
            coalesce(campaign.name, card.campaign_id, '')::text as context_name,
            visit_points.points_delta::integer as points_delta,
            t."timestamp"::bigint as occurred_at
          from public.transactions t
          join public.issued_cards card on card.id = t.card_id
          join public.customers c on c.id = card.customer_id
          left join public.campaigns campaign on campaign.id = card.campaign_id
          left join public.customer_loyalty_points_ledger visit_points
            on visit_points.owner_id = card.owner_id
            and visit_points.source_transaction_id = t.id
            and visit_points.entry_type = 'visit'
          where card.owner_id = owner_id_value

          union all

          select
            completion.id::text,
            'mission_completed'::text,
            c.name::text,
            m.name::text,
            null::integer,
            (extract(epoch from completion.completed_at) * 1000)::bigint
          from public.mission_completions completion
          join public.loyalty_missions m on m.id = completion.mission_id
          join public.customers c on c.id = completion.customer_id
          where m.owner_id = owner_id_value

          union all

          select
            'mission-redeemed:' || redemption.id::text,
            'mission_reward_redeemed'::text,
            c.name::text,
            m.name::text,
            null::integer,
            (extract(epoch from redemption.redeemed_at) * 1000)::bigint
          from public.mission_reward_redemptions redemption
          join public.loyalty_missions m on m.id = redemption.mission_id
          join public.customers c on c.id = redemption.customer_id
          where m.owner_id = owner_id_value

          union all

          select
            'reward-code:' || redemption_event.id::text,
            ('reward_code_' || redemption_event.event_type)::text,
            c.name::text,
            redemption.reward_name::text,
            null::integer,
            (extract(epoch from redemption_event.created_at) * 1000)::bigint
          from public.loyalty_reward_redemption_events redemption_event
          join public.loyalty_reward_redemptions redemption on redemption.id = redemption_event.redemption_id
          join public.customers c on c.id = redemption.customer_id
          where redemption_event.owner_id = owner_id_value and redemption_event.event_type in ('issued', 'redeemed')

          union all

          select
            ledger.id::text,
            ledger.entry_type::text,
            c.name::text,
            ''::text,
            ledger.points_delta,
            (extract(epoch from ledger.created_at) * 1000)::bigint
          from public.customer_loyalty_points_ledger ledger
          join public.customers c on c.id = ledger.customer_id
          where ledger.owner_id = owner_id_value
            and ledger.entry_type in ('welcome_bonus', 'referral_reward')
        ) events
        order by events.occurred_at desc
        limit 8
      ) recent
    )
  ) into result;

  return result;
end;
$$ language plpgsql security definer
set search_path = public;

revoke all on function public.get_owner_loyalty_dashboard_summary() from public, anon;
grant execute on function public.get_owner_loyalty_dashboard_summary() to authenticated;

notify pgrst, 'reload schema';
