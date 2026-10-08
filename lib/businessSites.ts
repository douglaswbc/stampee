import { normalizeSlug } from './slug';

export type BusinessSitePageKind = 'about' | 'contact' | 'privacy' | 'faq' | 'landing';
export type BusinessSiteItemKind = 'product' | 'service';

export interface BusinessSitePage {
  id: string;
  slug: string;
  kind: BusinessSitePageKind;
  title: string;
  body: string;
  metaTitle: string;
  metaDescription: string;
  indexable: boolean;
  showInNavigation: boolean;
  enabled: boolean;
  featuredItemIds: string[];
}

export interface BusinessSiteItem {
  id: string;
  slug: string;
  kind: BusinessSiteItemKind;
  name: string;
  category: string;
  categorySlug: string;
  summary: string;
  description: string;
  imageUrl: string;
  priceLabel: string;
  duration: string;
  areaServed: string;
  ctaLabel: string;
  ctaUrl: string;
  metaTitle: string;
  metaDescription: string;
  indexable: boolean;
  enabled: boolean;
  featured: boolean;
}

export interface BusinessSiteContent {
  version: 1;
  branding: {
    logoUrl: string;
    primaryColor: string;
    accentColor: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    ctaLabel: string;
    ctaUrl: string;
    imageUrl: string;
  };
  about: { title: string; body: string };
  contact: {
    email: string;
    phone: string;
    whatsapp: string;
    address: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
    serviceArea: string;
    openingHours: string;
    googleBusinessUrl: string;
    instagramUrl: string;
    facebookUrl: string;
  };
  seo: { title: string; description: string; indexable: boolean; language: 'pt-BR' | 'es' | 'en' };
  pages: BusinessSitePage[];
  items: BusinessSiteItem[];
}

export interface BusinessSiteRevision {
  revision: number;
  createdAt: string;
}

export interface BusinessSiteDraft {
  businessName: string;
  slug: string;
  draftContent: BusinessSiteContent;
  publishedContent: BusinessSiteContent | null;
  publishedRevision: number;
  publishedAt: string | null;
  updatedAt: string;
  hasUnpublishedChanges: boolean;
  revisions: BusinessSiteRevision[];
}

export interface PublicBusinessSite {
  businessName: string;
  slug: string;
  content: BusinessSiteContent;
  revision: number;
  publishedAt: string;
}

const emptyContact = (): BusinessSiteContent['contact'] => ({
  email: '',
  phone: '',
  whatsapp: '',
  address: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  serviceArea: '',
  openingHours: '',
  googleBusinessUrl: '',
  instagramUrl: '',
  facebookUrl: '',
});

export const createDefaultBusinessSiteContent = (businessName: string): BusinessSiteContent => ({
  version: 1,
  branding: { logoUrl: '', primaryColor: '#1d4ed8', accentColor: '#f59e0b' },
  hero: {
    eyebrow: '',
    title: businessName || 'Sua empresa',
    description: '',
    ctaLabel: 'Fale conosco',
    ctaUrl: '',
    imageUrl: '',
  },
  about: { title: 'Sobre a empresa', body: '' },
  contact: emptyContact(),
  seo: { title: '', description: '', indexable: true, language: 'pt-BR' },
  pages: [
    { id: 'about', slug: 'sobre', kind: 'about', title: 'Sobre', body: '', metaTitle: '', metaDescription: '', indexable: true, showInNavigation: true, enabled: true, featuredItemIds: [] },
    { id: 'contact', slug: 'contato', kind: 'contact', title: 'Contato', body: '', metaTitle: '', metaDescription: '', indexable: true, showInNavigation: true, enabled: true, featuredItemIds: [] },
    { id: 'privacy', slug: 'privacidade', kind: 'privacy', title: 'Privacidade', body: '', metaTitle: '', metaDescription: '', indexable: true, showInNavigation: false, enabled: false, featuredItemIds: [] },
    { id: 'faq', slug: 'perguntas-frequentes', kind: 'faq', title: 'Perguntas frequentes', body: '', metaTitle: '', metaDescription: '', indexable: true, showInNavigation: true, enabled: false, featuredItemIds: [] },
  ],
  items: [],
});

const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asBoolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export const normalizeBusinessSiteContent = (value: unknown, businessName: string): BusinessSiteContent => {
  const defaults = createDefaultBusinessSiteContent(businessName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const branding = raw.branding && typeof raw.branding === 'object' ? raw.branding as Record<string, unknown> : {};
  const hero = raw.hero && typeof raw.hero === 'object' ? raw.hero as Record<string, unknown> : {};
  const about = raw.about && typeof raw.about === 'object' ? raw.about as Record<string, unknown> : {};
  const contact = raw.contact && typeof raw.contact === 'object' ? raw.contact as Record<string, unknown> : {};
  const seo = raw.seo && typeof raw.seo === 'object' ? raw.seo as Record<string, unknown> : {};
  const pages = Array.isArray(raw.pages) ? raw.pages : defaults.pages;
  const items = Array.isArray(raw.items) ? raw.items : [];

  return {
    version: 1,
    branding: {
      logoUrl: asString(branding.logoUrl),
      primaryColor: asString(branding.primaryColor, defaults.branding.primaryColor),
      accentColor: asString(branding.accentColor, defaults.branding.accentColor),
    },
    hero: {
      eyebrow: asString(hero.eyebrow),
      title: asString(hero.title, businessName || defaults.hero.title),
      description: asString(hero.description),
      ctaLabel: asString(hero.ctaLabel, defaults.hero.ctaLabel),
      ctaUrl: asString(hero.ctaUrl),
      imageUrl: asString(hero.imageUrl),
    },
    about: { title: asString(about.title, defaults.about.title), body: asString(about.body) },
    contact: Object.fromEntries(Object.keys(emptyContact()).map(key => [key, asString(contact[key])])) as BusinessSiteContent['contact'],
    seo: {
      title: asString(seo.title),
      description: asString(seo.description),
      indexable: asBoolean(seo.indexable, true),
      language: seo.language === 'es' || seo.language === 'en' ? seo.language : 'pt-BR',
    },
    pages: pages.filter((page): page is Record<string, unknown> => Boolean(page) && typeof page === 'object' && !Array.isArray(page)).map((page, index) => ({
      id: asString(page.id, `page-${index + 1}`),
      slug: asString(page.slug),
      kind: ['about', 'contact', 'privacy', 'faq', 'landing'].includes(asString(page.kind)) ? asString(page.kind) as BusinessSitePageKind : 'landing',
      title: asString(page.title, 'Página'),
      body: asString(page.body),
      metaTitle: asString(page.metaTitle),
      metaDescription: asString(page.metaDescription),
      indexable: asBoolean(page.indexable, true),
      showInNavigation: asBoolean(page.showInNavigation, true),
      enabled: asBoolean(page.enabled, true),
      featuredItemIds: Array.isArray(page.featuredItemIds) ? page.featuredItemIds.filter((id): id is string => typeof id === 'string') : [],
    })),
    items: items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item, index) => ({
      id: asString(item.id, `item-${index + 1}`),
      slug: asString(item.slug),
      kind: item.kind === 'product' ? 'product' : 'service',
      name: asString(item.name),
      category: asString(item.category),
      categorySlug: asString(item.categorySlug, normalizeSlug(asString(item.category))),
      summary: asString(item.summary),
      description: asString(item.description),
      imageUrl: asString(item.imageUrl),
      priceLabel: asString(item.priceLabel),
      duration: asString(item.duration),
      areaServed: asString(item.areaServed),
      ctaLabel: asString(item.ctaLabel),
      ctaUrl: asString(item.ctaUrl),
      metaTitle: asString(item.metaTitle),
      metaDescription: asString(item.metaDescription),
      indexable: asBoolean(item.indexable, true),
      enabled: asBoolean(item.enabled, true),
      featured: asBoolean(item.featured, false),
    })),
  };
};
