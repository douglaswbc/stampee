const supabaseUrl = () => process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

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

const redirectToContact = (slug: string, state: string) => new Response(null, {
  status: 303,
  headers: {
    Location: `/empresa/${encodeURIComponent(slug)}/contato?lead=${encodeURIComponent(state)}`,
    'Cache-Control': 'no-store',
  },
});

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
    if (!baseUrl || !key) return redirectToContact(slug, 'error');

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

      if (!response.ok) return redirectToContact(slug, 'error');
      const result = await response.json() as { outcome?: string };
      if (result.outcome === 'created' || result.outcome === 'accepted') return redirectToContact(slug, 'success');
      if (result.outcome === 'rate_limited') return redirectToContact(slug, 'rate-limited');
      return redirectToContact(slug, 'error');
    } catch {
      return redirectToContact(slug, 'error');
    }
  },
};
