const ZERNIO_BASE = 'https://zernio.com/api/v1';
const encoder = new TextEncoder();

type IntegrationRow = {
  owner_id: string;
  zernio_api_key_ciphertext?: string | null;
  zernio_profile_id?: string | null;
  whatsapp_account_id?: string | null;
  whatsapp_display_name?: string | null;
  instagram_account_id?: string | null;
  instagram_username?: string | null;
  phone_country_code?: string | null;
};

class ApiFailure extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const readEnv = (key: string) => process.env[key]?.trim() || '';
const getSupabaseConfig = () => ({
  url: readEnv('SUPABASE_URL') || readEnv('VITE_SUPABASE_URL'),
  anon: readEnv('SUPABASE_ANON_KEY') || readEnv('VITE_SUPABASE_ANON_KEY'),
  service: readEnv('SUPABASE_SERVICE_ROLE_KEY'),
});

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const encryptionKey = async () => {
  const secret = readEnv('ZERNIO_ENCRYPTION_KEY');
  if (secret.length < 32) throw new ApiFailure('Server encryption is not configured.', 503);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

const encryptSecret = async (secret: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(secret));
  return 'v1.' + toBase64(iv) + '.' + toBase64(new Uint8Array(encrypted));
};

const decryptSecret = async (ciphertext: string) => {
  const [version, ivText, dataText] = ciphertext.split('.');
  if (version !== 'v1' || !ivText || !dataText) throw new ApiFailure('Stored provider credential cannot be read.', 503);
  try {
    const key = await encryptionKey();
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivText) }, key, fromBase64(dataText));
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new ApiFailure('Stored provider credential cannot be read. Check ZERNIO_ENCRYPTION_KEY.', 503);
  }
};

const timeoutFetch = async (input: string, init: RequestInit = {}, milliseconds = 12000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const restRequest = async <T,>(path: string, method: string, body?: unknown, config = getSupabaseConfig()): Promise<T> => {
  if (!config.url || !config.service) throw new ApiFailure('Server Supabase credentials are not configured.', 503);
  const response = await timeoutFetch(config.url.replace(/\/+$/, '') + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: config.service,
      Authorization: 'Bearer ' + config.service,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({})) as { code?: string };
    if (details.code === 'PGRST205' || details.code === '42P01') {
      throw new ApiFailure('Apply the add_communications_zernio.sql patch in Supabase, then reload this page.', 503);
    }
    throw new ApiFailure('Could not save communication settings.', 502);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
};

const getOwnerContext = async (request: Request) => {
  const config = getSupabaseConfig();
  if (!config.url || !config.anon || !config.service) throw new ApiFailure('Server Supabase credentials are not configured.', 503);
  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) throw new ApiFailure('Sign in as the business owner to manage integrations.', 401);
  const userResponse = await timeoutFetch(config.url.replace(/\/+$/, '') + '/auth/v1/user', {
    headers: { apikey: config.anon, Authorization: 'Bearer ' + tokenMatch[1] },
  });
  if (!userResponse.ok) throw new ApiFailure('Your session expired. Sign in again.', 401);
  const user = await userResponse.json() as { id?: string };
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) throw new ApiFailure('Your session is invalid.', 401);

  const profiles = await restRequest<Array<{ id: string; role: string; access: string; business_name?: string }>>(
    'profiles?id=eq.' + encodeURIComponent(user.id) + '&select=id,role,access,business_name',
    'GET',
    undefined,
    config,
  );
  const profile = profiles[0];
  if (!profile || profile.role !== 'owner' || profile.access !== 'active') {
    throw new ApiFailure('Only an active business owner can manage these integrations.', 403);
  }

  const integrations = await restRequest<IntegrationRow[]>(
    'company_communication_integrations?owner_id=eq.' + encodeURIComponent(user.id) + '&select=*',
    'GET',
    undefined,
    config,
  );
  return {
    ownerId: user.id,
    businessName: profile.business_name || 'My business',
    config,
    integration: integrations[0] || ({ owner_id: user.id } as IntegrationRow),
  };
};

const saveIntegration = async (ownerId: string, existing: IntegrationRow, patch: Partial<IntegrationRow>) => {
  const saved = await restRequest<IntegrationRow[]>(
    'company_communication_integrations?on_conflict=owner_id',
    'POST',
    { ...existing, ...patch, owner_id: ownerId, updated_at: new Date().toISOString() },
  );
  return saved[0] || { ...existing, ...patch, owner_id: ownerId };
};

const providerRequest = async (apiKey: string, path: string, init: RequestInit = {}) => {
  let response: Response;
  try {
    response = await timeoutFetch(ZERNIO_BASE + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new ApiFailure('Zernio is temporarily unavailable. Try again.', 502);
  }
  if (!response.ok) {
    const parsedErrorPayload = await response.json().catch(() => null);
    const errorPayload = parsedErrorPayload && typeof parsedErrorPayload === 'object' && !Array.isArray(parsedErrorPayload)
      ? parsedErrorPayload as {
          code?: unknown;
          message?: unknown;
          error?: unknown;
          error_message?: unknown;
      }
      : {};
    const nestedError = errorPayload.error && typeof errorPayload.error === 'object'
      ? errorPayload.error as { code?: unknown; message?: unknown }
      : null;
    const rawProviderCode = errorPayload.code ?? nestedError?.code;
    const providerCode = typeof rawProviderCode === 'string' && /^[a-z0-9_-]{1,80}$/i.test(rawProviderCode)
      ? rawProviderCode.toLowerCase()
      : '';
    const providerMessage = [errorPayload.message, errorPayload.error_message, errorPayload.error, nestedError?.message]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (providerCode === 'instagramloginmethod_mismatch') {
      throw new ApiFailure('This Instagram account is already connected to the selected Zernio profile with a different login method. Disconnect it in Zernio first, then try again.', 409);
    }
    if (response.status === 401 || response.status === 403) throw new ApiFailure('Zernio rejected the stored API key or its permissions.', 400);
    if (response.status === 429) throw new ApiFailure('Zernio rate limit reached. Try again shortly.', 429);
    const detail = providerMessage?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (detail) {
      throw new ApiFailure('Zernio rejected the request (HTTP ' + response.status + (providerCode ? ', ' + providerCode : '') + '): ' + detail, 502);
    }
    throw new ApiFailure('The Zernio request failed. Check the selected profile and account, then try again.', 502);
  }
  if (response.status === 204) return {};
  try {
    const payload = await response.text();
    return payload ? JSON.parse(payload) as Record<string, unknown> : {};
  } catch {
    throw new ApiFailure('Zernio returned an invalid response.', 502);
  }
};

const disconnectProviderAccount = async (apiKey: string, accountId: string) => {
  let response: Response;
  try {
    response = await timeoutFetch(ZERNIO_BASE + '/accounts/' + encodeURIComponent(accountId), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + apiKey },
    });
  } catch {
    throw new ApiFailure('Zernio is temporarily unavailable. Try again.', 502);
  }
  // Zernio returns 404 when the account has already been disconnected.
  if (response.ok || response.status === 404) return;
  if (response.status === 401 || response.status === 403) {
    throw new ApiFailure('Zernio rejected the stored API key or its permissions.', 400);
  }
  if (response.status === 429) throw new ApiFailure('Zernio rate limit reached. Try again shortly.', 429);
  throw new ApiFailure('Could not disconnect the account from Zernio. Try again.', 502);
};

const listFrom = (value: unknown, keys: string[]) => {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key] as Array<Record<string, unknown>>;
  }
  if (object.data && typeof object.data === 'object') {
    const nested = object.data as Record<string, unknown>;
    for (const key of keys) if (Array.isArray(nested[key])) return nested[key] as Array<Record<string, unknown>>;
  }
  return [];
};

const normalizeProfiles = (response: Record<string, unknown>) => listFrom(response, ['profiles']).flatMap((item) => {
  const id = typeof item._id === 'string' ? item._id : typeof item.id === 'string' ? item.id : '';
  const name = typeof item.name === 'string' ? item.name : 'Zernio profile';
  return /^[0-9a-f]{24}$/i.test(id) ? [{ id, name }] : [];
});

const normalizeAccounts = (response: Record<string, unknown>) => listFrom(response, ['accounts']).flatMap((item) => {
  const id = typeof item._id === 'string' ? item._id : typeof item.id === 'string' ? item.id : '';
  const platform = typeof item.platform === 'string' ? item.platform : '';
  if (!id || (platform !== 'whatsapp' && platform !== 'instagram')) return [];
  return [{
    id,
    platform,
    username: typeof item.username === 'string' ? item.username : '',
    displayName: typeof item.displayName === 'string' ? item.displayName : '',
    isActive: item.isActive !== false,
  }];
});

const getProviderKey = async (integration: IntegrationRow) => {
  if (!integration.zernio_api_key_ciphertext) throw new ApiFailure('Add and verify a Zernio API key first.', 400);
  return decryptSecret(integration.zernio_api_key_ciphertext);
};

const eventTypes = new Set(['visit_validated', 'mission_completed', 'reward_claimed']);
const extractTemplateParameterCount = (template: Record<string, unknown>) => {
  const components = Array.isArray(template.components) ? template.components : [];
  let count = 0;
  for (const component of components) {
    if (!component || typeof component !== 'object') continue;
    const item = component as Record<string, unknown>;
    const searchable = [item.text, ...(Array.isArray(item.buttons) ? item.buttons.flatMap((button) => button && typeof button === 'object' ? [(button as Record<string, unknown>).url] : []) : [])];
    for (const text of searchable) {
      if (typeof text === 'string') count += [...text.matchAll(/\{\{[^{}]+\}\}/g)].length;
    }
  }
  return count;
};

const loadTemplates = async (apiKey: string, accountId: string) => {
  const response = await providerRequest(apiKey, '/whatsapp/templates?accountId=' + encodeURIComponent(accountId));
  return listFrom(response, ['templates']).map((item) => ({
    id: typeof item.id === 'string' ? item.id : typeof item.metaTemplateId === 'string' ? item.metaTemplateId : '',
    name: typeof item.name === 'string' ? item.name : '',
    language: typeof item.language === 'string' ? item.language : '',
    status: typeof item.status === 'string' ? item.status.toUpperCase() : 'UNKNOWN',
    category: typeof item.category === 'string' ? item.category : '',
    parameterCount: extractTemplateParameterCount(item),
    components: Array.isArray(item.components) ? item.components : [],
  })).filter((item) => item.name && item.language);
};

const templateFromResponse = (response: Record<string, unknown>) => {
  if (response.template && typeof response.template === 'object') return response.template as Record<string, unknown>;
  const data = response.data;
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    if (nested.template && typeof nested.template === 'object') return nested.template as Record<string, unknown>;
  }
  return response;
};

const validTemplateLanguage = (language: string) => /^[a-z]{2,3}(?:_[A-Z]{2,3})?$/.test(language);
const containsTemplateVariables = (text: string) => /\{\{[^{}]+\}\}/.test(text);

const ownerMappings = async (ownerId: string) => restRequest<Array<Record<string, unknown>>>(
  'company_notification_templates?owner_id=eq.' + encodeURIComponent(ownerId) + '&select=event_type,template_name,template_language,template_status,template_parameter_count,enabled,account_id',
  'GET',
);

const handleAction = async (request: Request, body: Record<string, unknown>) => {
  const context = await getOwnerContext(request);
  const { ownerId, businessName, integration } = context;
  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'status') {
    const mappings = await ownerMappings(ownerId);
    const notifications = await restRequest<Array<Record<string, unknown>>>(
      'communication_notification_outbox?owner_id=eq.' + encodeURIComponent(ownerId) + '&select=id,event_type,status,attempt_count,last_error_code,created_at,sent_at&order=created_at.desc&limit=50',
      'GET',
    );
    const attempts = await restRequest<Array<Record<string, unknown>>>(
      'communication_notification_attempts?owner_id=eq.' + encodeURIComponent(ownerId) + '&select=id,outbox_id,attempt_number,outcome,error_code,created_at&order=created_at.desc&limit=100',
      'GET',
    );
    const { zernio_api_key_ciphertext: _secret, ...safeIntegration } = integration;
    return respond({ integration: { ...safeIntegration, hasZernioKey: Boolean(integration.zernio_api_key_ciphertext) }, mappings, notifications, attempts });
  }

  if (action === 'save_key') {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!/^sk_[0-9a-f]{64}$/i.test(apiKey)) throw new ApiFailure('Enter a valid Zernio API key.');
    let profiles = normalizeProfiles(await providerRequest(apiKey, '/profiles'));
    let createdProfile = false;
    if (!profiles.length) {
      const created = await providerRequest(apiKey, '/profiles', {
        method: 'POST',
        body: JSON.stringify({ name: 'Stampfy - ' + businessName.slice(0, 70) }),
      });
      const profileValue = created.profile && typeof created.profile === 'object'
        ? created.profile as Record<string, unknown>
        : created.data && typeof created.data === 'object' && (created.data as Record<string, unknown>).profile
          ? (created.data as Record<string, unknown>).profile as Record<string, unknown>
          : {};
      const profileId = typeof profileValue._id === 'string' ? profileValue._id : typeof profileValue.id === 'string' ? profileValue.id : '';
      if (/^[0-9a-f]{24}$/i.test(profileId)) {
        profiles = [{ id: profileId, name: typeof profileValue.name === 'string' ? profileValue.name : 'Stampfy - ' + businessName }];
        createdProfile = true;
      }
    }
    if (!profiles.length) throw new ApiFailure('The Zernio key was accepted, but no accessible profile was found.');
    await saveIntegration(ownerId, integration, {
      zernio_api_key_ciphertext: await encryptSecret(apiKey),
      zernio_profile_id: createdProfile || profiles.length === 1 ? profiles[0].id : null,
      whatsapp_account_id: null,
      whatsapp_display_name: null,
      instagram_account_id: null,
      instagram_username: null,
    });
    return respond({ profiles });
  }

  if (action === 'disconnect') {
    const apiKey = await getProviderKey(integration);
    const connectedAccounts = [
      { channel: 'whatsapp', id: integration.whatsapp_account_id },
      { channel: 'instagram', id: integration.instagram_account_id },
    ].filter((account): account is { channel: 'whatsapp' | 'instagram'; id: string } => Boolean(account.id));
    const disconnectedChannels: Array<'whatsapp' | 'instagram'> = [];

    for (const account of connectedAccounts) {
      try {
        await disconnectProviderAccount(apiKey, account.id);
        disconnectedChannels.push(account.channel);
      } catch (error) {
        if (disconnectedChannels.length) {
          const partialPatch: Partial<IntegrationRow> = {};
          if (disconnectedChannels.includes('whatsapp')) {
            partialPatch.whatsapp_account_id = null;
            partialPatch.whatsapp_display_name = null;
          }
          if (disconnectedChannels.includes('instagram')) {
            partialPatch.instagram_account_id = null;
            partialPatch.instagram_username = null;
          }
          await saveIntegration(ownerId, integration, partialPatch);
          if (disconnectedChannels.includes('whatsapp')) {
            await restRequest(
              'company_notification_templates?owner_id=eq.' + encodeURIComponent(ownerId),
              'PATCH',
              { enabled: false, updated_at: new Date().toISOString() },
            );
            await restRequest(
              'communication_notification_outbox?owner_id=eq.' + encodeURIComponent(ownerId) + '&status=eq.pending',
              'PATCH',
              { status: 'skipped', locked_at: null, last_error_code: 'integration_disconnected' },
            );
          }
          throw new ApiFailure('Some accounts were disconnected, but another account could not be disconnected. Refresh settings and try again.', 502);
        }
        throw error;
      }
    }

    await saveIntegration(ownerId, integration, {
      zernio_api_key_ciphertext: null,
      zernio_profile_id: null,
      whatsapp_account_id: null,
      whatsapp_display_name: null,
      instagram_account_id: null,
      instagram_username: null,
    });
    await restRequest(
      'company_notification_templates?owner_id=eq.' + encodeURIComponent(ownerId),
      'PATCH',
      { enabled: false, updated_at: new Date().toISOString() },
    );
    await restRequest(
      'communication_notification_outbox?owner_id=eq.' + encodeURIComponent(ownerId) + '&status=eq.pending',
      'PATCH',
      { status: 'skipped', locked_at: null, last_error_code: 'integration_disconnected' },
    );
    return respond({ ok: true });
  }

  if (action === 'disconnect_channel') {
    const channel = body.channel === 'whatsapp' || body.channel === 'instagram' ? body.channel : null;
    if (!channel) throw new ApiFailure('Choose a valid social account to disconnect.');

    const accountId = channel === 'whatsapp' ? integration.whatsapp_account_id : integration.instagram_account_id;
    if (!accountId) throw new ApiFailure('That social account is not connected.', 409);

    const apiKey = await getProviderKey(integration);
    await disconnectProviderAccount(apiKey, accountId);

    if (channel === 'whatsapp') {
      await saveIntegration(ownerId, integration, {
        whatsapp_account_id: null,
        whatsapp_display_name: null,
      });
      await restRequest(
        'company_notification_templates?owner_id=eq.' + encodeURIComponent(ownerId),
        'PATCH',
        { enabled: false, updated_at: new Date().toISOString() },
      );
      await restRequest(
        'communication_notification_outbox?owner_id=eq.' + encodeURIComponent(ownerId) + '&status=eq.pending',
        'PATCH',
        { status: 'skipped', locked_at: null, last_error_code: 'integration_disconnected' },
      );
    } else {
      await saveIntegration(ownerId, integration, {
        instagram_account_id: null,
        instagram_username: null,
      });
    }

    return respond({ ok: true, channel });
  }

  const apiKey = await getProviderKey(integration);

  if (action === 'profiles') {
    return respond({ profiles: normalizeProfiles(await providerRequest(apiKey, '/profiles')) });
  }

  if (action === 'set_profile') {
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';
    if (!/^[0-9a-f]{24}$/i.test(profileId)) throw new ApiFailure('Choose a valid Zernio profile.');
    const profiles = normalizeProfiles(await providerRequest(apiKey, '/profiles'));
    if (!profiles.some((profile) => profile.id === profileId)) throw new ApiFailure('That profile is not accessible with this Zernio key.', 403);
    await saveIntegration(ownerId, integration, {
      zernio_profile_id: profileId,
      whatsapp_account_id: null,
      whatsapp_display_name: null,
      instagram_account_id: null,
      instagram_username: null,
    });
    return respond({ ok: true, profileId });
  }

  if (action === 'set_country_code') {
    const code = typeof body.countryCode === 'string' ? body.countryCode.replace(/\D/g, '') : '';
    if (!/^[0-9]{1,3}$/.test(code)) throw new ApiFailure('Enter an international calling code using 1 to 3 digits.');
    await saveIntegration(ownerId, integration, { phone_country_code: code });
    return respond({ ok: true, countryCode: code });
  }

  if (action === 'connect_url') {
    const channel = body.channel === 'instagram' ? 'instagram' : body.channel === 'whatsapp' ? 'whatsapp' : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';
    if (!channel || !/^[0-9a-f]{24}$/i.test(profileId) || profileId !== integration.zernio_profile_id) {
      throw new ApiFailure('Select the saved Zernio profile before connecting a channel.');
    }
    const profiles = normalizeProfiles(await providerRequest(apiKey, '/profiles'));
    if (!profiles.some((profile) => profile.id === profileId)) throw new ApiFailure('The selected Zernio profile is no longer accessible.', 403);
    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = readEnv('APP_ORIGIN');
    const redirectOrigin = configuredOrigin ? new URL(configuredOrigin).origin : requestOrigin;
    if (!/^https?:$/.test(new URL(redirectOrigin).protocol)) throw new ApiFailure('The site callback URL is not configured.', 503);
    const redirectUrl = new URL('/settings?tab=communications', redirectOrigin).toString();
    const query = new URLSearchParams({ profileId, redirect_url: redirectUrl });
    if (channel === 'instagram') query.set('loginMethod', 'instagram_login');
    const response = await providerRequest(apiKey, '/connect/' + channel + '?' + query.toString());
    const authUrl = typeof response.authUrl === 'string' ? response.authUrl : '';
    if (!/^https:\/\//i.test(authUrl)) throw new ApiFailure('Zernio did not return a secure authorization link.', 502);
    return respond({ authUrl });
  }

  if (action === 'finish_callback') {
    const channel = body.channel === 'instagram' ? 'instagram' : body.channel === 'whatsapp' ? 'whatsapp' : '';
    const connected = typeof body.connected === 'string' ? body.connected : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    if (!channel || connected !== channel || profileId !== integration.zernio_profile_id || !accountId) {
      throw new ApiFailure('The provider callback could not be verified.');
    }
    const accountsResponse = await providerRequest(apiKey, '/accounts?profileId=' + encodeURIComponent(profileId));
    const account = normalizeAccounts(accountsResponse).find((candidate) => candidate.id === accountId && candidate.platform === channel && candidate.isActive);
    if (!account) throw new ApiFailure('That account is not connected to the selected Zernio profile.', 403);

    const patch: Partial<IntegrationRow> = channel === 'whatsapp'
      ? { whatsapp_account_id: account.id, whatsapp_display_name: account.displayName || account.username }
      : { instagram_account_id: account.id, instagram_username: account.username || account.displayName };
    await saveIntegration(ownerId, integration, patch);
    return respond({ ok: true, channel, account });
  }

  if (action === 'list_templates') {
    if (!integration.whatsapp_account_id) throw new ApiFailure('Connect a WhatsApp Business account first.');
    return respond({
      templates: await loadTemplates(apiKey, integration.whatsapp_account_id),
      mappings: await ownerMappings(ownerId),
    });
  }

  if (action === 'create_template') {
    if (!integration.whatsapp_account_id) throw new ApiFailure('Connect a WhatsApp Business account first.');
    const name = typeof body.templateName === 'string' ? body.templateName.trim() : '';
    const language = typeof body.templateLanguage === 'string' ? body.templateLanguage.trim() : '';
    const category = typeof body.category === 'string' ? body.category.toUpperCase() : '';
    const text = typeof body.bodyText === 'string' ? body.bodyText.trim() : '';
    if (!/^[a-z][a-z0-9_]{0,511}$/.test(name)) throw new ApiFailure('Use a template name with lowercase letters, numbers, or underscores, starting with a letter.');
    if (!validTemplateLanguage(language)) throw new ApiFailure('Enter a valid template language code, such as pt_BR, en, or es.');
    if (!['UTILITY', 'MARKETING'].includes(category)) throw new ApiFailure('Choose a utility or marketing template category.');
    if (!text || text.length > 1024 || containsTemplateVariables(text)) throw new ApiFailure('Enter a text-only message of up to 1024 characters without variables.');

    const created = await providerRequest(apiKey, '/whatsapp/templates', {
      method: 'POST',
      body: JSON.stringify({
        accountId: integration.whatsapp_account_id,
        name,
        category,
        language,
        components: [{ type: 'body', text }],
      }),
    });
    return respond({ ok: true, template: templateFromResponse(created) });
  }

  if (action === 'update_template') {
    if (!integration.whatsapp_account_id) throw new ApiFailure('Connect a WhatsApp Business account first.');
    const name = typeof body.templateName === 'string' ? body.templateName.trim() : '';
    const language = typeof body.templateLanguage === 'string' ? body.templateLanguage.trim() : '';
    const text = typeof body.bodyText === 'string' ? body.bodyText.trim() : '';
    if (!/^[a-z][a-z0-9_]{0,511}$/.test(name) || !validTemplateLanguage(language)) throw new ApiFailure('Choose an exact WhatsApp template name and language.');
    if (!text || text.length > 1024 || containsTemplateVariables(text)) throw new ApiFailure('Enter a text-only message of up to 1024 characters without variables.');

    const selected = (await loadTemplates(apiKey, integration.whatsapp_account_id))
      .find((template) => template.name === name && template.language === language);
    if (!selected) throw new ApiFailure('That template variant was not found on the connected WhatsApp account.');
    if (!['APPROVED', 'REJECTED', 'PAUSED'].includes(selected.status)) throw new ApiFailure('This template cannot be edited while Meta is reviewing or removing it.');
    const components = selected.components as Array<Record<string, unknown>>;
    if (components.length !== 1 || String(components[0]?.type || '').toUpperCase() !== 'BODY' || typeof components[0]?.text !== 'string') {
      throw new ApiFailure('Only simple text-only templates can be edited here.');
    }

    const updated = await providerRequest(apiKey, '/whatsapp/templates/' + encodeURIComponent(name), {
      method: 'PATCH',
      body: JSON.stringify({
        accountId: integration.whatsapp_account_id,
        language,
        components: [{ type: 'body', text }],
      }),
    });
    try {
      await restRequest(
        'company_notification_templates?owner_id=eq.' + encodeURIComponent(ownerId)
          + '&account_id=eq.' + encodeURIComponent(integration.whatsapp_account_id)
          + '&template_name=eq.' + encodeURIComponent(name)
          + '&template_language=eq.' + encodeURIComponent(language),
        'PATCH',
        { template_status: 'PENDING', enabled: false, updated_at: new Date().toISOString() },
      );
    } catch {
      throw new ApiFailure('The template was updated on WhatsApp, but Stampfy could not disable its notification mapping. Refresh the settings before enabling it again.', 502);
    }
    return respond({ ok: true, template: templateFromResponse(updated), reviewRequired: true });
  }

  if (action === 'delete_template') {
    if (!integration.whatsapp_account_id) throw new ApiFailure('Connect a WhatsApp Business account first.');
    const name = typeof body.templateName === 'string' ? body.templateName.trim() : '';
    const language = typeof body.templateLanguage === 'string' ? body.templateLanguage.trim() : '';
    if (!/^[a-z][a-z0-9_]{0,511}$/.test(name) || !validTemplateLanguage(language)) throw new ApiFailure('Choose an exact WhatsApp template name and language.');
    const selected = (await loadTemplates(apiKey, integration.whatsapp_account_id))
      .find((template) => template.name === name && template.language === language);
    if (!selected) throw new ApiFailure('That template variant was not found on the connected WhatsApp account.');

    const query = new URLSearchParams({ accountId: integration.whatsapp_account_id, language });
    const deleted = await providerRequest(apiKey, '/whatsapp/templates/' + encodeURIComponent(name) + '?' + query.toString(), { method: 'DELETE' });
    try {
      await restRequest(
        'company_notification_templates?owner_id=eq.' + encodeURIComponent(ownerId)
          + '&account_id=eq.' + encodeURIComponent(integration.whatsapp_account_id)
          + '&template_name=eq.' + encodeURIComponent(name)
          + '&template_language=eq.' + encodeURIComponent(language),
        'PATCH',
        { template_status: 'PENDING_DELETION', enabled: false, updated_at: new Date().toISOString() },
      );
    } catch {
      throw new ApiFailure('The deletion was requested from WhatsApp, but Stampfy could not disable its notification mapping. Refresh the settings before enabling it again.', 502);
    }
    return respond({ ok: true, template: templateFromResponse(deleted), deletionPending: true });
  }

  if (action === 'save_notification_template') {
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';
    const name = typeof body.templateName === 'string' ? body.templateName : '';
    const language = typeof body.templateLanguage === 'string' ? body.templateLanguage : '';
    const enabledRequested = body.enabled === true;
    if (!eventTypes.has(eventType) || !name || !language || !integration.whatsapp_account_id) {
      throw new ApiFailure('Choose a notification event and an exact WhatsApp template variant.');
    }
    const remoteTemplates = await loadTemplates(apiKey, integration.whatsapp_account_id);
    const selected = remoteTemplates.find((template) => template.name === name && template.language === language);
    if (!selected) throw new ApiFailure('That template variant was not found on the connected WhatsApp account.');
    const enabled = enabledRequested && selected.status === 'APPROVED' && selected.parameterCount === 0;
    await restRequest(
      'company_notification_templates?on_conflict=owner_id,event_type',
      'POST',
      {
        owner_id: ownerId,
        event_type: eventType,
        account_id: integration.whatsapp_account_id,
        template_name: name,
        template_language: language,
        template_status: selected.status,
        template_parameter_count: selected.parameterCount,
        enabled,
        updated_at: new Date().toISOString(),
      },
    );
    return respond({ ok: true, enabled, template: selected });
  }

  if (action === 'retry_notification') {
    const outboxId = typeof body.outboxId === 'string' ? body.outboxId : '';
    if (!/^[0-9a-f-]{36}$/i.test(outboxId)) throw new ApiFailure('Choose a valid notification to retry.');
    const requeued = await restRequest<Array<{ id: string }>>(
      'communication_notification_outbox?id=eq.' + encodeURIComponent(outboxId)
        + '&owner_id=eq.' + encodeURIComponent(ownerId) + '&status=eq.failed',
      'PATCH',
      { status: 'pending', attempt_count: 0, next_attempt_at: new Date().toISOString(), locked_at: null, last_error_code: null },
    );
    if (!requeued?.length) throw new ApiFailure('This notification is no longer available to retry.', 409);
    return respond({ ok: true });
  }

  throw new ApiFailure('Unknown communication action.', 404);
};

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      return respond({ error: 'Expected a JSON request.' }, 415);
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 32 * 1024) return respond({ error: 'Request too large.' }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json() as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return respond({ error: 'Invalid request body.' }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return respond({ error: 'Invalid request body.' }, 400);
    }
    if (typeof body.apiKey === 'string' && body.apiKey.length > 1024) return respond({ error: 'The provider key is too long.' }, 400);
    try {
      return await handleAction(request, body);
    } catch (error) {
      if (error instanceof ApiFailure) return respond({ error: error.message }, error.status);
      return respond({ error: 'Communication settings could not be processed.' }, 500);
    }
  },
};
