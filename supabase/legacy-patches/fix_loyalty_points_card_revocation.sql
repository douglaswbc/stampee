-- Preserve auditable points history when a card and its transactions are revoked.
-- The transaction foreign key uses ON DELETE SET NULL; idempotency_key keeps
-- the original visit/reversal reference after that source row is removed.

begin;

alter table public.customer_loyalty_points_ledger
  drop constraint if exists loyalty_points_entry_shape;

alter table public.customer_loyalty_points_ledger
  add constraint loyalty_points_entry_shape check (
    (
      entry_type = 'visit'
      and points_delta > 0
      and (source_transaction_id is not null or idempotency_key like 'visit:%')
      and reverses_entry_id is null
      and reward_redemption_id is null
    )
    or (
      entry_type = 'visit_reversal'
      and points_delta <= 0
      and (source_transaction_id is not null or idempotency_key like 'reversal:%')
      and reverses_entry_id is not null
      and reward_redemption_id is null
    )
    or (
      entry_type = 'manual_adjustment'
      and points_delta <> 0
      and source_transaction_id is null
      and reverses_entry_id is null
      and reward_redemption_id is null
    )
    or (
      entry_type = 'reward_redemption'
      and points_delta < 0
      and source_transaction_id is null
      and reverses_entry_id is null
      and reward_redemption_id is not null
    )
    or (
      entry_type = 'reward_refund'
      and points_delta > 0
      and source_transaction_id is null
      and reverses_entry_id is not null
      and reward_redemption_id is not null
    )
    or (
      entry_type in ('welcome_bonus', 'referral_reward')
      and points_delta > 0
      and source_transaction_id is null
      and reverses_entry_id is null
      and reward_redemption_id is null
    )
  );

commit;
