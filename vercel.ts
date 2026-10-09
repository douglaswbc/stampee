const configuredAppUrl = process.env.VITE_APP_URL?.trim()
  || process.env.APP_ORIGIN?.trim();

if (!configuredAppUrl) {
  throw new Error('Set VITE_APP_URL or APP_ORIGIN so Vercel can configure hostname routing.');
}

const normalizedAppUrl = configuredAppUrl.includes('://') ? configuredAppUrl : `https://${configuredAppUrl}`;
const appHost = new URL(normalizedAppUrl).hostname.toLowerCase().replace(/^www\./, '');

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapedAppHost = escapeRegex(appHost);
const appHostAliases = `(?:${escapedAppHost}|www\\.${escapedAppHost})`;
const appDomainAndSubdomains = `(?:.*\\.)?${escapedAppHost}`;
const nonPlatformHostPattern = `(?:.*\\.)?vercel\\.app(?::[0-9]+)?|localhost(?::[0-9]+)?`;
const appHostAndPlatformHosts = `(?i)(?:${appHostAliases}(?::[0-9]+)?|${nonPlatformHostPattern})`;
const appDomainAndPlatformHosts = `(?i)(?:${appDomainAndSubdomains}(?::[0-9]+)?|${nonPlatformHostPattern})`;

export const config = {
  functions: {
    'api/customer-push-worker.ts': {
      maxDuration: 60,
    },
  },
  crons: [
    {
      path: '/api/zernio-worker',
      schedule: '0 12 * * *',
    },
    {
      path: '/api/customer-push-worker',
      schedule: '0 12 * * *',
    },
  ],
  headers: [
    {
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      ],
    },
    {
      source: '/manifest.webmanifest',
      headers: [
        { key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' },
        { key: 'Cache-Control', value: 'public, max-age=3600' },
      ],
    },
    {
      source: '/index.html',
      headers: [
        { key: 'Cache-Control', value: 'no-cache' },
      ],
    },
    {
      source: '/((?!api/|assets/|empresa/|.*\\..*).*)',
      headers: [
        { key: 'Cache-Control', value: 'no-cache' },
      ],
    },
  ],
  routes: [
    {
      src: '/sites-sitemap\\.xml$',
      dest: '/api/sites-sitemap',
    },
    {
      src: '/(?!api(?:/|$))(?<sitePath>.*)',
      has: [
        { type: 'host', value: '(?<tenantHost>(?!(?:www|app|api|admin)\\.)[a-z0-9-]+(?:\\.[a-z0-9-]+)+\\.[a-z]{2,})' },
      ],
      missing: [
        { type: 'host', value: appHostAndPlatformHosts },
      ],
      dest: '/api/public-site?host=$tenantHost&path=/$sitePath',
    },
    {
      src: '/(?!api(?:/|$))(?<sitePath>.*)',
      has: [
        { type: 'host', value: '(?<tenantHost>[^/:]+)(?::[0-9]+)?' },
      ],
      missing: [
        { type: 'host', value: appDomainAndPlatformHosts },
      ],
      dest: '/api/public-site?host=$tenantHost&path=/$sitePath',
    },
  ],
  rewrites: [
    {
      source: '/empresa/:slug',
      destination: '/api/public-site?slug=:slug',
    },
    {
      source: '/empresa/:slug/:path*',
      destination: '/api/public-site?slug=:slug&path=/:path*',
    },
    {
      source: '/sites-sitemap.xml',
      destination: '/api/sites-sitemap',
    },
    {
      source: '/((?!api/|assets/|@vite/|@react-refresh|@id/|@fs/|.*\\..*).*)',
      destination: '/index.html',
    },
  ],
};
