import { supabase } from '../supabase';

export type DashboardActivityType =
  | 'issued'
  | 'stamp_add'
  | 'stamp_remove'
  | 'redeem'
  | 'mission_bonus'
  | 'mission_completed'
  | 'mission_reward_redeemed'
  | 'reward_code_issued'
  | 'reward_code_redeemed'
  | 'welcome_bonus'
  | 'referral_reward';

export interface DashboardActivityEvent {
  id: string;
  type: DashboardActivityType;
  customerName: string;
  contextName: string;
  pointsDelta: number | null;
  timestamp: number;
}

export interface DashboardSummary {
  missionCount: number;
  activeMissionCount: number;
  missionParticipantCount: number;
  missionCompletionCount: number;
  activeRewardCount: number;
  pendingRewardCodeCount: number;
  redeemedRewardCodeCount: number;
  pointsEnabled: boolean;
  pointsPerVisit: number;
  welcomePoints: number;
  loyaltyLevelCount: number;
  pendingReferralCount: number;
  rewardedReferralCount: number;
  referralPointsAwarded: number;
  welcomeBonusCustomerCount: number;
  welcomePointsAwarded: number;
  recentActivity: DashboardActivityEvent[];
}

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | null =>
  value && typeof value === 'object' ? value as RecordValue : null;

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const activityTypes = new Set<DashboardActivityType>([
  'issued', 'stamp_add', 'stamp_remove', 'redeem', 'mission_bonus', 'mission_completed',
  'mission_reward_redeemed', 'reward_code_issued', 'reward_code_redeemed', 'welcome_bonus', 'referral_reward',
]);

function parseSummary(value: unknown): DashboardSummary | null {
  const row = asRecord(value);
  if (!row) return null;
  const recentActivity = Array.isArray(row.recentActivity)
    ? row.recentActivity.flatMap(value => {
      const event = asRecord(value);
      if (!event || typeof event.id !== 'string' || typeof event.type !== 'string'
        || !activityTypes.has(event.type as DashboardActivityType)) return [];
      return [{
        id: event.id,
        type: event.type as DashboardActivityType,
        customerName: typeof event.customerName === 'string' ? event.customerName : '',
        contextName: typeof event.contextName === 'string' ? event.contextName : '',
        pointsDelta: event.pointsDelta === null || event.pointsDelta === undefined ? null : asNumber(event.pointsDelta),
        timestamp: asNumber(event.timestamp),
      }];
    })
    : [];

  return {
    missionCount: asNumber(row.missionCount),
    activeMissionCount: asNumber(row.activeMissionCount),
    missionParticipantCount: asNumber(row.missionParticipantCount),
    missionCompletionCount: asNumber(row.missionCompletionCount),
    activeRewardCount: asNumber(row.activeRewardCount),
    pendingRewardCodeCount: asNumber(row.pendingRewardCodeCount),
    redeemedRewardCodeCount: asNumber(row.redeemedRewardCodeCount),
    pointsEnabled: row.pointsEnabled === true,
    pointsPerVisit: asNumber(row.pointsPerVisit, 10),
    welcomePoints: asNumber(row.welcomePoints),
    loyaltyLevelCount: asNumber(row.loyaltyLevelCount),
    pendingReferralCount: asNumber(row.pendingReferralCount),
    rewardedReferralCount: asNumber(row.rewardedReferralCount),
    referralPointsAwarded: asNumber(row.referralPointsAwarded),
    welcomeBonusCustomerCount: asNumber(row.welcomeBonusCustomerCount),
    welcomePointsAwarded: asNumber(row.welcomePointsAwarded),
    recentActivity,
  };
}

export async function fetchOwnerDashboardSummary(): Promise<
  { ok: true; summary: DashboardSummary } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc('get_owner_loyalty_dashboard_summary');
  if (error) return { ok: false, error: error.message };
  const summary = parseSummary(data);
  return summary ? { ok: true, summary } : { ok: false, error: 'Unable to read dashboard summary.' };
}
