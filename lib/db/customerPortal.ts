import { supabase } from '../supabase';

export interface CustomerPortalCard {
  uniqueId: string;
  campaignName: string;
  stamps: number;
  totalStamps: number | null;
  status: 'Active' | 'Redeemed';
  lastVisit: string;
  completedDate: string | null;
  createdAt: string;
}

export interface CustomerPortalBusiness {
  ownerId: string;
  businessName: string;
  slug: string;
  customerId: string;
  customerName: string;
  hasMobile: boolean;
  whatsappLoyaltyEnabled: boolean;
  cards: CustomerPortalCard[];
  pointsBalance: number;
  pointsHistory: Array<{ delta: number; description: string; createdAt: string }>;
  activeMissions: Array<{
    id: string;
    name: string;
    description: string;
    missionType: 'visit_count' | 'card_stamps';
    progress: number;
    goalCount: number;
    rewardDescription: string;
    endsAt: string;
  }>;
  missions: Array<{ name: string; rewardDescription: string; completedAt: string; redeemedAt: string | null }>;
  rewards: Array<{
    name: string;
    description: string;
    code: string;
    status: 'issued' | 'redeemed' | 'expired' | 'cancelled';
    issuedAt: string;
    expiresAt: string;
    redeemedAt: string | null;
  }>;
}

export interface CustomerPortalData {
  email: string;
  businesses: CustomerPortalBusiness[];
}

export async function initializeCustomerPortal(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('ensure_customer_portal_account');
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchCustomerPortalData(): Promise<CustomerPortalData | null> {
  const { data, error } = await supabase.rpc('get_customer_portal_data');
  if (error || !data || typeof data !== 'object') return null;
  const payload = data as Partial<CustomerPortalData>;
  if (typeof payload.email !== 'string' || !Array.isArray(payload.businesses)) return null;
  return payload as CustomerPortalData;
}

export async function claimCustomerPortalRecordsByEmail(): Promise<number | null> {
  const { data, error } = await supabase.rpc('claim_customer_portal_records_by_email');
  if (error || !data || typeof data !== 'object') return null;
  const linkedCount = (data as { linkedCount?: unknown }).linkedCount;
  return typeof linkedCount === 'number' ? linkedCount : null;
}

export async function claimCustomerPortalCard(slug: string, uniqueId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_customer_portal_card', {
    slug_input: slug,
    card_unique_id_input: uniqueId,
  });
  return !error && !!data && typeof data === 'object' && (data as { ok?: unknown }).ok === true;
}

export async function setCustomerPortalWhatsAppPreference(
  ownerId: string,
  customerId: string,
  enabled: boolean
): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_customer_portal_whatsapp_preference', {
    owner_id_input: ownerId,
    customer_id_input: customerId,
    enabled_input: enabled,
  });
  return !error && data === true;
}

export async function unlinkCustomerPortalBusiness(ownerId: string, customerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('unlink_customer_portal_business', {
    owner_id_input: ownerId,
    customer_id_input: customerId,
  });
  return !error && data === true;
}
