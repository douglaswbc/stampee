import { supabase } from '../supabase';

export interface BrowserPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: string | null;
}

export async function isPublicCustomerPushEnabled(slug: string, cardUniqueId: string, endpoint: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_public_customer_push_subscription_status', {
    slug_input: slug,
    card_unique_id_input: cardUniqueId,
    endpoint_input: endpoint,
  });
  return !error && data === true;
}

export async function registerPublicCustomerPushSubscription(
  slug: string,
  cardUniqueId: string,
  subscription: BrowserPushSubscription,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('register_public_customer_push_subscription', {
    slug_input: slug,
    card_unique_id_input: cardUniqueId,
    endpoint_input: subscription.endpoint,
    p256dh_input: subscription.p256dh,
    auth_input: subscription.auth,
    expiration_time_input: subscription.expirationTime,
  });
  return !error && !!data && typeof data === 'object' && (data as { ok?: unknown }).ok === true;
}

export async function revokePublicCustomerPushSubscription(
  slug: string,
  cardUniqueId: string,
  endpoint: string,
): Promise<{ ok: boolean; unsubscribeBrowser: boolean }> {
  const { data, error } = await supabase.rpc('revoke_public_customer_push_subscription', {
    slug_input: slug,
    card_unique_id_input: cardUniqueId,
    endpoint_input: endpoint,
  });
  if (error || !data || typeof data !== 'object') return { ok: false, unsubscribeBrowser: false };
  const result = data as { ok?: unknown; unsubscribeBrowser?: unknown };
  return {
    ok: result.ok === true,
    unsubscribeBrowser: result.unsubscribeBrowser === true,
  };
}
