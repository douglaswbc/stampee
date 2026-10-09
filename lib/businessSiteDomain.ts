export const getBusinessSiteDomain = (appUrl?: string | null) => {
  const configured = appUrl?.trim() || 'https://stampee.co';
  try {
    const url = new URL(configured.includes('://') ? configured : `https://${configured}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'stampee.co';
  }
};

export const getFallbackBusinessSiteSlug = (host: string, appUrl?: string | null) => {
  const suffix = `.${getBusinessSiteDomain(appUrl)}`;
  if (!host.endsWith(suffix)) return '';
  const slug = host.slice(0, -suffix.length);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : '';
};

export const isBusinessPlatformHost = (host: string, appUrl?: string | null) => {
  const appHost = (() => {
    try {
      const configured = appUrl?.trim() || 'https://stampee.co';
      return new URL(configured.includes('://') ? configured : `https://${configured}`).hostname.toLowerCase();
    } catch {
      return 'stampee.co';
    }
  })();
  const businessSiteDomain = getBusinessSiteDomain(appUrl);
  return host === appHost || host === businessSiteDomain || host === `www.${businessSiteDomain}` || host.endsWith('.vercel.app');
};
