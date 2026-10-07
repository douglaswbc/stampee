import { supabase } from '../supabase';
import type { CustomerLoyaltyPoints, LoyaltyPointLevel } from '../../types';

export interface LoyaltyPointsConfiguration {
  isEnabled: boolean;
  pointsPerVisit: number;
  levels: LoyaltyPointLevel[];
}

export interface LoyaltyPointsCustomer {
  id: string;
  name: string;
  balance: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? value as Record<string, unknown> : null;

const parseLevel = (value: unknown): LoyaltyPointLevel | null => {
  const row = asRecord(value);
  if (!row || typeof row.name !== 'string') return null;
  return {
    name: row.name,
    minPoints: Number(row.minPoints) || 0,
    benefit: typeof row.benefit === 'string' ? row.benefit : '',
  };
};

export async function fetchLoyaltyPointsConfiguration(): Promise<
  { ok: true; configuration: LoyaltyPointsConfiguration } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('get_owner_loyalty_points_configuration');
  if (error) return { ok: false, error: error.message };
  const row = asRecord(data);
  if (!row) return { ok: false, error: 'Unable to read loyalty point settings.' };
  const levels = Array.isArray(row.levels)
    ? row.levels.map(parseLevel).filter((level): level is LoyaltyPointLevel => level !== null)
    : [];
  return {
    ok: true,
    configuration: {
      isEnabled: row.isEnabled === true,
      pointsPerVisit: Number(row.pointsPerVisit) || 10,
      levels,
    },
  };
}

export async function saveLoyaltyPointsConfiguration(configuration: LoyaltyPointsConfiguration): Promise<
  { ok: true; configuration: LoyaltyPointsConfiguration } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('save_owner_loyalty_points_configuration', {
    is_enabled_input: configuration.isEnabled,
    points_per_visit_input: configuration.pointsPerVisit,
    levels_input: configuration.levels.map(level => ({
      name: level.name,
      min_points: level.minPoints,
      benefit: level.benefit,
    })),
  });
  if (error) return { ok: false, error: error.message };
  const row = asRecord(data);
  if (!row) return { ok: false, error: 'Unable to save loyalty point settings.' };
  return {
    ok: true,
    configuration: {
      isEnabled: row.isEnabled === true,
      pointsPerVisit: Number(row.pointsPerVisit) || configuration.pointsPerVisit,
      levels: Array.isArray(row.levels)
        ? row.levels.map(parseLevel).filter((level): level is LoyaltyPointLevel => level !== null)
        : configuration.levels,
    },
  };
}

export async function fetchLoyaltyPointsCustomers(): Promise<
  { ok: true; customers: LoyaltyPointsCustomer[] } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('get_owner_loyalty_point_customers');
  if (error) return { ok: false, error: error.message };
  const customers = Array.isArray(data)
    ? data.flatMap(value => {
      const row = asRecord(value);
      return row && typeof row.id === 'string' && typeof row.name === 'string'
        ? [{ id: row.id, name: row.name, balance: Number(row.balance) || 0 }]
        : [];
    })
    : [];
  return { ok: true, customers };
}

export async function adjustLoyaltyPoints(input: {
  customerId: string;
  pointsDelta: number;
  reason: string;
  idempotencyKey: string;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('adjust_customer_loyalty_points', {
    customer_id_input: input.customerId,
    points_delta_input: input.pointsDelta,
    reason_input: input.reason,
    idempotency_key_input: input.idempotencyKey,
  });
  if (error) return { ok: false, error: error.message };
  const row = asRecord(data);
  if (!row || row.success !== true) return { ok: false, error: 'Unable to apply this point adjustment.' };
  return { ok: true, balance: Number(row.balance) || 0 };
}

export function parseCustomerLoyaltyPoints(value: unknown): CustomerLoyaltyPoints | null {
  const row = asRecord(value);
  if (!row) return null;
  const currentLevel = row.currentLevel === null ? null : parseLevel(row.currentLevel);
  const nextLevel = row.nextLevel === null ? null : parseLevel(row.nextLevel);
  const history = Array.isArray(row.history)
    ? row.history.flatMap(value => {
      const entry = asRecord(value);
      if (!entry || typeof entry.description !== 'string' || typeof entry.createdAt !== 'string') return [];
      const entryType = entry.entryType === 'visit_reversal' || entry.entryType === 'manual_adjustment'
        || entry.entryType === 'reward_redemption' || entry.entryType === 'reward_refund'
        ? entry.entryType
        : 'visit';
      return [{ entryType, pointsDelta: Number(entry.pointsDelta) || 0, description: entry.description, createdAt: entry.createdAt }];
    })
    : [];
  const badges = Array.isArray(row.badges)
    ? row.badges.flatMap(value => {
      const badge = asRecord(value);
      return badge && (badge.badgeKey === 'first_visit' || badge.badgeKey === 'mission_completion') && typeof badge.earnedAt === 'string'
        ? [{ badgeKey: badge.badgeKey, earnedAt: badge.earnedAt }]
        : [];
    })
    : [];
  return {
    isEnabled: row.isEnabled === true,
    balance: Number(row.balance) || 0,
    currentLevel,
    nextLevel,
    pointsToNextLevel: row.pointsToNextLevel === null ? null : Number(row.pointsToNextLevel) || 0,
    progressPercent: Math.min(100, Math.max(0, Number(row.progressPercent) || 0)),
    history,
    badges,
  };
}
