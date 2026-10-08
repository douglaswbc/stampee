import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Eye, Globe2, History, Plus, Save, Send, Trash2, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from './LocaleProvider';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  type BusinessSiteContent,
  type BusinessSiteItem,
  type BusinessSitePage,
} from '../lib/businessSites';
import { normalizeSlug } from '../lib/slug';
import {
  fetchBusinessSiteDraft,
  publishBusinessSite,
  restoreBusinessSiteRevision,
  saveBusinessSiteDraft,
} from '../lib/db/businessSites';

type Section = 'overview' | 'pages' | 'catalog' | 'seo' | 'history';
type ObjectSection = 'branding' | 'hero' | 'about' | 'contact' | 'seo';

const sections: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Site content' },
  { id: 'pages', label: 'Pages' },
  { id: 'catalog', label: 'Products and services' },
  { id: 'seo', label: 'SEO and local presence' },
  { id: 'history', label: 'Publication history' },
];

const InputField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
}> = ({ label, value, onChange, placeholder, type = 'text', required, readOnly }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} readOnly={readOnly} />
  </div>
);

const TextAreaField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}> = ({ label, value, onChange, placeholder, rows = 4 }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="flex w-full resize-y rounded-md border border-input bg-background px-3.5 py-2.5 text-sm text-foreground shadow-subtle outline-none transition focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/25"
    />
  </div>
);

const ToggleField: React.FC<{
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />
    <span>{label}</span>
  </label>
);

const emptyNewItem = (): Omit<BusinessSiteItem, 'id'> => ({
  slug: '', kind: 'service', name: '', category: '', categorySlug: '', summary: '', description: '', imageUrl: '',
  priceLabel: '', duration: '', areaServed: '', ctaLabel: '', ctaUrl: '', metaTitle: '',
  metaDescription: '', indexable: true, enabled: true, featured: false,
});

export const BusinessSiteAdminPage: React.FC = () => {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>('overview');
  const [site, setSite] = useState<Awaited<ReturnType<typeof fetchBusinessSiteDraft>>['data']>(null);
  const [draft, setDraft] = useState<BusinessSiteContent | null>(null);
  const [newItem, setNewItem] = useState(emptyNewItem);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [postalCodeLookupStatus, setPostalCodeLookupStatus] = useState<'idle' | 'loading' | 'success' | 'not-found' | 'error'>('idle');
  const postalCodeLookupRequestId = useRef(0);
  const postalCodeLookupController = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchBusinessSiteDraft().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.error || !result.data) {
        setError(result.error ?? 'Unable to load the site configuration.');
        return;
      }
      setSite(result.data);
      setDraft(result.data.draftContent);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    postalCodeLookupController.current?.abort();
  }, []);

  const hasChanges = useMemo(() => Boolean(site && draft && JSON.stringify(site.draftContent) !== JSON.stringify(draft)), [site, draft]);
  const publicUrl = site?.slug ? `${window.location.origin}/empresa/${site.slug}` : '';

  const setObjectField = <K extends ObjectSection>(key: K, field: keyof BusinessSiteContent[K], value: unknown) => {
    setDraft((current) => current ? ({
      ...current,
      [key]: { ...current[key], [field]: value },
    } as BusinessSiteContent) : current);
  };

  const updatePage = (id: string, changes: Partial<BusinessSitePage>) => {
    setDraft((current) => current ? ({
      ...current,
      pages: current.pages.map((page) => page.id === id ? { ...page, ...changes } : page),
    }) : current);
  };

  const handlePostalCodeChange = (value: string) => {
    const postalCode = value.replace(/\D/g, '').slice(0, 8);
    setObjectField('contact', 'postalCode', postalCode);

    postalCodeLookupRequestId.current += 1;
    const requestId = postalCodeLookupRequestId.current;
    postalCodeLookupController.current?.abort();
    postalCodeLookupController.current = null;

    if (postalCode.length !== 8) {
      setPostalCodeLookupStatus('idle');
      return;
    }

    const controller = new AbortController();
    postalCodeLookupController.current = controller;
    setPostalCodeLookupStatus('loading');

    void (async () => {
      try {
        const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, { signal: controller.signal });
        if (!response.ok) throw new Error('Postal code lookup failed.');
        const result = await response.json() as {
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
          erro?: boolean;
        };

        if (requestId !== postalCodeLookupRequestId.current) return;
        if (result.erro) {
          setPostalCodeLookupStatus('not-found');
          return;
        }

        const address = [result.logradouro, result.bairro].filter(Boolean).join(', ');
        setDraft((current) => current ? ({
          ...current,
          contact: {
            ...current.contact,
            address: address || current.contact.address,
            city: result.localidade || current.contact.city,
            region: result.uf || current.contact.region,
            country: result.uf ? 'Brasil' : current.contact.country,
          },
        }) : current);
        setPostalCodeLookupStatus('success');
      } catch {
        if (requestId !== postalCodeLookupRequestId.current || controller.signal.aborted) return;
        setPostalCodeLookupStatus('error');
      }
    })();
  };

  const updateItem = (id: string, changes: Partial<BusinessSiteItem>) => {
    setDraft((current) => current ? ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...changes } : item),
    }) : current);
  };

  const persistDraft = async () => {
    if (!draft) return false;
    setBusy(true);
    setError('');
    setMessage('');
    const result = await saveBusinessSiteDraft(draft);
    setBusy(false);
    if (result.error || !result.data) {
      setError(t(result.error ?? 'Unable to save the site draft. Check the page and directory fields.'));
      return false;
    }
    setSite(result.data);
    setDraft(result.data.draftContent);
    setMessage(t('Draft saved.'));
    return true;
  };

  const handlePublish = async () => {
    if (hasChanges && !(await persistDraft())) return;
    setBusy(true);
    setError('');
    setMessage('');
    const result = await publishBusinessSite();
    setBusy(false);
    if (result.error || !result.data) {
      setError(t(result.error ?? 'Unable to publish the site.'));
      return;
    }
    setSite(result.data);
    setDraft(result.data.draftContent);
    setMessage(t('Site published.'));
  };

  const handlePreview = async () => {
    if (hasChanges && !(await persistDraft())) return;
    navigate('/site/preview');
  };

  const handleRestore = async (revision: number) => {
    if (!window.confirm(t('Restore this version and publish it as a new revision?'))) return;
    setBusy(true);
    setError('');
    const result = await restoreBusinessSiteRevision(revision);
    setBusy(false);
    if (result.error || !result.data) {
      setError(t(result.error ?? 'Unable to restore this site version.'));
      return;
    }
    setSite(result.data);
    setDraft(result.data.draftContent);
    setMessage(t('Version restored and published.'));
  };

  const handleAddPage = () => {
    if (!draft) return;
    const page: BusinessSitePage = {
      id: crypto.randomUUID(),
      slug: `pagina-${draft.pages.length + 1}`,
      kind: 'landing',
      title: t('New landing page'),
      body: '',
      metaTitle: '',
      metaDescription: '',
      indexable: true,
      showInNavigation: true,
      enabled: true,
      featuredItemIds: [],
    };
    setDraft({ ...draft, pages: [...draft.pages, page] });
  };

  const handleAddItem = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !newItem.name.trim()) return;
    const slug = normalizeSlug(newItem.slug || newItem.name);
    if (!slug || draft.items.some((item) => item.slug === slug)) {
      setError(t('Choose a unique product or service URL.'));
      return;
    }
    const item: BusinessSiteItem = { ...newItem, id: crypto.randomUUID(), slug };
    setDraft({ ...draft, items: [...draft.items, item] });
    setNewItem(emptyNewItem());
    setError('');
  };

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">{t('Loading site...')}</div>;
  }

  if (!draft || !site) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <h1 className="text-2xl font-bold">{t('Business site')}</h1>
        <p className="text-sm text-destructive">{error || t('Unable to load the site configuration.')}</p>
        <p className="text-sm text-muted-foreground">{t('The site tools will be available after the business site database patch is applied.')}</p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-5 overflow-y-auto bg-gray-50/50 p-3 pb-10 sm:p-5 md:p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"><Globe2 className="h-4 w-4" />{t('Website')}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('Business site')}</h1>
          <p className="text-sm text-muted-foreground">{t('Build your public site, pages, and product or service directory.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void handlePreview()} disabled={busy}>
            <Eye className="mr-2 h-4 w-4" />{t('Preview')}
          </Button>
          {site.publishedAt && publicUrl && (
            <Button asChild type="button" variant="outline">
              <a href={publicUrl} target="_blank" rel="noreferrer"><ArrowUpRight className="mr-2 h-4 w-4" />{t('Open live site')}</a>
            </Button>
          )}
          <Button type="button" onClick={() => void persistDraft()} disabled={busy || !hasChanges}>
            <Save className="mr-2 h-4 w-4" />{busy ? t('Saving...') : t('Save draft')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void handlePublish()} disabled={busy || Boolean(site.publishedAt && !hasChanges && !site.hasUnpublishedChanges)}>
            <Send className="mr-2 h-4 w-4" />{busy ? t('Publishing...') : t('Publish')}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{site.businessName}</span>
              <Badge variant={site.publishedAt ? 'default' : 'secondary'}>{site.publishedAt ? t('Published') : t('Draft')}</Badge>
              {site.hasUnpublishedChanges && <Badge variant="outline">{t('Unpublished changes')}</Badge>}
            </div>
            <p className="break-all text-sm text-muted-foreground">{publicUrl || `${window.location.origin}/empresa/${site.slug}`}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {site.publishedAt ? `${t('Last published')}: ${new Date(site.publishedAt).toLocaleString()}` : t('This site is not public until you publish it.')}
          </p>
        </CardContent>
      </Card>

      {error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
      {message && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('Website sections')}>
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${section === item.id ? 'bg-primary text-primary-foreground shadow-subtle' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >{t(item.label)}</button>
        ))}
      </div>

      {section === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card><CardContent className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold">{t('Homepage')}</h2><p className="text-sm text-muted-foreground">{t('Set the first message visitors see.')}</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField label={t('Eyebrow')} value={draft.hero.eyebrow} onChange={(value) => setObjectField('hero', 'eyebrow', value)} />
              <InputField label={t('Main button label')} value={draft.hero.ctaLabel} onChange={(value) => setObjectField('hero', 'ctaLabel', value)} />
            </div>
            <InputField label={t('Homepage title')} value={draft.hero.title} onChange={(value) => setObjectField('hero', 'title', value)} />
            <TextAreaField label={t('Homepage introduction')} value={draft.hero.description} onChange={(value) => setObjectField('hero', 'description', value)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField label={t('Button link')} value={draft.hero.ctaUrl} onChange={(value) => setObjectField('hero', 'ctaUrl', value)} placeholder="https:// or /empresa/..." />
              <InputField label={t('Cover image URL')} value={draft.hero.imageUrl} onChange={(value) => setObjectField('hero', 'imageUrl', value)} placeholder="https://..." />
            </div>
          </CardContent></Card>

          <Card><CardContent className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold">{t('Brand and about')}</h2><p className="text-sm text-muted-foreground">{t('Use your business identity and a real description.')}</p></div>
            <InputField label={t('Logo URL')} value={draft.branding.logoUrl} onChange={(value) => setObjectField('branding', 'logoUrl', value)} placeholder="https://..." />
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField label={t('Primary color')} type="color" value={draft.branding.primaryColor} onChange={(value) => setObjectField('branding', 'primaryColor', value)} />
              <InputField label={t('Accent color')} type="color" value={draft.branding.accentColor} onChange={(value) => setObjectField('branding', 'accentColor', value)} />
            </div>
            <InputField label={t('About title')} value={draft.about.title} onChange={(value) => setObjectField('about', 'title', value)} />
            <TextAreaField label={t('About your business')} value={draft.about.body} onChange={(value) => setObjectField('about', 'body', value)} />
          </CardContent></Card>

          <Card className="xl:col-span-2"><CardContent className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold">{t('Contact and local details')}</h2><p className="text-sm text-muted-foreground">{t('Show only information your business has confirmed.')}</p></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ['email', 'Contact email', 'email'], ['phone', 'Phone', 'tel'], ['whatsapp', 'WhatsApp number', 'tel'],
                ['address', 'Street address', 'text'], ['city', 'City', 'text'], ['region', 'State or region', 'text'],
                ['postalCode', 'Postal code', 'text'], ['country', 'Country', 'text'], ['serviceArea', 'Service area', 'text'],
                ['openingHours', 'Opening hours', 'text'], ['googleBusinessUrl', 'Google Business Profile URL', 'url'],
                ['instagramUrl', 'Instagram URL', 'url'], ['facebookUrl', 'Facebook URL', 'url'],
              ] as const).map(([key, label, type]) => (
                key === 'postalCode' ? (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor="business-site-postal-code">{t(label)}</Label>
                    <Input
                      id="business-site-postal-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      maxLength={8}
                      value={draft.contact.postalCode.replace(/\D/g, '').slice(0, 8)}
                      onChange={(event) => handlePostalCodeChange(event.target.value)}
                      placeholder="00000000"
                      aria-describedby="business-site-postal-code-status"
                    />
                    <p id="business-site-postal-code-status" role="status" className={`text-xs ${postalCodeLookupStatus === 'success' ? 'text-emerald-700' : postalCodeLookupStatus === 'not-found' || postalCodeLookupStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {postalCodeLookupStatus === 'loading' ? t('Looking up address...')
                        : postalCodeLookupStatus === 'success' ? t('Address filled from postal code.')
                          : postalCodeLookupStatus === 'not-found' ? t('Postal code not found.')
                            : postalCodeLookupStatus === 'error' ? t('Unable to search this postal code. Try again.')
                              : t('Enter an 8-digit postal code to look up the address.')}
                    </p>
                  </div>
                ) : (
                  <InputField key={key} label={t(label)} type={type} value={draft.contact[key]} onChange={(value) => setObjectField('contact', key, value)} />
                )
              ))}
            </div>
          </CardContent></Card>
        </div>
      )}

      {section === 'pages' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-xl font-semibold">{t('Pages and landing pages')}</h2><p className="text-sm text-muted-foreground">{t('Each enabled page gets its own shareable URL.')}</p></div>
            <Button type="button" variant="outline" onClick={handleAddPage}><Plus className="mr-2 h-4 w-4" />{t('Add landing page')}</Button>
          </div>
          {draft.pages.map((page) => (
            <Card key={page.id}><CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><InputField label={t('Page title')} value={page.title} onChange={(value) => updatePage(page.id, { title: value })} /></div>
                <div className="flex gap-2 pt-5">
                  {page.kind === 'landing' && <Button type="button" size="icon" variant="ghost" aria-label={t('Delete page')} onClick={() => setDraft({ ...draft, pages: draft.pages.filter((item) => item.id !== page.id) })}><Trash2 className="h-4 w-4" /></Button>}
                  <Badge variant="outline">{t(page.kind === 'landing' ? 'Landing page' : page.kind === 'faq' ? 'FAQ' : page.kind === 'privacy' ? 'Privacy page' : page.kind === 'contact' ? 'Contact page' : 'About page')}</Badge>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <InputField label={t('URL slug')} value={page.slug} onChange={(value) => updatePage(page.id, { slug: normalizeSlug(value) })} />
                <InputField label={t('SEO title')} value={page.metaTitle} onChange={(value) => updatePage(page.id, { metaTitle: value })} />
              </div>
              <InputField label={t('SEO description')} value={page.metaDescription} onChange={(value) => updatePage(page.id, { metaDescription: value })} />
              {page.kind !== 'contact' && <TextAreaField label={t('Page content')} value={page.body} onChange={(value) => updatePage(page.id, { body: value })} rows={5} />}
              {page.kind === 'landing' && draft.items.length > 0 && (
                <div className="space-y-2">
                  <Label>{t('Featured products and services')}</Label>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {draft.items.map((item) => (
                      <ToggleField key={item.id} label={item.name} checked={page.featuredItemIds.includes(item.id)} onChange={(checked) => updatePage(page.id, { featuredItemIds: checked ? [...page.featuredItemIds, item.id] : page.featuredItemIds.filter((id) => id !== item.id) })} />
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleField label={t('Show in navigation')} checked={page.showInNavigation} onChange={(value) => updatePage(page.id, { showInNavigation: value })} />
                <ToggleField label={t('Index this page')} checked={page.indexable} onChange={(value) => updatePage(page.id, { indexable: value })} />
                <ToggleField label={t('Page is published')} checked={page.enabled} onChange={(value) => updatePage(page.id, { enabled: value })} />
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {section === 'catalog' && (
        <div className="space-y-5">
          <div><h2 className="text-xl font-semibold">{t('Products and services')}</h2><p className="text-sm text-muted-foreground">{t('This public directory is separate from loyalty rewards and does not take payments.')}</p></div>
          <Card><CardContent className="space-y-4 p-4 sm:p-6">
            <h3 className="font-semibold">{t('Add a product or service')}</h3>
            <form className="space-y-4" onSubmit={handleAddItem}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5"><Label>{t('Item type')}</Label><select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={newItem.kind} onChange={(event) => setNewItem({ ...newItem, kind: event.target.value as BusinessSiteItem['kind'] })}><option value="service">{t('Service')}</option><option value="product">{t('Product')}</option></select></div>
                <InputField label={t('Name')} value={newItem.name} onChange={(value) => setNewItem({ ...newItem, name: value, slug: normalizeSlug(value) })} required />
                <InputField label={t('Category')} value={newItem.category} onChange={(value) => setNewItem({ ...newItem, category: value, categorySlug: normalizeSlug(value) })} />
                <InputField label={t('URL slug')} value={newItem.slug} onChange={(value) => setNewItem({ ...newItem, slug: normalizeSlug(value) })} />
                <InputField label={t('Price or price range (optional)')} value={newItem.priceLabel} onChange={(value) => setNewItem({ ...newItem, priceLabel: value })} />
                <InputField label={t('Duration (optional)')} value={newItem.duration} onChange={(value) => setNewItem({ ...newItem, duration: value })} />
                <InputField label={t('Image URL')} value={newItem.imageUrl} onChange={(value) => setNewItem({ ...newItem, imageUrl: value })} placeholder="https://..." />
                <InputField label={t('Area served')} value={newItem.areaServed} onChange={(value) => setNewItem({ ...newItem, areaServed: value })} />
                <InputField label={t('Button link')} value={newItem.ctaUrl} onChange={(value) => setNewItem({ ...newItem, ctaUrl: value })} placeholder="https:// or tel:" />
              </div>
              <InputField label={t('Short summary')} value={newItem.summary} onChange={(value) => setNewItem({ ...newItem, summary: value })} />
              <TextAreaField label={t('Description')} value={newItem.description} onChange={(value) => setNewItem({ ...newItem, description: value })} />
              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleField label={t('Show in the public directory')} checked={newItem.enabled} onChange={(value) => setNewItem({ ...newItem, enabled: value })} />
                <ToggleField label={t('Feature on the homepage')} checked={newItem.featured} onChange={(value) => setNewItem({ ...newItem, featured: value })} />
                <ToggleField label={t('Index this item')} checked={newItem.indexable} onChange={(value) => setNewItem({ ...newItem, indexable: value })} />
              </div>
              <Button type="submit"><Plus className="mr-2 h-4 w-4" />{t('Add to directory')}</Button>
            </form>
          </CardContent></Card>

          {draft.items.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t('No products or services yet.')}</CardContent></Card>
          ) : draft.items.map((item) => (
            <Card key={item.id}><CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2"><h3 className="truncate font-semibold">{item.name}</h3><Badge variant="outline">{t(item.kind === 'service' ? 'Service' : 'Product')}</Badge></div>
                <Button type="button" variant="ghost" size="icon" aria-label={t('Delete item')} onClick={() => setDraft({ ...draft, items: draft.items.filter((entry) => entry.id !== item.id), pages: draft.pages.map((page) => ({ ...page, featuredItemIds: page.featuredItemIds.filter((id) => id !== item.id) })) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InputField label={t('Name')} value={item.name} onChange={(value) => updateItem(item.id, { name: value })} />
                <InputField label={t('Category')} value={item.category} onChange={(value) => updateItem(item.id, { category: value, categorySlug: normalizeSlug(value) })} />
                <InputField label={t('URL slug')} value={item.slug} onChange={(value) => updateItem(item.id, { slug: normalizeSlug(value) })} />
                <InputField label={t('Price or price range (optional)')} value={item.priceLabel} onChange={(value) => updateItem(item.id, { priceLabel: value })} />
                <InputField label={t('Duration (optional)')} value={item.duration} onChange={(value) => updateItem(item.id, { duration: value })} />
                <InputField label={t('Image URL')} value={item.imageUrl} onChange={(value) => updateItem(item.id, { imageUrl: value })} />
                <InputField label={t('Area served')} value={item.areaServed} onChange={(value) => updateItem(item.id, { areaServed: value })} />
                <InputField label={t('Button label')} value={item.ctaLabel} onChange={(value) => updateItem(item.id, { ctaLabel: value })} />
                <InputField label={t('Button link')} value={item.ctaUrl} onChange={(value) => updateItem(item.id, { ctaUrl: value })} />
                <InputField label={t('SEO title')} value={item.metaTitle} onChange={(value) => updateItem(item.id, { metaTitle: value })} />
                <InputField label={t('SEO description')} value={item.metaDescription} onChange={(value) => updateItem(item.id, { metaDescription: value })} />
              </div>
              <InputField label={t('Short summary')} value={item.summary} onChange={(value) => updateItem(item.id, { summary: value })} />
              <TextAreaField label={t('Description')} value={item.description} onChange={(value) => updateItem(item.id, { description: value })} />
              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleField label={t('Show in the public directory')} checked={item.enabled} onChange={(value) => updateItem(item.id, { enabled: value })} />
                <ToggleField label={t('Feature on the homepage')} checked={item.featured} onChange={(value) => updateItem(item.id, { featured: value })} />
                <ToggleField label={t('Index this item')} checked={item.indexable} onChange={(value) => updateItem(item.id, { indexable: value })} />
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {section === 'seo' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card><CardContent className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold">{t('Search appearance')}</h2><p className="text-sm text-muted-foreground">{t('Write accurate titles and descriptions that match the visible page content.')}</p></div>
            <div className="space-y-1.5">
              <Label>{t('Public site language')}</Label>
              <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.seo.language} onChange={(event) => setObjectField('seo', 'language', event.target.value as BusinessSiteContent['seo']['language'])}>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
              <p className="text-xs text-muted-foreground">{t('Choose the language used for public site content.')}</p>
            </div>
            <InputField label={t('Default SEO title')} value={draft.seo.title} onChange={(value) => setObjectField('seo', 'title', value)} />
            <TextAreaField label={t('Default SEO description')} value={draft.seo.description} onChange={(value) => setObjectField('seo', 'description', value)} rows={3} />
            <ToggleField label={t('Allow search engines to index this site')} checked={draft.seo.indexable} onChange={(value) => setObjectField('seo', 'indexable', value)} />
            <p className="text-xs text-muted-foreground">{t('Draft and preview pages are never included in the public sitemap.')}</p>
          </CardContent></Card>
          <Card><CardContent className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold">{t('Public address')}</h2><p className="text-sm text-muted-foreground">{t('Your site uses the Stampfy shared domain. Custom domains are planned for a later phase.')}</p></div>
            <InputField label={t('Business site URL')} value={publicUrl} onChange={() => undefined} readOnly />
            <p className="text-xs text-muted-foreground">{t('The address uses your existing business slug and does not replace campaign or loyalty card links.')}</p>
          </CardContent></Card>
        </div>
      )}

      {section === 'history' && (
        <Card><CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex items-center gap-2"><History className="h-5 w-5 text-muted-foreground" /><div><h2 className="text-lg font-semibold">{t('Publication history')}</h2><p className="text-sm text-muted-foreground">{t('Published versions can be restored. Restoring creates a new version.')}</p></div></div>
          {site.revisions.length === 0 ? <p className="text-sm text-muted-foreground">{t('No published versions yet.')}</p> : (
            <div className="divide-y rounded-lg border">
              {site.revisions.map((revision) => (
                <div key={revision.revision} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-medium">{t('Version')} {revision.revision}</p><p className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</p></div>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleRestore(revision.revision)}><Undo2 className="mr-2 h-4 w-4" />{t('Restore and publish')}</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      )}

      {hasChanges && <div className="sticky bottom-2 flex flex-col items-start justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-panel backdrop-blur sm:flex-row sm:items-center"><p className="text-sm">{t('You have unsaved site changes.')}</p><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setDraft(site.draftContent); setError(''); }}>{t('Discard')}</Button><Button type="button" onClick={() => void persistDraft()} disabled={busy}><Save className="mr-2 h-4 w-4" />{t('Save draft')}</Button></div></div>}

    </div>
  );
};
