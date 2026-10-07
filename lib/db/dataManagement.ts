import { supabase } from '../supabase';

export async function resetOwnerBusinessData(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('reset_owner_business_data');
  if (error) return { ok: false, error: error.message };
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).success !== true) {
    return { ok: false, error: 'The reset could not be completed.' };
  }
  return { ok: true };
}
