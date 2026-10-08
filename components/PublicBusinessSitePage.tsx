import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { fetchBusinessSiteDraft, fetchPublicBusinessSite } from '../lib/db/businessSites';
import { renderPublicBusinessSiteHtml } from '../lib/publicBusinessSiteHtml';
import type { PublicBusinessSite } from '../lib/businessSites';
import { useLocale } from './LocaleProvider';

interface PublicBusinessSitePageProps {
  preview?: boolean;
}

const updateMeta = (name: string, content: string, property = false) => {
  const attribute = property ? 'property' : 'name';
  let tag = document.head.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, name);
    document.head.appendChild(tag);
  }
  tag.content = content;
};

const applyHead = (html: string, preview: boolean) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.title = doc.title;
  document.documentElement.lang = doc.documentElement.lang || 'pt-BR';
  const description = doc.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  const robots = preview ? 'noindex,nofollow' : doc.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? 'noindex,nofollow';
  updateMeta('description', description);
  updateMeta('robots', robots);
  for (const key of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image']) {
    const content = doc.head.querySelector(`meta[property="${key}"]`)?.getAttribute('content');
    updateMeta(key, content ?? '', true);
  }
  for (const key of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    const content = doc.head.querySelector(`meta[name="${key}"]`)?.getAttribute('content');
    updateMeta(key, content ?? '');
  }
  let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? window.location.href;
  document.head.querySelectorAll('script[data-business-site-jsonld="true"]').forEach((script) => script.remove());
  const jsonLd = doc.head.querySelector('script[type="application/ld+json"]')?.textContent;
  if (jsonLd) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.businessSiteJsonld = 'true';
    script.textContent = jsonLd;
    document.head.appendChild(script);
  }
};

export const PublicBusinessSitePage: React.FC<PublicBusinessSitePageProps> = ({ preview = false }) => {
  const { slug: routeSlug } = useParams();
  const location = useLocation();
  const { language, t } = useLocale();
  const [site, setSite] = useState<PublicBusinessSite | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setSite(null);
    const load = async () => {
      if (preview) {
        const result = await fetchBusinessSiteDraft();
        if (cancelled) return;
        if (result.data) {
          setSite({
            businessName: result.data.businessName,
            slug: result.data.slug,
            content: result.data.draftContent,
            revision: result.data.publishedRevision,
            publishedAt: result.data.publishedAt ?? new Date().toISOString(),
          });
        } else {
          setFailed(true);
        }
        setLoading(false);
        return;
      }
      if (!routeSlug) {
        setFailed(true);
        setLoading(false);
        return;
      }
      const data = await fetchPublicBusinessSite(routeSlug);
      if (cancelled) return;
      setSite(data);
      setFailed(!data);
      setLoading(false);
    };
    void load().catch(() => {
      if (cancelled) return;
      setFailed(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [preview, routeSlug]);

  useEffect(() => () => {
    document.documentElement.lang = language;
  }, [language]);

  const route = useMemo(() => {
    if (preview || !routeSlug) return '';
    const prefix = `/empresa/${routeSlug}`;
    return location.pathname.startsWith(prefix) ? location.pathname.slice(prefix.length).replace(/^\/+/, '') : '';
  }, [location.pathname, preview, routeSlug]);

  const rendered = useMemo(() => site ? renderPublicBusinessSiteHtml(site, route, window.location.origin, { preview }) : null, [preview, route, site]);
  const siteCss = rendered?.html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '';
  const siteBody = rendered?.html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';

  useEffect(() => {
    if (!siteCss) return;
    const styleElement = document.createElement('style');
    styleElement.dataset.businessSiteStyle = 'true';
    styleElement.textContent = siteCss;
    document.head.appendChild(styleElement);
    return () => styleElement.remove();
  }, [siteCss]);

  useEffect(() => {
    if (rendered) applyHead(rendered.html, preview);
    else if (loading) {
      document.documentElement.lang = language;
      document.title = preview ? `${t('Preview')} | Stampfy` : `${t('Loading site...')} | Stampfy`;
      updateMeta('robots', 'noindex,nofollow');
    }
  }, [language, loading, preview, rendered, t]);

  if (loading) return <main className="grid min-h-screen place-items-center bg-white p-6 text-sm text-slate-500">{t('Loading site...')}</main>;
  if (failed || !rendered) {
    return (
      <main className="grid min-h-screen place-items-center bg-white p-6 text-center text-slate-700">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold">{t('This site is not available.')}</h1>
          <p className="text-sm text-slate-500">{t('The site may not have been published yet.')}</p>
          {preview && <Link to="/site" className="font-medium text-blue-700 underline">{t('Back to site editor')}</Link>}
        </div>
      </main>
    );
  }

  return (
    <div dangerouslySetInnerHTML={{ __html: siteBody }} />
  );
};
