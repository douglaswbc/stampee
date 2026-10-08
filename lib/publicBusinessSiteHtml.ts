import type { BusinessSiteContent, BusinessSiteItem, BusinessSitePage, PublicBusinessSite } from './businessSites';

const copy = {
  'pt-BR': {
    home: 'Início', directory: 'Produtos e serviços', about: 'Sobre', contact: 'Contato',
    more: 'Saiba mais', featured: 'Destaques', seeAll: 'Ver todos', notFound: 'Página não encontrada',
    notFoundCopy: 'Este endereço não existe ou não está publicado.', backHome: 'Ir para o início',
    contactCta: 'Entre em contato', category: 'Categoria', price: 'Informação de preço', duration: 'Duração',
    area: 'Área atendida', openingHours: 'Horário de funcionamento', address: 'Endereço', email: 'E-mail',
    phone: 'Telefone', whatsapp: 'WhatsApp', website: 'Site institucional', googleBusiness: 'Perfil da Empresa no Google', privacy: 'Privacidade',
    name: 'Nome', message: 'Mensagem', sendMessage: 'Enviar mensagem', contactConsent: 'Autorizo o uso dos meus dados para responder a este contato.',
    contactSuccess: 'Mensagem enviada. O comércio poderá entrar em contato pelos dados informados.', contactRateLimited: 'Muitas mensagens em pouco tempo. Aguarde alguns minutos e tente novamente.',
    contactError: 'Não foi possível enviar a mensagem. Confira os dados e tente novamente.',
  },
  es: {
    home: 'Inicio', directory: 'Productos y servicios', about: 'Acerca de', contact: 'Contacto',
    more: 'Más información', featured: 'Destacados', seeAll: 'Ver todos', notFound: 'Página no encontrada',
    notFoundCopy: 'Esta dirección no existe o no está publicada.', backHome: 'Ir al inicio',
    contactCta: 'Ponte en contacto', category: 'Categoría', price: 'Información de precio', duration: 'Duración',
    area: 'Zona de servicio', openingHours: 'Horario de atención', address: 'Dirección', email: 'Correo',
    phone: 'Teléfono', whatsapp: 'WhatsApp', website: 'Sitio web', googleBusiness: 'Perfil de Empresa en Google', privacy: 'Privacidad',
    name: 'Nombre', message: 'Mensaje', sendMessage: 'Enviar mensaje', contactConsent: 'Acepto que mis datos se utilicen para responder a esta consulta.',
    contactSuccess: 'Mensaje enviado. El comercio podrá responder usando los datos indicados.', contactRateLimited: 'Se enviaron demasiados mensajes. Espera unos minutos e inténtalo de nuevo.',
    contactError: 'No se pudo enviar el mensaje. Revisa los datos e inténtalo de nuevo.',
  },
  en: {
    home: 'Home', directory: 'Products and services', about: 'About', contact: 'Contact',
    more: 'Learn more', featured: 'Featured', seeAll: 'View all', notFound: 'Page not found',
    notFoundCopy: 'This address does not exist or has not been published.', backHome: 'Go to home',
    contactCta: 'Get in touch', category: 'Category', price: 'Price information', duration: 'Duration',
    area: 'Service area', openingHours: 'Opening hours', address: 'Address', email: 'Email',
    phone: 'Phone', whatsapp: 'WhatsApp', website: 'Business website', googleBusiness: 'Google Business Profile', privacy: 'Privacy',
    name: 'Name', message: 'Message', sendMessage: 'Send message', contactConsent: 'I agree that this business may use my details to respond to this request.',
    contactSuccess: 'Message sent. The business may contact you using the details provided.', contactRateLimited: 'Too many messages in a short time. Wait a few minutes and try again.',
    contactError: 'The message could not be sent. Check the details and try again.',
  },
} as const;

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] ?? character));

const safeColor = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

const safeUrl = (value: string, base: string, allowInternal = true): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (allowInternal && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    try { return new URL(trimmed, base).toString(); } catch { return ''; }
  }
  try {
    const url = new URL(trimmed);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
};

const safeImageUrl = (value: string, base: string) => {
  const href = safeUrl(value, base, false);
  if (!href) return '';
  try {
    const protocol = new URL(href).protocol;
    return protocol === 'https:' || protocol === 'http:' ? href : '';
  } catch {
    return '';
  }
};

const paragraphs = (value: string, className = '') => value
  .split(/\n\s*\n/)
  .map((paragraph) => paragraph.trim())
  .filter(Boolean)
  .map((paragraph) => `<p${className ? ` class="${className}"` : ''}>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
  .join('');

const itemPath = (site: PublicBusinessSite, item: BusinessSiteItem) => `/empresa/${site.slug}/${item.kind}/${item.slug}`;
const pagePath = (site: PublicBusinessSite, page: BusinessSitePage) => `/empresa/${site.slug}/${page.slug}`;

const renderImage = (url: string, alt: string, base: string, className: string, eager = false) => {
  const src = safeImageUrl(url, base);
  if (!src) return '';
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};

const renderItemCard = (site: PublicBusinessSite, item: BusinessSiteItem, base: string, labels: typeof copy['en']) => `
  <article class="item-card">
    <a class="item-card__image-link" href="${escapeHtml(itemPath(site, item))}" aria-label="${escapeHtml(item.name)}">
      ${renderImage(item.imageUrl, item.name, base, 'item-card__image') || '<span class="item-card__image item-card__placeholder" aria-hidden="true"></span>'}
    </a>
    <div class="item-card__body">
      ${item.category ? `<p class="eyebrow">${escapeHtml(item.category)}</p>` : ''}
      <h3><a href="${escapeHtml(itemPath(site, item))}">${escapeHtml(item.name)}</a></h3>
      ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
      ${item.priceLabel ? `<p class="item-card__price">${escapeHtml(item.priceLabel)}</p>` : ''}
      <a class="text-link" href="${escapeHtml(itemPath(site, item))}">${labels.more}<span aria-hidden="true"> →</span></a>
    </div>
  </article>`;

const renderDirectory = (site: PublicBusinessSite, base: string, labels: typeof copy['en'], items = site.content.items.filter((item) => item.enabled)) => `
  <div class="item-grid">${items.map((item) => renderItemCard(site, item, base, labels)).join('')}</div>`;

const renderContact = (site: PublicBusinessSite, labels: typeof copy['en']) => {
  const contact = site.content.contact;
  const address = [contact.address, contact.city, contact.region, contact.postalCode, contact.country].filter(Boolean).join(', ');
  const whatsappDigits = contact.whatsapp.replace(/\D/g, '');
  const links = [
    contact.email ? `<a href="mailto:${escapeHtml(contact.email)}">${labels.email}: ${escapeHtml(contact.email)}</a>` : '',
    contact.phone ? `<a href="tel:${escapeHtml(contact.phone.replace(/[^+\d]/g, ''))}">${labels.phone}: ${escapeHtml(contact.phone)}</a>` : '',
    whatsappDigits ? `<a href="https://wa.me/${escapeHtml(whatsappDigits)}" rel="noopener noreferrer">${labels.whatsapp}</a>` : '',
    safeUrl(contact.googleBusinessUrl, '', false) ? `<a href="${escapeHtml(safeUrl(contact.googleBusinessUrl, '', false))}" rel="noopener noreferrer">${labels.googleBusiness}</a>` : '',
    safeUrl(contact.instagramUrl, '', false) ? `<a href="${escapeHtml(safeUrl(contact.instagramUrl, '', false))}" rel="noopener noreferrer">Instagram</a>` : '',
    safeUrl(contact.facebookUrl, '', false) ? `<a href="${escapeHtml(safeUrl(contact.facebookUrl, '', false))}" rel="noopener noreferrer">Facebook</a>` : '',
  ].filter(Boolean);

  return `<div class="contact-grid">
    ${address ? `<div><span class="contact-label">${labels.address}</span><p>${escapeHtml(address)}</p></div>` : ''}
    ${contact.openingHours ? `<div><span class="contact-label">${labels.openingHours}</span><p>${escapeHtml(contact.openingHours)}</p></div>` : ''}
    ${contact.serviceArea ? `<div><span class="contact-label">${labels.area}</span><p>${escapeHtml(contact.serviceArea)}</p></div>` : ''}
    ${links.length ? `<nav class="contact-links" aria-label="${labels.contact}">${links.join('')}</nav>` : ''}
  </div>`;
};

const renderContactForm = (site: PublicBusinessSite, labels: typeof copy['en']) => {
  const privacyPage = site.content.pages.find((page) => page.kind === 'privacy' && page.enabled);
  const privacyLink = privacyPage
    ? ` <a href="${escapeHtml(pagePath(site, privacyPage))}">${labels.privacy}</a>`
    : '';
  return `<section class="contact-form-section" aria-labelledby="contact-form-title">
    <h2 id="contact-form-title">${labels.contactCta}</h2>
    <form class="contact-form" action="/api/business-site-lead" method="post">
      <input type="hidden" name="slug" value="${escapeHtml(site.slug)}">
      <div class="form-trap" aria-hidden="true"><label for="site-website">Website</label><input id="site-website" name="website" tabindex="-1" autocomplete="off"></div>
      <label>${labels.name}<input name="name" autocomplete="name" maxlength="120" required></label>
      <label>${labels.email}<input type="email" name="email" autocomplete="email" maxlength="254" required></label>
      <label>${labels.phone}<input type="tel" name="phone" autocomplete="tel" maxlength="40"></label>
      <label>${labels.message}<textarea name="message" rows="5" maxlength="3000" required></textarea></label>
      <label class="consent-field"><input type="checkbox" name="consent" required><span>${labels.contactConsent}${privacyLink}</span></label>
      <button class="button button--primary" type="submit">${labels.sendMessage}</button>
    </form>
  </section>`;
};

const resolvePage = (content: BusinessSiteContent, route: string) => {
  const normalized = route.replace(/^\/+|\/+$/g, '');
  if (!normalized) return { kind: 'home' as const, route: '', page: null, item: null };
  const parts = normalized.split('/');
  if (parts.length === 2 && (parts[0] === 'service' || parts[0] === 'product')) {
    return { kind: 'item' as const, route: normalized, page: null, item: content.items.find((item) => item.kind === parts[0] && item.slug === parts[1] && item.enabled) ?? null };
  }
  if (normalized === 'produtos-servicos') {
    return { kind: 'directory' as const, route: normalized, page: null, item: null };
  }
  if (parts.length === 2 && parts[0] === 'categoria' && parts[1]) {
    const categoryItems = content.items.filter((item) => item.enabled && item.categorySlug === parts[1]);
    if (categoryItems.length) return { kind: 'category' as const, route: normalized, page: null, item: null, categoryName: categoryItems[0].category, categoryItems };
    return { kind: 'missing' as const, route: normalized, page: null, item: null };
  }
  const page = content.pages.find((candidate) => candidate.slug === normalized && candidate.enabled) ?? null;
  return { kind: page ? 'page' as const : 'missing' as const, route: normalized, page, item: null };
};

const buildJsonLd = (
  site: PublicBusinessSite,
  origin: string,
  canonical: string,
  title: string,
  description: string,
  resolved: ReturnType<typeof resolvePage>,
) => {
  const contact = site.content.contact;
  const businessUrl = `${origin}/empresa/${site.slug}`;
  const hasContactDetails = Boolean(contact.email || contact.phone || contact.whatsapp || contact.address || contact.openingHours || contact.serviceArea || contact.googleBusinessUrl || contact.instagramUrl || contact.facebookUrl);
  const contactVisible = (resolved.kind === 'page' && resolved.page?.kind === 'contact')
    || (resolved.kind === 'home' && hasContactDetails);
  const sameAs = contactVisible
    ? [contact.instagramUrl, contact.facebookUrl, contact.googleBusinessUrl].map((value) => safeUrl(value, origin, false)).filter(Boolean)
    : [];
  const graph: Record<string, unknown>[] = [{
    '@type': 'Organization',
    '@id': `${businessUrl}#organization`,
    name: site.businessName,
    url: businessUrl,
    ...(contactVisible && contact.email ? { email: contact.email } : {}),
    ...(contactVisible && contact.phone ? { telephone: contact.phone } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }];
  if (contactVisible && (contact.address || contact.phone)) {
    const streetAddress = contact.address;
    graph.push({
      '@type': 'LocalBusiness',
      '@id': `${businessUrl}#local-business`,
      name: site.businessName,
      url: businessUrl,
      ...(contact.phone ? { telephone: contact.phone } : {}),
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.openingHours ? { openingHours: contact.openingHours } : {}),
      ...(contact.serviceArea ? { areaServed: contact.serviceArea } : {}),
      ...(streetAddress ? { address: {
        '@type': 'PostalAddress',
        streetAddress,
        ...(contact.city ? { addressLocality: contact.city } : {}),
        ...(contact.region ? { addressRegion: contact.region } : {}),
        ...(contact.postalCode ? { postalCode: contact.postalCode } : {}),
        ...(contact.country ? { addressCountry: contact.country } : {}),
      } } : {}),
    });
  }
  graph.push({
    '@type': 'WebSite',
    '@id': `${businessUrl}#website`,
    name: site.businessName,
    url: businessUrl,
    inLanguage: site.content.seo.language,
  });
  graph.push({
    '@type': 'WebPage',
    '@id': `${canonical}#webpage`,
    name: title,
    url: canonical,
    ...(description ? { description } : {}),
    inLanguage: site.content.seo.language,
    isPartOf: { '@id': `${businessUrl}#website` },
  });

  if (resolved.kind === 'item' && resolved.item) {
    const item = resolved.item;
    const image = safeImageUrl(item.imageUrl, origin);
    graph.push({
      '@type': item.kind === 'product' ? 'Product' : 'Service',
      '@id': `${origin}${itemPath(site, item)}#item`,
      name: item.name,
      url: `${origin}${itemPath(site, item)}`,
      ...(item.summary || item.description ? { description: item.summary || item.description } : {}),
      ...(item.category ? { category: item.category } : {}),
      ...(image ? { image } : {}),
      ...(item.kind === 'service' && (item.areaServed || contact.serviceArea) ? { areaServed: item.areaServed || contact.serviceArea } : {}),
      ...(item.kind === 'product' ? { brand: { '@id': `${businessUrl}#organization` } } : { provider: { '@id': `${businessUrl}#organization` } }),
    });
  }

  const breadcrumbs: Array<{ name: string; url: string }> = [{ name: site.businessName, url: businessUrl }];
  if (resolved.kind === 'directory') {
    breadcrumbs.push({ name: copy[site.content.seo.language].directory, url: `${businessUrl}/produtos-servicos` });
  } else if (resolved.kind === 'category') {
    breadcrumbs.push({ name: copy[site.content.seo.language].directory, url: `${businessUrl}/produtos-servicos` });
    breadcrumbs.push({ name: resolved.categoryName, url: `${businessUrl}/categoria/${encodeURIComponent(resolved.categoryItems[0]?.categorySlug || '')}` });
  } else if (resolved.kind === 'page' && resolved.page) {
    breadcrumbs.push({ name: resolved.page.title, url: `${businessUrl}/${resolved.page.slug}` });
  } else if (resolved.kind === 'item' && resolved.item) {
    if (resolved.item.category && resolved.item.categorySlug) {
      breadcrumbs.push({ name: resolved.item.category, url: `${businessUrl}/categoria/${encodeURIComponent(resolved.item.categorySlug)}` });
    }
    breadcrumbs.push({ name: resolved.item.name, url: `${origin}${itemPath(site, resolved.item)}` });
  }
  if (breadcrumbs.length > 1) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: crumb.url,
      })),
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
};

const pageBody = (site: PublicBusinessSite, resolved: ReturnType<typeof resolvePage>, origin: string, labels: typeof copy['en']) => {
  const { content } = site;
  if (resolved.kind === 'home') {
    const featured = content.items.filter((item) => item.enabled && item.featured).slice(0, 6);
    return `<section class="hero ${content.hero.imageUrl ? 'hero--image' : ''}" ${content.hero.imageUrl ? `style="--hero-image:url('${escapeHtml(safeImageUrl(content.hero.imageUrl, origin))}')"` : ''}>
      <div class="hero__content">
        ${content.hero.eyebrow ? `<p class="eyebrow">${escapeHtml(content.hero.eyebrow)}</p>` : ''}
        <h1>${escapeHtml(content.hero.title || site.businessName)}</h1>
        ${paragraphs(content.hero.description, 'hero__copy')}
        ${content.hero.ctaLabel ? `<a class="button button--primary" href="${escapeHtml(safeUrl(content.hero.ctaUrl, `${origin}/empresa/${site.slug}/contato`) || `${origin}/empresa/${site.slug}/contato`)}">${escapeHtml(content.hero.ctaLabel)}<span aria-hidden="true"> →</span></a>` : ''}
      </div>
    </section>
    ${content.about.body ? `<section class="section section--narrow"><p class="eyebrow">${labels.about}</p><h2>${escapeHtml(content.about.title)}</h2>${paragraphs(content.about.body)}</section>` : ''}
    ${featured.length ? `<section class="section section--soft"><div class="section-heading"><div><p class="eyebrow">${labels.featured}</p><h2>${labels.directory}</h2></div><a class="text-link" href="/empresa/${site.slug}/produtos-servicos">${labels.seeAll} →</a></div>${renderDirectory(site, origin, labels, featured)}</section>` : ''}
    ${(content.contact.phone || content.contact.email || content.contact.whatsapp || content.contact.address || content.contact.openingHours || content.contact.serviceArea || content.contact.googleBusinessUrl || content.contact.instagramUrl || content.contact.facebookUrl) ? `<section class="section section--narrow section--contact"><h2>${labels.contactCta}</h2>${renderContact(site, labels)}</section>` : ''}`;
  }
  if (resolved.kind === 'directory') {
    const items = content.items.filter((item) => item.enabled);
    const categories = [...new Map(items.filter((item) => item.category && item.categorySlug).map((item) => [item.categorySlug, item.category])).entries()];
    const categoryLinks = categories.length ? `<nav class="category-nav" aria-label="${labels.category}">${categories.map(([slug, name]) => `<a href="/empresa/${site.slug}/categoria/${escapeHtml(slug)}">${escapeHtml(name)}</a>`).join('')}</nav>` : '';
    return `<section class="section"><p class="eyebrow">${escapeHtml(site.businessName)}</p><h1>${labels.directory}</h1>${categoryLinks}${items.length ? renderDirectory(site, origin, labels, items) : `<p>${escapeHtml(content.about.body || site.businessName)}</p>`}</section>`;
  }
  if (resolved.kind === 'category') {
    return `<section class="section"><p class="eyebrow">${escapeHtml(site.businessName)} · ${labels.category}</p><h1>${escapeHtml(resolved.categoryName || labels.directory)}</h1>${renderDirectory(site, origin, labels, resolved.categoryItems)}</section>`;
  }
  if (resolved.kind === 'page' && resolved.page) {
    const page = resolved.page;
    if (page.kind === 'contact') {
      return `<section class="section section--narrow"><p class="eyebrow">${escapeHtml(site.businessName)}</p><h1>${escapeHtml(page.title)}</h1>${page.body ? paragraphs(page.body) : ''}${renderContact(site, labels)}${renderContactForm(site, labels)}</section>`;
    }
    if (page.kind === 'about') {
      return `<section class="section section--narrow"><p class="eyebrow">${escapeHtml(site.businessName)}</p><h1>${escapeHtml(page.title || content.about.title)}</h1>${paragraphs(page.body || content.about.body)}</section>`;
    }
    const featured = content.items.filter((item) => item.enabled && page.featuredItemIds.includes(item.id));
    const body = page.kind === 'faq'
      ? page.body.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `<details class="faq-item"><summary>${escapeHtml(line.split('?')[0] + (line.includes('?') ? '?' : ''))}</summary><p>${escapeHtml(line.includes('?') ? line.slice(line.indexOf('?') + 1).trim() : '')}</p></details>`).join('')
      : paragraphs(page.body);
    return `<section class="section section--narrow"><p class="eyebrow">${escapeHtml(site.businessName)}</p><h1>${escapeHtml(page.title)}</h1>${body}${featured.length ? `<div class="item-grid item-grid--featured">${featured.map((item) => renderItemCard(site, item, origin, labels)).join('')}</div>` : ''}</section>`;
  }
  if (resolved.kind === 'item' && resolved.item) {
    const item = resolved.item;
    const image = renderImage(item.imageUrl, item.name, origin, 'detail-image', true);
    const contactUrl = item.ctaUrl
      ? safeUrl(item.ctaUrl, origin)
      : content.contact.whatsapp.replace(/\D/g, '')
        ? `https://wa.me/${content.contact.whatsapp.replace(/\D/g, '')}`
        : content.contact.email ? `mailto:${content.contact.email}` : '';
    const otherItems = content.items.filter((entry) => entry.enabled && entry.id !== item.id && (item.category ? entry.category === item.category : entry.featured)).slice(0, 3);
    return `<article class="section item-detail"><div class="item-detail__grid">${image ? `<div>${image}</div>` : ''}<div>
      ${item.category ? `<p class="eyebrow">${escapeHtml(item.category)}</p>` : ''}<h1>${escapeHtml(item.name)}</h1>${item.summary ? `<p class="item-detail__summary">${escapeHtml(item.summary)}</p>` : ''}${paragraphs(item.description)}
      <dl class="item-facts">${item.priceLabel ? `<div><dt>${labels.price}</dt><dd>${escapeHtml(item.priceLabel)}</dd></div>` : ''}${item.duration ? `<div><dt>${labels.duration}</dt><dd>${escapeHtml(item.duration)}</dd></div>` : ''}${item.areaServed || content.contact.serviceArea ? `<div><dt>${labels.area}</dt><dd>${escapeHtml(item.areaServed || content.contact.serviceArea)}</dd></div>` : ''}</dl>
      ${contactUrl ? `<a class="button button--primary" href="${escapeHtml(contactUrl)}" rel="${contactUrl.startsWith('http') ? 'noopener noreferrer' : ''}">${escapeHtml(item.ctaLabel || labels.contactCta)}<span aria-hidden="true"> →</span></a>` : ''}
      </div></div>${otherItems.length ? `<section class="section section--related"><h2>${labels.featured}</h2>${renderDirectory(site, origin, labels, otherItems)}</section>` : ''}</article>`;
  }
  return `<section class="section section--narrow"><p class="eyebrow">${escapeHtml(site.businessName)}</p><h1>${labels.notFound}</h1><p>${labels.notFoundCopy}</p><a class="button button--primary" href="/empresa/${site.slug}">${labels.backHome}</a></section>`;
};

export const renderPublicBusinessSiteHtml = (
  site: PublicBusinessSite,
  route: string,
  origin: string,
  options: { preview?: boolean; leadState?: string | null } = {},
): { html: string; status: number; cacheTag: string } => {
  const content = site.content;
  const lang = content.seo.language || 'pt-BR';
  const labels = copy[lang];
  const resolved = resolvePage(content, route);
  const exists = resolved.kind !== 'missing' && (resolved.kind !== 'item' || Boolean(resolved.item));
  const selectedPage = resolved.page;
  const selectedItem = resolved.item;
  const canonicalPath = `/empresa/${site.slug}${resolved.route ? `/${resolved.route}` : ''}`;
  const canonical = `${origin}${canonicalPath}`;
  const pageTitle = resolved.kind === 'directory' ? labels.directory : resolved.kind === 'category' ? resolved.categoryName : '';
  const title = (selectedItem?.metaTitle || selectedPage?.metaTitle || (resolved.kind === 'home' ? content.seo.title || content.hero.title : selectedItem?.name || selectedPage?.title || pageTitle) || site.businessName).trim();
  const rawDescription = selectedItem?.metaDescription || selectedPage?.metaDescription
    || (resolved.kind === 'home' ? content.seo.description || content.hero.description
      : selectedItem?.summary || selectedPage?.body || (resolved.kind === 'category' ? `${labels.category}: ${resolved.categoryName}` : ''))
    || content.seo.description;
  const description = rawDescription.replace(/\s+/g, ' ').trim().slice(0, 320);
  const indexable = !options.preview && exists && content.seo.indexable && (selectedPage?.indexable ?? true) && (selectedItem?.indexable ?? true);
  const robots = indexable ? 'index,follow' : 'noindex,nofollow';
  const logo = safeImageUrl(content.branding.logoUrl, origin);
  const leadNotice = resolved.kind === 'page' && resolved.page?.kind === 'contact' && options.leadState
    ? `<p class="form-notice" role="status" aria-live="polite">${options.leadState === 'success' ? labels.contactSuccess : options.leadState === 'rate-limited' ? labels.contactRateLimited : labels.contactError}</p>`
    : '';
  const body = `${pageBody(site, resolved, origin, labels)}${leadNotice}`;
  const primaryColor = safeColor(content.branding.primaryColor, '#1d4ed8');
  const accentColor = safeColor(content.branding.accentColor, '#f59e0b');
  const jsonLd = exists ? buildJsonLd(site, origin, canonical, title, description, resolved) : '';
  const navPages = content.pages.filter((page) => page.enabled && page.showInNavigation);
  const dirLink = content.items.some((item) => item.enabled) ? `<a href="/empresa/${site.slug}/produtos-servicos">${labels.directory}</a>` : '';
  const nav = [`<a href="/empresa/${site.slug}">${labels.home}</a>`, dirLink, ...navPages.map((page) => `<a href="${escapeHtml(pagePath(site, page))}">${escapeHtml(page.title)}</a>`)].filter(Boolean).join('');
  const image = selectedItem?.imageUrl || (resolved.kind === 'home' ? content.hero.imageUrl : '');
  const ogImage = safeImageUrl(image || content.branding.logoUrl, origin);
  const schema = jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : '';

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${robots}">
<link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="${escapeHtml(site.businessName)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ''}
${schema}
<style>
:root{color-scheme:light;--primary:${primaryColor};--accent:${accentColor};--ink:#17191f;--muted:#626875;--surface:#fff;--soft:#f5f6f8;--line:#e5e7eb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);line-height:1.65}a{color:inherit}img{max-width:100%}.site-shell{min-height:100vh;display:flex;flex-direction:column}.site-header{position:relative;z-index:2;border-bottom:1px solid var(--line);background:#ffffffed;backdrop-filter:blur(12px)}.site-header__inner,.site-footer__inner{width:min(1160px,calc(100% - 40px));margin:auto;display:flex;align-items:center;justify-content:space-between;gap:24px}.site-header__inner{min-height:76px}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:750;font-size:1.1rem;letter-spacing:-.025em}.brand img{display:block;max-height:44px;max-width:180px;object-fit:contain}.site-nav{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px 22px}.site-nav a{text-decoration:none;font-size:.91rem;font-weight:600;color:var(--muted)}.site-nav a:hover,.text-link:hover{color:var(--primary)}main{flex:1}.hero{position:relative;isolation:isolate;min-height:460px;display:flex;align-items:center;overflow:hidden;background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 9%,white),white 60%,color-mix(in srgb,var(--accent) 13%,white));padding:72px max(24px,calc((100vw - 1160px)/2))}.hero--image:before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,#fffef9 0%,#fffef9ed 48%,#fffef977 100%),var(--hero-image) center/cover no-repeat;opacity:.95}.hero__content{max-width:680px}.eyebrow{text-transform:uppercase;letter-spacing:.17em;font-size:.72rem;font-weight:750;color:var(--primary);margin:0 0 14px}.hero h1,.section h1{font-size:clamp(2.35rem,6vw,4.65rem);letter-spacing:-.055em;line-height:1.02;margin:0 0 20px;max-width:15ch}.hero__copy{font-size:clamp(1.03rem,2vw,1.2rem);max-width:60ch;color:var(--muted);margin:0 0 28px}.button{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:700;transition:transform .15s ease,background .15s ease}.button:hover{transform:translateY(-1px)}.button--primary{background:var(--primary);color:white}.section{padding:72px max(24px,calc((100vw - 1160px)/2))}.section--narrow{max-width:820px;margin:auto;padding-left:24px;padding-right:24px}.section--soft{background:var(--soft)}.section--contact{border-top:1px solid var(--line)}.section h1,.section h2{font-size:clamp(1.9rem,4vw,3rem);letter-spacing:-.045em;line-height:1.1;margin:0 0 22px}.section p:not(.eyebrow){color:var(--muted);white-space:normal}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:28px}.section-heading h2{margin:0}.text-link{font-weight:700;text-decoration:none;color:var(--primary)}.item-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.item-card{overflow:hidden;border:1px solid var(--line);border-radius:18px;background:white;box-shadow:0 10px 32px #1018280a}.item-card__image-link{display:block;background:var(--soft)}.item-card__image{display:block;width:100%;height:210px;object-fit:cover}.item-card__placeholder{background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,white),color-mix(in srgb,var(--accent) 16%,white))}.item-card__body{padding:18px}.item-card h3{margin:0 0 8px;font-size:1.18rem;line-height:1.25}.item-card h3 a{text-decoration:none}.item-card p{margin:0 0 14px;color:var(--muted)}.item-card .eyebrow{font-size:.66rem;margin-bottom:8px}.item-card__price{font-weight:700!important;color:var(--ink)!important}.contact-grid{display:grid;gap:20px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:24px}.contact-grid p{margin:4px 0 0}.contact-label{font-size:.75rem;font-weight:750;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.contact-links{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:12px 20px}.contact-links a{color:var(--primary);font-weight:650}.item-detail__grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px;align-items:center}.detail-image{width:100%;max-height:560px;object-fit:cover;border-radius:24px}.item-detail h1{max-width:18ch}.item-detail__summary{font-size:1.2rem}.item-facts{display:flex;flex-wrap:wrap;gap:18px;margin:24px 0}.item-facts div{min-width:130px}.item-facts dt{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700}.item-facts dd{margin:2px 0 0;font-weight:700}.section--related{padding-left:0;padding-right:0}.faq-item{border-bottom:1px solid var(--line);padding:16px 0}.faq-item summary{font-weight:700;cursor:pointer}.faq-item p{margin-bottom:0}.site-footer{border-top:1px solid var(--line);background:#fafafa}.site-footer__inner{min-height:76px;color:var(--muted);font-size:.85rem}.site-footer a{font-weight:650}.site-footer__links{display:flex;flex-wrap:wrap;gap:16px}.site-footer__links a{text-decoration:none}.not-found{min-height:48vh;display:grid;align-content:center}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:760px){.site-header__inner{align-items:flex-start;flex-direction:column;padding:14px 0}.site-nav{justify-content:flex-start;gap:8px 15px}.site-nav a{font-size:.84rem}.hero{min-height:390px;padding:54px 24px}.section{padding-top:52px;padding-bottom:52px}.item-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.item-card__image{height:165px}.item-card__body{padding:14px}.item-detail__grid{grid-template-columns:1fr;gap:20px}.detail-image{max-height:360px}.site-footer__inner{align-items:flex-start;flex-direction:column;padding:20px 0}.contact-grid{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column}}@media(max-width:480px){.site-header__inner,.site-footer__inner{width:calc(100% - 28px)}.hero,.section{padding-left:16px;padding-right:16px}.item-grid{grid-template-columns:1fr}.item-card__image{height:220px}.site-nav{gap:7px 12px}}
.category-nav{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 28px}.category-nav a{padding:7px 12px;border:1px solid var(--line);border-radius:999px;color:var(--primary);font-size:.86rem;font-weight:650;text-decoration:none}
</style>
<style>
.contact-form-section{margin-top:38px}.contact-form{display:grid;gap:16px;margin-top:20px}.contact-form>label:not(.consent-field){display:grid;gap:6px;font-size:.92rem;font-weight:650}.contact-form input:not([type=checkbox]),.contact-form textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:white;padding:12px;font:inherit;color:var(--ink)}.contact-form textarea{resize:vertical}.contact-form .consent-field{display:flex;align-items:flex-start;gap:10px;font-size:.88rem;font-weight:400}.contact-form .consent-field input{margin-top:.32rem;accent-color:var(--primary)}.contact-form .consent-field a{margin-left:4px;color:var(--primary)}.contact-form .button{width:fit-content;border:0;cursor:pointer;font:inherit;font-weight:700}.form-notice{width:min(772px,calc(100% - 32px));margin:20px auto;padding:14px 18px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}.form-trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
</style>
</head>
<body>${options.preview ? `<div style="position:sticky;top:0;z-index:5;padding:10px 16px;background:#111827;color:white;text-align:center;font:600 13px/1.4 system-ui">PREVIEW — <a style="color:white" href="/site">${escapeHtml(lang === 'pt-BR' ? 'Voltar ao editor do site' : lang === 'es' ? 'Volver al editor del sitio' : 'Back to site editor')}</a></div>` : ''}<div class="site-shell">
<header class="site-header"><div class="site-header__inner"><a class="brand" href="/empresa/${site.slug}">${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(site.businessName)}">` : escapeHtml(site.businessName)}</a><nav class="site-nav" aria-label="${lang === 'pt-BR' ? 'Navegação principal' : lang === 'es' ? 'Navegación principal' : 'Main navigation'}">${nav}</nav></div></header>
<main>${exists ? body : `<section class="section section--narrow not-found"><p class="eyebrow">${escapeHtml(site.businessName)}</p><h1>${labels.notFound}</h1><p>${labels.notFoundCopy}</p><a class="button button--primary" href="/empresa/${site.slug}">${labels.backHome}</a></section>`}</main>
<footer class="site-footer"><div class="site-footer__inner"><span>© ${new Date().getUTCFullYear()} ${escapeHtml(site.businessName)}</span><nav class="site-footer__links" aria-label="${labels.privacy}">${content.pages.filter((page) => page.enabled && page.kind === 'privacy').map((page) => `<a href="${escapeHtml(pagePath(site, page))}">${escapeHtml(page.title || labels.privacy)}</a>`).join('')}<a href="${origin}">${escapeHtml('Stampfy')}</a></nav></div></footer>
</div></body></html>`;

  return { html, status: exists ? 200 : 404, cacheTag: `business-site-${site.slug}-${site.revision}` };
};
