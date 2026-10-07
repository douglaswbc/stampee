import { supabase } from '../supabase';
import type { IssuedCard, Transaction, StoredTemplate } from '../../types';

export type ScannedCardStatus = 'owned' | 'foreign' | 'missing';

export interface PublicScanEntryContext {
  owner: {
    id: string;
    slug: string;
    businessName: string;
  };
  card: {
    uniqueId: string;
  };
}

export async function insertIssuedCard(
  card: {
    id: string;
    uniqueId: string;
    customerId: string;
    campaignId: string;
    campaignName: string;
    templateSnapshot?: StoredTemplate;
  },
  ownerId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('issued_cards').insert({
    id: card.id,
    unique_id: card.uniqueId,
    customer_id: card.customerId,
    campaign_id: card.campaignId,
    owner_id: ownerId,
    campaign_name: card.campaignName,
    stamps: 0,
    last_visit: new Date().toISOString().split('T')[0],
    status: 'Active',
    template_snapshot: card.templateSnapshot ?? null,
  });
  if (error) {
    if (error.message.includes('CAMPAIGN_DISABLED')) {
      return { ok: false, error: 'This campaign is disabled and cannot issue new cards.' };
    }
    return { ok: false, error: 'Unable to issue this card right now. Please try again.' };
  }
  return { ok: true };
}

export async function deleteIssuedCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('issued_cards')
    .delete()
    .eq('id', cardId);
  if (error) return { ok: false, error: 'Unable to revoke this card right now. Please try again.' };
  return { ok: true };
}

export async function insertTransaction(
  cardId: string,
  tx: Transaction
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('record_card_action', {
    card_id_input: cardId,
    transaction_id_input: tx.id,
    action_input: tx.type,
    remarks_input: tx.remarks ?? null,
  });
  if (error) return { ok: false, error: error.message || 'Unable to save this activity right now. Please try again.' };
  return { ok: true };
}

export interface CardActionResult {
  card: Pick<IssuedCard, 'stamps' | 'status' | 'completedDate' | 'lastVisit'>;
  transaction: Transaction;
}

export async function recordCardAction(
  cardId: string,
  tx: Transaction
): Promise<{ ok: true; data: CardActionResult } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('record_card_action', {
    card_id_input: cardId,
    transaction_id_input: tx.id,
    action_input: tx.type,
    remarks_input: tx.remarks ?? null,
  });
  if (error || !data || typeof data !== 'object') {
    return { ok: false, error: error?.message || 'Unable to save this activity right now. Please try again.' };
  }

  const result = data as {
    success?: boolean;
    card?: { stamps?: number; status?: IssuedCard['status']; completedDate?: string | null; lastVisit?: string };
    transaction?: {
      id?: string; type?: Transaction['type']; amount?: number; date?: string; timestamp?: number;
      title?: string; remarks?: string | null; actorId?: string | null; actorName?: string | null;
      actorRole?: Transaction['actorRole'] | null;
    };
  };
  if (!result.success || !result.card || !result.transaction?.id || !result.transaction.type) {
    return { ok: false, error: 'The server did not confirm this card activity.' };
  }

  return {
    ok: true,
    data: {
      card: {
        stamps: result.card.stamps ?? 0,
        status: result.card.status ?? 'Active',
        completedDate: result.card.completedDate ?? undefined,
        lastVisit: result.card.lastVisit ?? '',
      },
      transaction: {
        id: result.transaction.id,
        type: result.transaction.type,
        amount: result.transaction.amount ?? 0,
        date: result.transaction.date ?? '',
        timestamp: result.transaction.timestamp ?? Date.now(),
        title: result.transaction.title ?? '',
        remarks: result.transaction.remarks ?? undefined,
        actorId: result.transaction.actorId ?? undefined,
        actorName: result.transaction.actorName ?? undefined,
        actorRole: result.transaction.actorRole ?? undefined,
      },
    },
  };
}

export async function countIssuedCards(ownerId: string): Promise<number> {
  const { count, error } = await supabase
    .from('issued_cards')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', ownerId);
  if (error) return 0;
  return count ?? 0;
}

export async function inspectScannedCard(uniqueId: string): Promise<{ status: ScannedCardStatus; error?: string }> {
  const { data, error } = await supabase.rpc('inspect_scanned_card', {
    card_unique_id: uniqueId,
  });
  if (error) {
    return { status: 'missing', error: 'Unable to validate this card right now. Please try again.' };
  }

  const status = typeof data === 'object' && data && 'status' in data
    ? (data as { status?: string }).status
    : undefined;

  if (status === 'owned' || status === 'foreign' || status === 'missing') {
    return { status };
  }

  return { status: 'missing' };
}

export async function fetchPublicScanEntryContext(
  slug: string,
  uniqueId: string
): Promise<PublicScanEntryContext | null> {
  const { data, error } = await supabase.rpc('get_scan_entry_context', {
    slug_input: slug,
    card_unique_id: uniqueId,
  });
  if (error || !data || typeof data !== 'object') {
    return null;
  }

  const payload = data as {
    owner?: { id?: string; slug?: string; businessName?: string };
    card?: { uniqueId?: string };
  };

  if (!payload.owner?.id || !payload.owner.slug || !payload.card?.uniqueId) {
    return null;
  }

  return {
    owner: {
      id: payload.owner.id,
      slug: payload.owner.slug,
      businessName: payload.owner.businessName ?? '',
    },
    card: {
      uniqueId: payload.card.uniqueId,
    },
  };
}
