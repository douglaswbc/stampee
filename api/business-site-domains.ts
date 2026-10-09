import { getBusinessSiteDomain } from '../lib/businessSiteDomain';

type DnsRecord = { host: string; type: string; value: string };
type DomainRow = {
  owner_id: string;
  apex_domain: string;
  primary_domain: string;
  status: 'pending_dns' | 'active';
  dns_records: { apex?: DnsRecord[]; primary?: DnsRecord[] };
  verified_at: string | null;
};

class ApiFailure extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const env = (key: string) => process.env[key]?.trim() || '';
const supabaseConfig = () => ({
  url: env('SUPABASE_URL') || env('VITE_SUPABASE_URL'),
  anon: env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY'),
  service: env('SUPABASE_SERVICE_ROLE_KEY'),
});

const timedFetch = async (url: string, init: RequestInit = {}, milliseconds = 12000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), milliseconds);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeoutId); }
};

const supabaseRest = async <T,>(path: string, method: string, body?: unknown, prefer = 'return=representation,resolution=merge-duplicates'): Promise<T> => {
  const config = supabaseConfig();
  if (!config.url || !config.service) throw new ApiFailure('Server Supabase credentials are not configured.', 503);
  const response = await timedFetch(`${config.url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: config.service,
      Authorization: `Bearer ${config.service}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({})) as { code?: string };
    if (details.code === 'PGRST205' || details.code === '42P01') {
      throw new ApiFailure('Apply the add_business_site_domains.sql patch in Supabase, then reload this page.', 503);
    }
    if (response.status === 409) throw new ApiFailure('This domain is already connected to another Stampfy site.', 409);
    throw new ApiFailure('Could not save the business domain settings.', 502);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
};

const getOwnerId = async (request: Request) => {
  const config = supabaseConfig();
  if (!config.url || !config.anon || !config.service) throw new ApiFailure('Server Supabase credentials are not configured.', 503);
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiFailure('Sign in as the business owner to manage this domain.', 401);
  const userResponse = await timedFetch(`${config.url.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: config.anon, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) throw new ApiFailure('Your session expired. Sign in again.', 401);
  const user = await userResponse.json() as { id?: string };
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) throw new ApiFailure('Your session is invalid.', 401);
  const profiles = await supabaseRest<Array<{ id: string; role: string; access: string }>>(
    `profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,access`, 'GET',
  );
  if (profiles[0]?.role !== 'owner' || profiles[0]?.access !== 'active') {
    throw new ApiFailure('Only an active business owner can manage this domain.', 403);
  }
  return user.id;
};

const vercelSettings = () => {
  const token = env('VERCEL_ACCESS_TOKEN');
  const projectId = env('VERCEL_PROJECT_ID');
  if (!token || !projectId) throw new ApiFailure('Vercel domain management is not configured on the server.', 503);
  return { token, projectId, teamId: env('VERCEL_TEAM_ID') };
};

const vercelRequest = async <T,>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const { token, teamId } = vercelSettings();
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  let response: Response;
  try {
    response = await timedFetch(`https://api.vercel.com${path}${query}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure('Vercel is temporarily unavailable. Try again shortly.', 502);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: unknown } };
    const providerMessage = typeof payload.error?.message === 'string'
      ? payload.error.message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
      : '';
    if (response.status === 401 || response.status === 403) throw new ApiFailure('Vercel rejected the configured token or its project permissions.', 502);
    if (response.status === 404) throw new ApiFailure('The requested domain is not attached to this Vercel project.', 404);
    throw new ApiFailure(providerMessage || `Vercel could not process this domain (HTTP ${response.status}).`, 502);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
};

const projectDomainPath = (domain: string) => `/v9/projects/${encodeURIComponent(vercelSettings().projectId)}/domains/${encodeURIComponent(domain)}`;
const domainConfigPath = (domain: string) => `/v6/domains/${encodeURIComponent(domain)}/config`;

const normalizeDomain = (input: unknown) => {
  if (typeof input !== 'string') throw new ApiFailure('Enter the root domain you own, such as example.com.');
  let host = input.trim().toLowerCase();
  if (host.startsWith('https://')) host = host.slice(8);
  else if (host.startsWith('http://')) host = host.slice(7);
  if (host.endsWith('/')) host = host.slice(0, -1);
  if (!host || host.length > 253 || /[\s/@?#]/.test(host)) throw new ApiFailure('Enter a valid root domain, such as example.com.');
  if (host.includes(':') || host.endsWith('.')) throw new ApiFailure('Enter a domain without a port or trailing dot.');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) throw new ApiFailure('Enter a domain name, not an IP address.');
  if (host.startsWith('www.')) host = host.slice(4);
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new ApiFailure('Enter a valid root domain, such as example.com.');
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.vercel.app')) {
    throw new ApiFailure('Use a domain owned by your business, not a Stampfy or Vercel domain.');
  }
  const appUrl = env('VITE_APP_URL') || env('APP_ORIGIN') || 'https://stampee.co';
  const businessSiteDomain = getBusinessSiteDomain(appUrl);
  if (host === businessSiteDomain || host.endsWith(`.${businessSiteDomain}`)) {
    throw new ApiFailure('The Stampfy platform domain cannot be assigned to a business site.');
  }
  return { apexDomain: host, primaryDomain: `www.${host}` };
};

type VercelDomain = { verified?: boolean; verification?: Array<{ type?: string; domain?: string; value?: string }> };
type VercelConfig = {
  verified?: boolean;
  misconfigured?: boolean;
  recommendedCNAME?: string;
  recommendedIPv4?: string[] | string;
  recommendedIPv6?: string[] | string;
  verification?: Array<{ type?: string; domain?: string; value?: string }>;
};

const listValues = (value: string[] | string | undefined) => typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
const toDnsRecords = (domain: string, config: VercelConfig, verification: VercelDomain['verification'] = []): DnsRecord[] => {
  const host = domain.startsWith('www.') ? 'www' : '@';
  const records: DnsRecord[] = [];
  if (config.recommendedCNAME) records.push({ host, type: 'CNAME', value: config.recommendedCNAME });
  for (const value of listValues(config.recommendedIPv4)) records.push({ host, type: 'A', value });
  for (const value of listValues(config.recommendedIPv6)) records.push({ host, type: 'AAAA', value });
  for (const challenge of [...(config.verification || []), ...(verification || [])]) {
    if (challenge.type && challenge.domain && challenge.value) {
      records.push({ host: challenge.domain, type: challenge.type, value: challenge.value });
    }
  }
  return [...new Map(records.map((record) => [`${record.host}|${record.type}|${record.value}`, record] as const)).values()];
};

const loadVercelDomain = async (domain: string) => {
  const [project, config] = await Promise.all([
    vercelRequest<VercelDomain>(projectDomainPath(domain)),
    vercelRequest<VercelConfig>(domainConfigPath(domain)),
  ]);
  return { project, config, records: toDnsRecords(domain, config, project.verification) };
};

const saveDomainRow = async (ownerId: string, domain: string, records: DomainRow['dns_records'], status: DomainRow['status']) => {
  const now = new Date().toISOString();
  const saved = await supabaseRest<DomainRow[]>(
    'business_site_domains',
    'POST',
    {
      owner_id: ownerId,
      apex_domain: domain,
      primary_domain: `www.${domain}`,
      status,
      dns_records: records,
      verified_at: status === 'active' ? now : null,
      updated_at: now,
    },
    'return=representation',
  );
  return saved[0];
};

const getDomainRow = async (ownerId: string) => {
  const rows = await supabaseRest<DomainRow[]>(
    `business_site_domains?owner_id=eq.${encodeURIComponent(ownerId)}&select=owner_id,apex_domain,primary_domain,status,dns_records,verified_at`, 'GET',
  );
  return rows[0] || null;
};

const checkPublishedSite = async (ownerId: string) => {
  const rows = await supabaseRest<Array<{ published_content: unknown }>>(
    `business_sites?owner_id=eq.${encodeURIComponent(ownerId)}&select=published_content`, 'GET',
  );
  if (!rows[0]?.published_content) throw new ApiFailure('Publish the business site before connecting its domain.', 409);
};

const disconnectDomain = async (domain: string) => {
  try {
    await vercelRequest(projectDomainPath(domain), 'DELETE');
  } catch (error) {
    // A domain removed from Vercel already can still be cleared from this account.
    if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
  }
};

export default {
  async fetch(request: Request) {
    try {
      const ownerId = await getOwnerId(request);
      if (request.method === 'GET') {
        return json({ domain: await getDomainRow(ownerId) });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

      const body = await request.json().catch(() => ({})) as { action?: unknown; domain?: unknown };
      const action = typeof body.action === 'string' ? body.action : '';
      const existing = await getDomainRow(ownerId);

      if (action === 'connect') {
        await checkPublishedSite(ownerId);
        const { apexDomain, primaryDomain } = normalizeDomain(body.domain);
        if (existing) {
          if (existing.apex_domain === apexDomain) return json({ domain: existing, message: 'This domain is already connected.' });
          throw new ApiFailure('Remove the current domain before connecting another one.', 409);
        }
        let primaryAdded = false;
        let apexAdded = false;
        try {
          const primary = await vercelRequest<VercelDomain>(
            `/v10/projects/${encodeURIComponent(vercelSettings().projectId)}/domains`, 'POST', { name: primaryDomain },
          );
          primaryAdded = true;
          const apex = await vercelRequest<VercelDomain>(
            `/v10/projects/${encodeURIComponent(vercelSettings().projectId)}/domains`, 'POST',
            { name: apexDomain, redirect: primaryDomain, redirectStatusCode: 308 },
          );
          apexAdded = true;
          const [primaryConfig, apexConfig] = await Promise.all([
            vercelRequest<VercelConfig>(domainConfigPath(primaryDomain)),
            vercelRequest<VercelConfig>(domainConfigPath(apexDomain)),
          ]);
          const saved = await saveDomainRow(ownerId, apexDomain, {
            primary: toDnsRecords(primaryDomain, primaryConfig, primary.verification),
            apex: toDnsRecords(apexDomain, apexConfig, apex.verification),
          }, 'pending_dns');
          return json({ domain: saved, message: 'Domain added to Vercel. Configure the DNS records below, then check the connection.' });
        } catch (error) {
          if (apexAdded) await disconnectDomain(apexDomain).catch(() => undefined);
          if (primaryAdded) await disconnectDomain(primaryDomain).catch(() => undefined);
          throw error;
        }
      }

      if (!existing) throw new ApiFailure('No custom domain is connected to this site.', 404);
      if (action === 'verify') {
        await Promise.all([
          vercelRequest(projectDomainPath(existing.primary_domain) + '/verify', 'POST'),
          vercelRequest(projectDomainPath(existing.apex_domain) + '/verify', 'POST'),
        ]).catch(() => undefined);
        const [primary, apex] = await Promise.all([
          loadVercelDomain(existing.primary_domain),
          loadVercelDomain(existing.apex_domain),
        ]);
        const active = primary.project.verified === true && apex.project.verified === true
          && primary.config.misconfigured === false && apex.config.misconfigured === false;
        const saved = await supabaseRest<DomainRow[]>(
          `business_site_domains?owner_id=eq.${encodeURIComponent(ownerId)}`,
          'PATCH',
          {
            status: active ? 'active' : 'pending_dns',
            dns_records: { primary: primary.records, apex: apex.records },
            verified_at: active ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
        );
        return json({
          domain: saved[0] || existing,
          message: active
            ? 'Domain connected. Your business site is available at the www address.'
            : 'Vercel has not confirmed all DNS records yet. Check the records below and try again after propagation.',
        });
      }
      if (action === 'remove') {
        await Promise.all([disconnectDomain(existing.primary_domain), disconnectDomain(existing.apex_domain)]);
        await supabaseRest(`business_site_domains?owner_id=eq.${encodeURIComponent(ownerId)}`, 'DELETE');
        return json({ domain: null, message: 'Custom domain removed.' });
      }
      throw new ApiFailure('Unsupported domain action.');
    } catch (error) {
      if (error instanceof ApiFailure) return json({ error: error.message }, error.status);
      return json({ error: 'Could not manage this domain. Try again shortly.' }, 500);
    }
  },
};

