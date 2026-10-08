import { supabase } from '../supabase';
import {
  normalizeBusinessSiteContent,
  type BusinessSiteContent,
  type BusinessSiteDraft,
  type BusinessSiteRevision,
  type PublicBusinessSite,
} from '../businessSites';

export type BusinessSiteLeadStatus = 'new' | 'contacted' | 'closed';

export interface BusinessSiteLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  status: BusinessSiteLeadStatus;
  consentedAt: string;
  createdAt: string;
}

type RawSiteDraft = {
  businessName?: unknown;
  slug?: unknown;
  draftContent?: unknown;
  publishedContent?: unknown;
  publishedRevision?: unknown;
  publishedAt?: unknown;
  updatedAt?: unknown;
  hasUnpublishedChanges?: unknown;
  revisions?: unknown;
};

const text = (value: unknown) => typeof value === 'string' ? value : '';

const mapDraft = (value: unknown): BusinessSiteDraft | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as RawSiteDraft;
  const businessName = text(raw.businessName);
  const revisions = Array.isArray(raw.revisions) ? raw.revisions : [];
  return {
    businessName,
    slug: text(raw.slug),
    draftContent: normalizeBusinessSiteContent(raw.draftContent, businessName),
    publishedContent: raw.publishedContent
      ? normalizeBusinessSiteContent(raw.publishedContent, businessName)
      : null,
    publishedRevision: Number(raw.publishedRevision) || 0,
    publishedAt: text(raw.publishedAt) || null,
    updatedAt: text(raw.updatedAt),
    hasUnpublishedChanges: raw.hasUnpublishedChanges === true,
    revisions: revisions.flatMap((revision): BusinessSiteRevision[] => {
      if (!revision || typeof revision !== 'object') return [];
      const item = revision as Record<string, unknown>;
      return [{ revision: Number(item.revision) || 0, createdAt: text(item.createdAt) }];
    }),
  };
};

export async function fetchBusinessSiteDraft(): Promise<{ data: BusinessSiteDraft | null; error?: string }> {
  const { data, error } = await supabase.rpc('get_business_site_draft');
  if (error) return { data: null, error: 'Unable to load the site configuration.' };
  return { data: mapDraft(data) };
}

export async function saveBusinessSiteDraft(content: BusinessSiteContent): Promise<{ data: BusinessSiteDraft | null; error?: string }> {
  const { data, error } = await supabase.rpc('save_business_site_draft', { content_input: content });
  if (error) return { data: null, error: 'Unable to save the site draft. Check the page and directory fields.' };
  return { data: mapDraft(data) };
}

export async function publishBusinessSite(): Promise<{ data: BusinessSiteDraft | null; error?: string }> {
  const { data, error } = await supabase.rpc('publish_business_site');
  if (error) return { data: null, error: error.message || 'Unable to publish the site.' };
  return { data: mapDraft(data) };
}

export async function restoreBusinessSiteRevision(revision: number): Promise<{ data: BusinessSiteDraft | null; error?: string }> {
  const { data, error } = await supabase.rpc('restore_business_site_revision', { revision_input: revision });
  if (error) return { data: null, error: 'Unable to restore this site version.' };
  return { data: mapDraft(data) };
}

export async function fetchPublicBusinessSite(slug: string): Promise<PublicBusinessSite | null> {
  const { data, error } = await supabase.rpc('get_public_business_site', { slug_input: slug });
  if (error || !data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const businessName = text(raw.businessName);
  if (!businessName || !text(raw.slug)) return null;
  return {
    businessName,
    slug: text(raw.slug),
    content: normalizeBusinessSiteContent(raw.content, businessName),
    revision: Number(raw.revision) || 0,
    publishedAt: text(raw.publishedAt),
  };
}

export async function fetchBusinessSiteLeads(): Promise<{ data: BusinessSiteLead[]; error?: string }> {
  const { data, error } = await supabase.rpc('get_business_site_leads');
  if (error || !Array.isArray(data)) return { data: [], error: 'Unable to load site enquiries.' };
  const rows = data as Array<Record<string, unknown>>;
  return {
    data: rows.flatMap((row): BusinessSiteLead[] => {
      const status = row.status;
      if (typeof row.id !== 'string' || !['new', 'contacted', 'closed'].includes(String(status))) return [];
      return [{
        id: row.id,
        name: text(row.name),
        email: text(row.email),
        phone: text(row.phone),
        message: text(row.message),
        status: status as BusinessSiteLeadStatus,
        consentedAt: text(row.consented_at),
        createdAt: text(row.created_at),
      }];
    }),
  };
}

export async function updateBusinessSiteLeadStatus(id: string, status: BusinessSiteLeadStatus): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('update_business_site_lead_status', {
    lead_id_input: id,
    status_input: status,
  });
  return { ok: !error && data === true };
}
