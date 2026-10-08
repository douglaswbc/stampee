const appOrigin = (request: Request) => {
  const configured = process.env.VITE_APP_URL?.trim() || process.env.APP_ORIGIN?.trim();
  try { return new URL(configured || request.url).origin; } catch { return new URL(request.url).origin; }
};

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[character] ?? character));

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
      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/list_public_business_site_urls`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      if (!response.ok) throw new Error('Sitemap source unavailable.');
      const rows = await response.json() as Array<{ url_path?: unknown; last_modified?: unknown }>;
      const entries = Array.isArray(rows) ? rows.flatMap((row) => {
        if (typeof row.url_path !== 'string' || !row.url_path.startsWith('/empresa/')) return [];
        const lastModified = typeof row.last_modified === 'string' ? new Date(row.last_modified) : null;
        const lastmod = lastModified && !Number.isNaN(lastModified.getTime()) ? `<lastmod>${lastModified.toISOString()}</lastmod>` : '';
        return [`<url><loc>${escapeXml(`${origin}${row.url_path}`)}</loc>${lastmod}</url>`];
      }) : [];
      const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`;
      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('Sitemap temporarily unavailable.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  },
};
