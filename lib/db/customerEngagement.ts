import { supabase } from '../supabase';

export type EngagementReminderType = 'return_reminder' | 'mission_reminder' | 'reward_expiring';
export type EngagementChannel = 'push' | 'whatsapp';

export interface CompanyEngagementSettings {
  enabled: boolean;
  returnEnabled: boolean;
  missionEnabled: boolean;
  rewardExpiringEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
  channelPriority: 'push_first' | 'whatsapp_first';
  returnAfterDays: number;
  repeatIntervalDays: number;
  maxRemindersPerCampaign: number;
  rewardExpiryDays: number;
  maxPerCustomerPer7d: number;
  minGapHours: number;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  timeZone: string;
}

export interface EngagementPushTemplate {
  eventType: EngagementReminderType;
  title: string;
  body: string;
}

export interface CompanyEngagementConfiguration {
  settings: CompanyEngagementSettings;
  campaignIds: string[];
  campaigns: Array<{ id: string; name: string }>;
  pushTemplates: EngagementPushTemplate[];
  activity: { whatsappSent30d: number; pushAccepted30d: number; failedAttempts30d: number; pending: number };
}

export interface CustomerEngagementHistoryItem {
  id: string;
  ownerId: string;
  businessName: string;
  eventType: EngagementReminderType;
  campaignName: string | null;
  messageTitle: string | null;
  messageBody: string | null;
  channel: EngagementChannel;
  submittedAt: string;
}

export async function getCompanyEngagementConfiguration(): Promise<CompanyEngagementConfiguration | null> {
  const { data, error } = await supabase.rpc('get_company_engagement_configuration');
  if (error || !data || typeof data !== 'object') return null;
  return data as CompanyEngagementConfiguration;
}

export async function saveCompanyEngagementConfiguration(
  settings: Omit<CompanyEngagementSettings, 'timeZone'>,
  campaignIds: string[],
  pushTemplates: EngagementPushTemplate[],
): Promise<boolean> {
  const { data, error } = await supabase.rpc('save_company_engagement_configuration', {
    settings_input: settings,
    campaign_ids_input: campaignIds,
    push_templates_input: pushTemplates.map(template => ({
      event_type: template.eventType,
      title: template.title,
      body: template.body,
    })),
  });
  return !error && data === true;
}

export async function getPublicCustomerEngagementPreferences(slug: string, cardUniqueId: string) {
  const { data, error } = await supabase.rpc('get_public_customer_engagement_preferences', {
    slug_input: slug,
    card_unique_id_input: cardUniqueId,
  });
  if (error || !data || typeof data !== 'object') return null;
  return data as { whatsappEnabled: boolean; pushEnabled: boolean; hasMobile: boolean; hasPushSubscription: boolean };
}

export async function setPublicCustomerEngagementPreference(
  slug: string,
  cardUniqueId: string,
  channel: EngagementChannel,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_public_customer_engagement_preference', {
    slug_input: slug,
    card_unique_id_input: cardUniqueId,
    channel_input: channel,
    enabled_input: enabled,
  });
  return !error && data === true;
}

export async function setCustomerPortalEngagementPreference(
  ownerId: string,
  customerId: string,
  channel: EngagementChannel,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_customer_portal_engagement_preference', {
    owner_id_input: ownerId,
    customer_id_input: customerId,
    channel_input: channel,
    enabled_input: enabled,
  });
  return !error && data === true;
}

export async function getCustomerPortalEngagementHistory(): Promise<CustomerEngagementHistoryItem[]> {
  const { data, error } = await supabase.rpc('get_customer_portal_engagement_history');
  if (error || !Array.isArray(data)) return [];
  return data as CustomerEngagementHistoryItem[];
}
