import { supabase } from '../supabase';

export interface PublicCampaignSignupContext {
  owner: {
    id: string;
    slug: string;
    businessName: string;
  };
  campaign: {
    id: string;
    name: string;
    isEnabled: boolean;
  };
  pointsEnabled: boolean;
  welcomePoints: number;
}

export type PublicCampaignSignupOutcome =
  | { outcome: 'issued'; uniqueId: string }
  | { outcome: 'redirect_existing'; uniqueId: string }
  | { outcome: 'campaign_disabled_no_existing' }
  | { outcome: 'error'; error: string };

export async function fetchPublicCampaignSignupContext(
  slug: string,
  campaignId: string
): Promise<PublicCampaignSignupContext | null> {
  const { data, error } = await supabase.rpc('get_public_campaign_signup_context', {
    slug_input: slug,
    campaign_id_input: campaignId,
  });
  if (error || !data || typeof data !== 'object') {
    return null;
  }

  const payload = data as {
    owner?: { id?: string; slug?: string; businessName?: string };
    campaign?: { id?: string; name?: string; isEnabled?: boolean };
    pointsEnabled?: boolean;
    welcomePoints?: number;
  };

  if (!payload.owner?.id || !payload.owner.slug || !payload.campaign?.id || !payload.campaign.name) {
    return null;
  }

  return {
    owner: {
      id: payload.owner.id,
      slug: payload.owner.slug,
      businessName: payload.owner.businessName ?? '',
    },
    campaign: {
      id: payload.campaign.id,
      name: payload.campaign.name,
      isEnabled: payload.campaign.isEnabled !== false,
    },
    pointsEnabled: payload.pointsEnabled === true,
    welcomePoints: Number(payload.welcomePoints) || 0,
  };
}

export async function fetchPublicReferralCode(slug: string, cardUniqueId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_public_referral_link', {
    slug_input: slug,
    card_unique_id: cardUniqueId,
  });
  if (error || !data || typeof data !== 'object') return null;
  const code = (data as { referralCode?: unknown }).referralCode;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

export async function revokePublicWhatsAppNotificationConsent(slug: string, cardUniqueId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('revoke_public_whatsapp_notification_consent', {
    slug_input: slug,
    card_unique_id: cardUniqueId,
  });
  return !error && data === true;
}

export async function registerPublicCampaignSignup(input: {
  slug: string;
  campaignId: string;
  name: string;
  email?: string;
  mobile?: string;
  referralCode?: string;
  whatsappOptIn?: boolean;
}): Promise<PublicCampaignSignupOutcome> {
  const { data, error } = await supabase.rpc('register_public_campaign_signup_with_consent', {
    slug_input: input.slug,
    campaign_id_input: input.campaignId,
    customer_name_input: input.name,
    customer_email_input: input.email ?? '',
    customer_mobile_input: input.mobile ?? '',
    referral_code_input: input.referralCode ?? '',
    whatsapp_opt_in_input: input.whatsappOptIn === true,
  });

  if (error || !data || typeof data !== 'object') {
    return { outcome: 'error', error: 'Unable to complete signup right now. Please try again.' };
  }

  const payload = data as { outcome?: string; uniqueId?: string; error?: string };
  if ((payload.outcome === 'issued' || payload.outcome === 'redirect_existing') && payload.uniqueId) {
    return {
      outcome: payload.outcome,
      uniqueId: payload.uniqueId,
    };
  }
  if (payload.outcome === 'campaign_disabled_no_existing') {
    return { outcome: 'campaign_disabled_no_existing' };
  }
  if (payload.error) {
    return { outcome: 'error', error: payload.error };
  }

  return { outcome: 'error', error: 'Unable to complete signup right now. Please try again.' };
}
