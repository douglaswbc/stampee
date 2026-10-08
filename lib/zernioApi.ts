import { supabase } from './supabase';

export interface ZernioProfile {
  id: string;
  name: string;
}

export interface ZernioTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameterCount: number;
  components?: Array<Record<string, unknown>>;
}

export interface ZernioMapping {
  event_type: string;
  template_name: string;
  template_language: string;
  template_status: string;
  template_parameter_count: number;
  enabled: boolean;
  account_id: string;
}

export interface ZernioIntegrationStatus {
  owner_id: string;
  zernio_profile_id?: string | null;
  whatsapp_account_id?: string | null;
  whatsapp_display_name?: string | null;
  instagram_account_id?: string | null;
  instagram_username?: string | null;
  phone_country_code?: string | null;
  hasZernioKey: boolean;
}

export async function callZernioApi<T = Record<string, unknown>>(input: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Sign in again to manage messaging integrations.');
  const response = await fetch('/api/zernio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + data.session.access_token,
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 404 && import.meta.env.DEV) {
      throw new Error('The Vite server does not run Vercel API functions. Restart with npm run dev:vercel.');
    }
    throw new Error(payload.error || 'Could not update communication settings.');
  }
  return payload;
}
