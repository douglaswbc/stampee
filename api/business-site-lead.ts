import { getFallbackBusinessSiteSlug, isBusinessPlatformHost } from '../lib/businessSiteDomain';

const supabaseUrl = () => process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const appUrl = () => process.env.VITE_APP_URL?.trim() || process.env.APP_ORIGIN?.trim() || 'https://stampee.co';

const textField = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

const fingerprintIp = async (ip: string, keyText: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyText),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const redirectToContact = (slug: string, state: string, hostedSite = false) => new Response(null, {
  status: 303,
  headers: {
    Location: `${hostedSite ? '' : `/empresa/${encodeURIComponent(slug)}`}/contato?lead=${encodeURIComponent(state)}`,
    'Cache-Control': 'no-store',
  },
});

const requestHost = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  try { return new URL(`https://${forwarded || request.headers.get('host') || ''}`).hostname.toLowerCase(); }
  catch { return ''; }
};

const publicSiteHostMatchesSlug = async (host: string, slug: string, baseUrl: string, key: string) => {
  if (isBusinessPlatformHost(host, appUrl())) return true;
  const fallbackSlug = getFallbackBusinessSiteSlug(host, appUrl());
  if (fallbackSlug) return fallbackSlug === slug;

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/get_public_business_site_by_host`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ host_input: host }),
  });
  if (!response.ok) return false;
  const site = await response.json() as { slug?: unknown } | null;
  return site?.slug === slug;
};

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed.', { status: 405, headers: { Allow: 'POST' } });
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 16 * 1024) return new Response('Request too large.', { status: 413 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return new Response('Invalid form submission.', { status: 400 });
    }

    const slug = textField(form, 'slug').toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return new Response('Invalid business site.', { status: 400 });
    }

    const baseUrl = supabaseUrl();
    const key = serviceRoleKey();
    const host = requestHost(request);
    const isPlatformHost = isBusinessPlatformHost(host, appUrl());
    const isPlatformSubdomain = !isPlatformHost && Boolean(getFallbackBusinessSiteSlug(host, appUrl()));
    const hostedSite = isPlatformSubdomain || !isPlatformHost;
    if (!host || (hostedSite && (!baseUrl || !key || !(await publicSiteHostMatchesSlug(host, slug, baseUrl, key))))) {
      return new Response('This business site is not available on this domain.', { status: 404 });
    }
    if (!baseUrl || !key) return redirectToContact(slug, 'error', hostedSite);

    const forwardedIp = request.headers.get('x-vercel-forwarded-for')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';

    try {
      const ipFingerprint = await fingerprintIp(forwardedIp, key);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/submit_business_site_lead`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            slug_input: slug,
            name_input: textField(form, 'name'),
            email_input: textField(form, 'email'),
            phone_input: textField(form, 'phone'),
            message_input: textField(form, 'message'),
            consent_input: form.get('consent') === 'on',
            honeypot_input: textField(form, 'website'),
            ip_fingerprint_input: ipFingerprint,
          }),
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) return redirectToContact(slug, 'error', hostedSite);
      const result = await response.json() as { outcome?: string };
      if (result.outcome === 'created' || result.outcome === 'accepted') return redirectToContact(slug, 'success', hostedSite);
      if (result.outcome === 'rate_limited') return redirectToContact(slug, 'rate-limited', hostedSite);
      return redirectToContact(slug, 'error', hostedSite);
    } catch {
      return redirectToContact(slug, 'error', hostedSite);
    }
  },
};
