import { getFallbackBusinessSiteSlug, isBusinessPlatformHost } from '../lib/businessSiteDomain';

type SiteRow = { url_path?: unknown; last_modified?: unknown };
type PublicSite = {
  slug?: unknown;
  publishedAt?: unknown;
  content?: {
    seo?: { indexable?: unknown };
    pages?: Array<{ slug?: unknown; enabled?: unknown; indexable?: unknown }>;
    items?: Array<{ kind?: unknown; slug?: unknown; enabled?: unknown; indexable?: unknown; categorySlug?: unknown }>;
  };
};

const appOrigin = (request: Request) => {
  const configured = process.env.VITE_APP_URL?.trim() || process.env.APP_ORIGIN?.trim();
  try { return new URL(configured || request.url).origin; } catch { return new URL(request.url).origin; }
};

const requestHost = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  try { return new URL(`https://${forwarded || request.headers.get('host') || ''}`).hostname.toLowerCase(); }
  catch { return ''; }
};

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[character] ?? character));

const sitePaths = (site: PublicSite) => {
  const content = site.content;
  const indexable = content?.seo?.indexable !== false;
  if (!indexable) return [];
  const paths = ['/'];
  const pages = Array.isArray(content?.pages) ? content.pages : [];
  const items = Array.isArray(content?.items) ? content.items : [];
  const publicItems = items.filter((item) => item.enabled !== false && item.indexable !== false && typeof item.slug === 'string' && (item.kind === 'product' || item.kind === 'service'));
  if (items.some((item) => item.enabled !== false)) paths.push('/produtos-servicos');
  for (const page of pages) {
    if (page.enabled !== false && page.indexable !== false && typeof page.slug === 'string' && page.slug) paths.push(`/${page.slug}`);
  }
  for (const item of publicItems) paths.push(`/${item.kind}/${item.slug}`);
  const categories = new Set(publicItems.flatMap((item) => typeof item.categorySlug === 'string' && item.categorySlug ? [item.categorySlug] : []));
  for (const category of categories) paths.push(`/categoria/${category}`);
  return [...new Set(paths)];
};

const renderXml = (origin: string, entries: Array<{ path: string; lastmod?: string }>) => {
  const urls = entries.map(({ path, lastmod }) => {
    const parsed = lastmod ? new Date(lastmod) : null;
    const modified = parsed && !Number.isNaN(parsed.getTime()) ? `<lastmod>${parsed.toISOString()}</lastmod>` : '';
    return `<url><loc>${escapeXml(`${origin}${path}`)}</loc>${modified}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
};

export default {
  async fetch(request: Request) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || '';
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || '';
    const origin = appOrigin(request);
    if (!supabaseUrl || !anonKey) {
      return new Response('Sitemap temporarily unavailable.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    try {
      const host = requestHost(request);
      const platformHost = isBusinessPlatformHost(host, origin);
      const slug = platformHost ? '' : getFallbackBusinessSiteSlug(host, origin);
      const tenantHost = !slug && !platformHost;

      if (slug || tenantHost) {
        const rpc = tenantHost ? 'get_public_business_site_by_host' : 'get_public_business_site';
        const body = tenantHost ? { host_input: host } : { slug_input: slug };
        const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${rpc}`, {
          method: 'POST',
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error('Sitemap source unavailable.');
        const site = await response.json() as PublicSite | null;
        if (!site || typeof site.slug !== 'string' || !site.content) {
          return new Response(renderXml(`https://${host}`, []), {
            status: 200,
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        const tenantOrigin = `https://${host}`;
        const lastmod = typeof site.publishedAt === 'string' ? site.publishedAt : undefined;
        const xml = renderXml(tenantOrigin, sitePaths(site).map((path) => ({ path, lastmod })));
        return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
      }

      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/list_public_business_site_urls`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('Sitemap source unavailable.');
      const rows = await response.json() as SiteRow[];
      const entries = Array.isArray(rows) ? rows.flatMap((row) => {
        if (typeof row.url_path !== 'string' || !row.url_path.startsWith('/empresa/')) return [];
        return [{ path: row.url_path, lastmod: typeof row.last_modified === 'string' ? row.last_modified : undefined }];
      }) : [];
      return new Response(renderXml(origin, entries), {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch {
      return new Response('Sitemap temporarily unavailable.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  },
};
