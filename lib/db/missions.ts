import { supabase } from '../supabase';
import type { LoyaltyMission, LoyaltyMissionCompletion, LoyaltyMissionType, Transaction } from '../../types';

function parseMission(value: unknown): LoyaltyMission | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const completions = Array.isArray(row.completions)
    ? row.completions.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const completion = value as Record<string, unknown>;
      const claimStatus = completion.catalogRewardClaimStatus;
      return [{
        id: typeof completion.id === 'string' ? completion.id : undefined,
        completionNumber: Number(completion.completionNumber) || undefined,
        rewardDescription: typeof completion.rewardDescription === 'string' ? completion.rewardDescription : undefined,
        rewardType: completion.rewardType === 'bonus_stamps' || completion.rewardType === 'catalog_reward'
          ? completion.rewardType : 'benefit',
        rewardStamps: Number(completion.rewardStamps) || 0,
        catalogRewardId: typeof completion.catalogRewardId === 'string' ? completion.catalogRewardId : null,
        catalogRewardClaimStatus: claimStatus === 'available' || claimStatus === 'issued' || claimStatus === 'redeemed'
          ? claimStatus : null,
        completedAt: typeof completion.completedAt === 'string' ? completion.completedAt : undefined,
        redeemedAt: typeof completion.redeemedAt === 'string' ? completion.redeemedAt : null,
      } satisfies LoyaltyMissionCompletion];
    })
    : undefined;

  return {
    id: row.id,
    ownerId: typeof row.ownerId === 'string' ? row.ownerId : undefined,
    campaignId: typeof row.campaignId === 'string' ? row.campaignId : null,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : '',
    missionType: row.missionType === 'card_stamps' ? 'card_stamps' : 'visit_count',
    goalCount: Number(row.goalCount) || 1,
    startsAt: typeof row.startsAt === 'string' ? row.startsAt : '',
    endsAt: typeof row.endsAt === 'string' ? row.endsAt : '',
    rewardType: row.rewardType === 'bonus_stamps' || row.rewardType === 'catalog_reward' ? row.rewardType : 'benefit',
    rewardDescription: typeof row.rewardDescription === 'string' ? row.rewardDescription : '',
    rewardStamps: Number(row.rewardStamps) || 0,
    catalogRewardId: typeof row.catalogRewardId === 'string' ? row.catalogRewardId : null,
    catalogRewardName: typeof row.catalogRewardName === 'string' ? row.catalogRewardName : null,
    maxCompletions: Number(row.maxCompletions) || 1,
    isActive: row.isActive === true,
    completedCount: Number(row.completedCount) || 0,
    redeemedCount: Number(row.redeemedCount) || 0,
    participantCount: Number(row.participantCount) || 0,
    progress: typeof row.progress === 'number' ? row.progress : undefined,
    availableRewards: Number(row.availableRewards) || 0,
    completions,
  };
}

export async function fetchOwnerMissions(): Promise<{ ok: true; missions: LoyaltyMission[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('get_owner_loyalty_missions');
  if (error) return { ok: false, error: error.message };
  const missions = Array.isArray(data)
    ? data.map(parseMission).filter((mission): mission is LoyaltyMission => mission !== null)
    : [];
  return { ok: true, missions };
}

export type MissionInput = {
  campaignId: string;
  name: string;
  description: string;
  missionType: LoyaltyMissionType;
  goalCount: number;
  startsAt: string;
  endsAt: string;
  rewardType: 'benefit' | 'bonus_stamps' | 'catalog_reward';
  rewardDescription: string;
  rewardStamps: number;
  catalogRewardId: string | null;
  maxCompletions: number;
  isActive: boolean;
};

function missionToRow(input: MissionInput) {
  return {
    campaign_id: input.campaignId,
    name: input.name.trim(),
    description: input.description.trim(),
    mission_type: input.missionType,
    goal_count: input.goalCount,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    reward_description: input.rewardDescription.trim(),
    reward_type: input.rewardType,
    reward_stamps: input.rewardStamps,
    catalog_reward_id: input.catalogRewardId,
    max_completions: input.maxCompletions,
    is_active: input.isActive,
  };
}

export async function createMission(input: MissionInput): Promise<{ ok: boolean; error?: string }> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: 'Sign in as the business owner to create a mission.' };
  const { error } = await supabase.from('loyalty_missions').insert({
    ...missionToRow(input),
    owner_id: userData.user.id,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateMission(id: string, input: MissionInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('loyalty_missions').update(missionToRow(input)).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setMissionActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('loyalty_missions').update({ is_active: isActive }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchCardMissions(cardId: string): Promise<{ ok: true; missions: LoyaltyMission[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('get_card_loyalty_missions', { card_id_input: cardId });
  if (error) return { ok: false, error: error.message };
  const missions = Array.isArray(data)
    ? data.map(parseMission).filter((mission): mission is LoyaltyMission => mission !== null)
    : [];
  return { ok: true, missions };
}

export async function redeemMissionReward(completionId: string): Promise<{
  ok: true;
  card?: { id: string; stamps: number; status: 'Active' | 'Redeemed'; completedDate?: string; lastVisit?: string };
  transaction?: Transaction;
} | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('redeem_mission_reward', { completion_id_input: completionId });
  if (error) return { ok: false, error: error.message };
  if (!data || typeof data !== 'object' || (data as { success?: boolean }).success !== true) {
    return { ok: false, error: 'The reward could not be confirmed.' };
  }
  const result = data as {
    card?: { id?: string; stamps?: number; status?: 'Active' | 'Redeemed'; completedDate?: string; lastVisit?: string } | null;
    transaction?: Record<string, unknown> | null;
  };
  const card = result.card?.id ? {
    id: result.card.id,
    stamps: Number(result.card.stamps) || 0,
    status: result.card.status ?? 'Active',
    completedDate: result.card.completedDate,
    lastVisit: result.card.lastVisit,
  } : undefined;
  const row = result.transaction;
  const transaction = row && typeof row.id === 'string' ? {
    id: row.id,
    type: 'mission_bonus' as const,
    amount: Number(row.amount) || 0,
    date: typeof row.date === 'string' ? row.date : '',
    timestamp: Number(row.timestamp) || Date.now(),
    title: typeof row.title === 'string' ? row.title : 'Mission bonus stamps',
    remarks: typeof row.remarks === 'string' ? row.remarks : undefined,
    actorId: typeof row.actorId === 'string' ? row.actorId : undefined,
    actorName: typeof row.actorName === 'string' ? row.actorName : undefined,
    actorRole: row.actorRole === 'staff' ? 'staff' as const : 'owner' as const,
  } : undefined;
  return { ok: true, card, transaction };
}

