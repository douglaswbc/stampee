import { renderPublicBusinessSiteHtml } from '../lib/publicBusinessSiteHtml';
import type { PublicBusinessSite } from '../lib/businessSites';

const configuredSupabaseUrl = () => process.env.VITE_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || '';
const configuredAnonKey = () => process.env.VITE_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || '';

const appOrigin = (request: Request) => {
  const configured = process.env.VITE_APP_URL?.trim() || process.env.APP_ORIGIN?.trim();
  try { return new URL(configured || request.url).origin; } catch { return new URL(request.url).origin; }
};

const htmlResponse = (html: string, status: number, headers: Record<string, string> = {}) => new Response(html, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers },
});

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] ?? character));

const unavailableHtml = (title: string, message: string, origin: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${escapeHtml(origin)}/"></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui;color:#20232b"><main style="max-width:560px;padding:32px"><p style="font-weight:700">Stampfy</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(origin)}/">Visit Stampfy</a></main></body></html>`;

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const slug = (url.searchParams.get('slug') || '').trim().toLowerCase();
    const route = (url.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');
    const origin = appOrigin(request);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || route.length > 240 || route.split('/').some((part) => part === '..')) {
      return htmlResponse(unavailableHtml('Page not found', 'This business site is not available.', origin), 404, { 'Cache-Control': 'public, max-age=60' });
    }

    const supabaseUrl = configuredSupabaseUrl();
    const anonKey = configuredAnonKey();
    if (!supabaseUrl || !anonKey) {
      return htmlResponse(unavailableHtml('Site temporarily unavailable', 'Please try again in a few minutes.', origin), 503, { 'Cache-Control': 'no-store' });
    }

    try {
      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/get_public_business_site`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug_input: slug }),
      });
      if (!response.ok) {
        return htmlResponse(unavailableHtml('Site temporarily unavailable', 'Please try again in a few minutes.', origin), 503, { 'Cache-Control': 'no-store' });
      }
      const raw = await response.json() as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object' || typeof raw.businessName !== 'string' || !raw.content || typeof raw.content !== 'object') {
        return htmlResponse(unavailableHtml('Page not found', 'This business site is not available.', origin), 404, { 'Cache-Control': 'public, max-age=60' });
      }
      const site = raw as unknown as PublicBusinessSite;
      const rendered = renderPublicBusinessSiteHtml(site, route, origin);
      return htmlResponse(rendered.html, rendered.status, { 'Cache-Control': 'no-store' });
    } catch {
      return htmlResponse(unavailableHtml('Site temporarily unavailable', 'Please try again in a few minutes.', origin), 503, { 'Cache-Control': 'no-store' });
    }
  },
};
