import { supabase } from '../supabase';
import type {
  LoyaltyReward,
  LoyaltyRewardRedemption,
  LoyaltyRewardStatus,
  LoyaltyRewardUnavailableReason,
  PublicLoyaltyReward,
} from '../../types';

export interface LoyaltyRewardInput {
  id: string | null;
  name: string;
  description: string;
  campaignId: string | null;
  pointsCost: number;
  minimumPoints: number;
  startsAt: string;
  endsAt: string;
  stockQuantity: number | null;
  maxClaimsPerCustomer: number;
  redemptionValidityHours: number;
  isActive: boolean;
}

export interface PublicLoyaltyRewards {
  balance: number;
  rewards: PublicLoyaltyReward[];
}

export interface LoyaltyRewardClaim {
  redemptionId: string;
  code: string;
  expiresAt: string;
  balance: number;
}

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | null =>
  value && typeof value === 'object' ? value as RecordValue : null;

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asNullableNumber = (value: unknown): number | null => value === null || value === undefined
  ? null
  : asNumber(value);

const parseReward = (value: unknown): LoyaltyReward | null => {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : '',
    campaignId: typeof row.campaignId === 'string' ? row.campaignId : null,
    pointsCost: asNumber(row.pointsCost),
    minimumPoints: asNumber(row.minimumPoints),
    startsAt: typeof row.startsAt === 'string' ? row.startsAt : '',
    endsAt: typeof row.endsAt === 'string' ? row.endsAt : '',
    stockQuantity: asNullableNumber(row.stockQuantity),
    remainingQuantity: asNullableNumber(row.remainingQuantity),
    activeClaimCount: asNumber(row.activeClaimCount),
    redeemedCount: asNumber(row.redeemedCount),
    maxClaimsPerCustomer: asNumber(row.maxClaimsPerCustomer, 1),
    redemptionValidityHours: asNumber(row.redemptionValidityHours, 168),
    isActive: row.isActive === true,
  };
};

const parsePublicReward = (value: unknown): PublicLoyaltyReward | null => {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const reason = row.unavailableReason;
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : '',
    pointsCost: asNumber(row.pointsCost),
    minimumPoints: asNumber(row.minimumPoints),
    remainingQuantity: asNullableNumber(row.remainingQuantity),
    customerClaimCount: asNumber(row.customerClaimCount),
    maxClaimsPerCustomer: asNumber(row.maxClaimsPerCustomer, 1),
    canClaim: row.canClaim === true,
    unavailableReason: reason === 'points_program_disabled' || reason === 'not_enough_points'
      || reason === 'sold_out' || reason === 'customer_limit' ? reason : null,
    endsAt: typeof row.endsAt === 'string' ? row.endsAt : '',
  };
};

const parseRedemption = (value: unknown): LoyaltyRewardRedemption | null => {
  const row = asRecord(value);
  const status = row?.status;
  if (!row || typeof row.id !== 'string' || typeof row.rewardName !== 'string' || typeof row.code !== 'string'
    || (status !== 'issued' && status !== 'redeemed' && status !== 'expired' && status !== 'cancelled')) return null;
  return {
    id: row.id,
    rewardName: row.rewardName,
    code: row.code,
    status: status as LoyaltyRewardStatus,
    pointsCost: asNumber(row.pointsCost),
    issuedAt: typeof row.issuedAt === 'string' ? row.issuedAt : '',
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : '',
    redeemedAt: typeof row.redeemedAt === 'string' ? row.redeemedAt : null,
    redeemedBy: typeof row.redeemedBy === 'string' ? row.redeemedBy : null,
    cancelledAt: typeof row.cancelledAt === 'string' ? row.cancelledAt : null,
    cancellationReason: typeof row.cancellationReason === 'string' ? row.cancellationReason : null,
    customerName: typeof row.customerName === 'string' ? row.customerName : undefined,
  };
};

const parseArray = <T>(value: unknown, parser: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map(parser).filter((item): item is T => item !== null) : [];

export async function fetchOwnerLoyaltyRewards(): Promise<
  { ok: true; rewards: LoyaltyReward[] } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('get_owner_loyalty_rewards');
  if (error) return { ok: false, error: error.message };
  return { ok: true, rewards: parseArray(data, parseReward) };
}

export async function saveOwnerLoyaltyReward(input: LoyaltyRewardInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('save_owner_loyalty_reward', {
    reward_id_input: input.id,
    name_input: input.name,
    description_input: input.description,
    campaign_id_input: input.campaignId,
    points_cost_input: input.pointsCost,
    minimum_points_input: input.minimumPoints,
    starts_at_input: input.startsAt,
    ends_at_input: input.endsAt,
    stock_quantity_input: input.stockQuantity,
    max_claims_per_customer_input: input.maxClaimsPerCustomer,
    redemption_validity_hours_input: input.redemptionValidityHours,
    is_active_input: input.isActive,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchPublicLoyaltyRewards(slug: string, cardUniqueId: string): Promise<
  { ok: true; data: PublicLoyaltyRewards } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('get_public_loyalty_rewards', {
    slug_input: slug,
    card_unique_id: cardUniqueId,
  });
  if (error) return { ok: false, error: error.message };
  const row = asRecord(data);
  if (!row) return { ok: false, error: 'Unable to load rewards.' };
  return { ok: true, data: { balance: asNumber(row.balance), rewards: parseArray(row.rewards, parsePublicReward) } };
}

export async function fetchPublicLoyaltyRewardRedemptions(slug: string, cardUniqueId: string): Promise<
  { ok: true; redemptions: LoyaltyRewardRedemption[] } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('get_public_loyalty_reward_redemptions', {
    slug_input: slug,
    card_unique_id: cardUniqueId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, redemptions: parseArray(data, parseRedemption) };
}

export async function claimPublicLoyaltyReward(input: {
  slug: string;
  cardUniqueId: string;
  rewardId: string;
  idempotencyKey: string;
}): Promise<
  { ok: true; claim: LoyaltyRewardClaim } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('claim_loyalty_reward', {
    slug_input: input.slug,
    card_unique_id: input.cardUniqueId,
    reward_id_input: input.rewardId,
    idempotency_key_input: input.idempotencyKey,
  });
  if (error) return { ok: false, error: error.message };
  const row = asRecord(data);
  if (!row || row.success !== true || typeof row.redemptionId !== 'string' || typeof row.code !== 'string' || typeof row.expiresAt !== 'string') {
    return { ok: false, error: typeof row?.error === 'string' ? row.error : 'unable_to_claim' };
  }
  return { ok: true, claim: { redemptionId: row.redemptionId, code: row.code, expiresAt: row.expiresAt, balance: asNumber(row.balance) } };
}

export async function fetchStaffLoyaltyRewardRedemptions(): Promise<
  { ok: true; redemptions: LoyaltyRewardRedemption[] } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('get_staff_loyalty_reward_redemptions');
  if (error) return { ok: false, error: error.message };
  return { ok: true, redemptions: parseArray(data, parseRedemption) };
}

export async function validateLoyaltyRewardCode(code: string): Promise<
  { ok: true; success: true; rewardName: string; customerName: string; redeemedAt: string }
  | { ok: true; success: false; error: string }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('validate_loyalty_reward_code', { code_input: code });
  if (error) return { ok: false, error: error.message };
  const row = asRecord(data);
  if (row?.success === true && typeof row.rewardName === 'string' && typeof row.customerName === 'string' && typeof row.redeemedAt === 'string') {
    return { ok: true, success: true, rewardName: row.rewardName, customerName: row.customerName, redeemedAt: row.redeemedAt };
  }
  return { ok: true, success: false, error: typeof row?.error === 'string' ? row.error : 'not_found' };
}

export async function cancelLoyaltyRewardCode(code: string, reason: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('cancel_loyalty_reward_code', { code_input: code, reason_input: reason });
  if (error) return { ok: false, error: error.message };
  const row = asRecord(data);
  return row?.success === true ? { ok: true } : { ok: false, error: typeof row?.error === 'string' ? row.error : 'unable_to_cancel' };
}

export function unavailableRewardReason(value: string | null): LoyaltyRewardUnavailableReason | null {
  return value === 'points_program_disabled' || value === 'not_enough_points' || value === 'sold_out' || value === 'customer_limit'
    ? value
    : null;
}
