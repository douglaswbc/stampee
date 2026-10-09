import { supabase } from '../supabase';

export interface BusinessSiteDnsRecord {
  host: string;
  type: string;
  value: string;
}

export interface BusinessSiteDomain {
  owner_id: string;
  apex_domain: string;
  primary_domain: string;
  status: 'pending_dns' | 'active';
  dns_records: { apex?: BusinessSiteDnsRecord[]; primary?: BusinessSiteDnsRecord[] };
  verified_at: string | null;
}

type DomainResponse = { domain?: BusinessSiteDomain | null; message?: string; error?: string };

const request = async (method: 'GET' | 'POST', payload?: { action: 'connect' | 'verify' | 'remove'; domain?: string }) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { data: null, error: 'Sign in again to manage this domain.' };
    const response = await fetch('/api/business-site-domains', {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const result = await response.json().catch(() => ({})) as DomainResponse;
    if (!response.ok) return { data: null, error: result.error || 'Could not manage this domain.' };
    return { data: result, error: undefined };
  } catch {
    return { data: null, error: 'Could not reach the domain service. Try again.' };
  }
};

export const fetchBusinessSiteDomain = async () => {
  const result = await request('GET');
  return {
    data: result.data?.domain ?? null,
    error: result.error,
  };
};

export const connectBusinessSiteDomain = async (domain: string) => request('POST', { action: 'connect', domain });
export const verifyBusinessSiteDomain = async () => request('POST', { action: 'verify' });
export const removeBusinessSiteDomain = async () => request('POST', { action: 'remove' });
