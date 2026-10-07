import type { ComponentType, SVGProps } from 'react';

export type IconComponent = ComponentType<
  SVGProps<SVGSVGElement> & {
    size?: number | string;
    color?: string;
    strokeWidth?: number | string;
    className?: string;
  }
>;

export interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  muted: string;
  stampActive: string;
  stampInactive: string;
  iconActive: string;
  iconInactive: string;
  button: string;
  buttonText: string;
  border: string;
}

export interface Template {
  id: string;
  name: string;
  isEnabled?: boolean;
  description: string;
  rewardName: string;
  tagline?: string; // Custom instruction text e.g. "Buy 10 get 1 free"
  backgroundImage?: string; // URL for background
  backgroundOpacity?: number; // 0-100
  logoImage?: string; // URL for custom brand logo
  showLogo?: boolean; // Toggle for main logo visibility
  titleSize?: string; // Optional custom font size class for the title
  icon: IconComponent;
  colors: ThemeColors;
  totalStamps: number;
  social?: SocialLinks;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  x?: string;
  youtube?: string;
  website?: string;
}

export type StoredTemplate = Omit<Template, 'icon'> & {
  iconKey: string;
};

export interface Transaction {
  id: string;
  type: 'stamp_add' | 'stamp_remove' | 'redeem' | 'issued' | 'mission_bonus';
  amount: number;
  date: string; // Formatted string for display
  timestamp: number; // For sorting
  title: string;
  remarks?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
}

export interface IssuedCard {
  id: string; // Internal ID
  uniqueId: string; // Public UUID for link
  campaignId: string | null;
  campaignName: string;
  stamps: number;
  lastVisit: string;
  status: 'Active' | 'Redeemed'; // New status field
  completedDate?: string; // Date when redeemed
  history: Transaction[]; // Log of all actions
  templateSnapshot?: StoredTemplate; // Campaign design at issue time
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  mobile?: string;
  status: 'Active' | 'Inactive';
  cards: IssuedCard[];
}

export type LoyaltyMissionType = 'visit_count' | 'card_stamps';

export interface LoyaltyMissionCompletion {
  id?: string;
  completionNumber?: number;
  rewardDescription?: string;
  rewardType?: 'benefit' | 'bonus_stamps' | 'catalog_reward';
  rewardStamps?: number;
  catalogRewardId?: string | null;
  catalogRewardClaimStatus?: 'available' | 'issued' | 'redeemed' | null;
  completedAt?: string;
  redeemedAt?: string | null;
}

export interface LoyaltyMission {
  id: string;
  ownerId?: string;
  campaignId: string | null;
  name: string;
  description: string;
  missionType: LoyaltyMissionType;
  goalCount: number;
  startsAt: string;
  endsAt: string;
  rewardType: 'benefit' | 'bonus_stamps' | 'catalog_reward';
  rewardDescription: string;
  rewardStamps: number;
  catalogRewardId?: string | null;
  catalogRewardName?: string | null;
  maxCompletions: number;
  isActive: boolean;
  completedCount: number;
  redeemedCount: number;
  participantCount?: number;
  progress?: number;
  availableRewards?: number;
  completions?: LoyaltyMissionCompletion[];
}

export interface LoyaltyPointLevel {
  name: string;
  minPoints: number;
  benefit: string;
}

export type LoyaltyPointEntryType = 'visit' | 'visit_reversal' | 'manual_adjustment' | 'reward_redemption' | 'reward_refund';

export interface LoyaltyPointHistoryEntry {
  entryType: LoyaltyPointEntryType;
  pointsDelta: number;
  description: string;
  createdAt: string;
}

export interface LoyaltyBadge {
  badgeKey: 'first_visit' | 'mission_completion';
  earnedAt: string;
}

export interface CustomerLoyaltyPoints {
  isEnabled: boolean;
  balance: number;
  currentLevel: LoyaltyPointLevel | null;
  nextLevel: LoyaltyPointLevel | null;
  pointsToNextLevel: number | null;
  progressPercent: number;
  history: LoyaltyPointHistoryEntry[];
  badges: LoyaltyBadge[];
}

export type LoyaltyRewardStatus = 'issued' | 'redeemed' | 'expired' | 'cancelled';

export interface LoyaltyReward {
  id: string;
  name: string;
  description: string;
  campaignId: string | null;
  pointsCost: number;
  minimumPoints: number;
  startsAt: string;
  endsAt: string;
  stockQuantity: number | null;
  remainingQuantity: number | null;
  activeClaimCount: number;
  redeemedCount: number;
  maxClaimsPerCustomer: number;
  redemptionValidityHours: number;
  isActive: boolean;
}

export type LoyaltyRewardUnavailableReason = 'points_program_disabled' | 'not_enough_points' | 'sold_out' | 'customer_limit';

export interface PublicLoyaltyReward {
  id: string;
  name: string;
  description: string;
  pointsCost: number;
  minimumPoints: number;
  remainingQuantity: number | null;
  customerClaimCount: number;
  maxClaimsPerCustomer: number;
  canClaim: boolean;
  unavailableReason: LoyaltyRewardUnavailableReason | null;
  endsAt: string;
  missionCompletions?: { completionId: string; missionName: string }[];
}

export interface LoyaltyRewardRedemption {
  id: string;
  rewardName: string;
  code: string;
  status: LoyaltyRewardStatus;
  pointsCost: number;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedBy?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  customerName?: string;
  missionName?: string | null;
}

// Internal account state. Email confirmation now comes from Supabase auth.
export type AccountStatus = 'unverified' | 'verified';
export type UserRole = 'owner' | 'staff';
export type AccessStatus = 'active' | 'disabled';
export type SubscriptionTier = 'free' | 'pro';
export type InterfaceLanguage = 'pt-BR' | 'es' | 'en';
export type BusinessCurrency = 'BRL' | 'USD' | 'EUR' | 'MXN' | 'ARS' | 'CLP' | 'COP' | 'PEN' | 'UYU';

export const TIER_LIMITS = {
  free: { campaigns: Infinity, issuedCards: Infinity, staff: Infinity },
  pro: { campaigns: Infinity, issuedCards: Infinity, staff: Infinity },
} as const;

export interface User {
  id: string;
  businessName: string;
  email: string;
  slug?: string;
  role: UserRole;
  ownerId?: string;
  status: AccountStatus;
  access: AccessStatus;
  tier: SubscriptionTier;
  tierExpiresAt?: string;
  createdAt: string;
  interfaceLanguage?: InterfaceLanguage;
  currencyCode?: BusinessCurrency;
}
