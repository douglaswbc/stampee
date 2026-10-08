type ClaimedNotification = {
  outbox_id: string;
  owner_id: string;
  customer_id: string;
  customer_name: string;
  participant_id: string | null;
  account_id: string;
  event_type: string;
  template_name: string;
  template_language: string;
};

type IntegrationSecretRow = {
  owner_id: string;
  zernio_api_key_ciphertext: string | null;
  whatsapp_account_id: string | null;
};

const encoder = new TextEncoder();
const supabaseUrl = () => process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const workerSecret = () => process.env.COMMUNICATIONS_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim() || '';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const equalSecret = (left: string, right: string) => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
};

const restFetch = async (path: string, method = 'POST', body?: unknown) => {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error('server_config');
  const response = await fetch(url.replace(/\/+$/, '') + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error('database_request');
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
};

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const decryptSecret = async (ciphertext: string) => {
  const secret = process.env.ZERNIO_ENCRYPTION_KEY?.trim() || '';
  if (secret.length < 32) throw new Error('encryption_config');
  const [version, iv, encrypted] = ciphertext.split('.');
  if (version !== 'v1' || !iv || !encrypted) throw new Error('encrypted_key_invalid');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(iv) }, key, decodeBase64(encrypted));
  return new TextDecoder().decode(result);
};

const apiRequest = async (url: string, init: RequestInit, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    const error = new Error('network_error') as Error & { retryable?: boolean };
    error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parseObject = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
};

const templateComponents = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((component) => component && typeof component === 'object' ? [component as Record<string, unknown>] : []);
};

const hasTemplateVariables = (template: Record<string, unknown>) => {
  for (const component of templateComponents(template.components)) {
    const texts = [component.text];
    if (Array.isArray(component.buttons)) {
      for (const button of component.buttons) {
        if (button && typeof button === 'object') texts.push((button as Record<string, unknown>).url);
      }
    }
    for (const value of texts) {
      if (typeof value === 'string' && /\{\{[^{}]+\}\}/.test(value)) return true;
    }
  }
  return false;
};

const providerTemplate = async (apiKey: string, accountId: string, name: string, language: string) => {
  const url = 'https://zernio.com/api/v1/whatsapp/templates?accountId=' + encodeURIComponent(accountId);
  const response = await apiRequest(url, { headers: { Authorization: 'Bearer ' + apiKey } });
  const result = await parseObject(response);
  if (!response.ok) {
    const error = new Error('template_lookup_' + response.status) as Error & { retryable?: boolean };
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const container = result.data && typeof result.data === 'object'
    ? result.data as Record<string, unknown>
    : result;
  const rows = Array.isArray(result.templates) ? result.templates : Array.isArray(container.templates) ? container.templates : [];
  return rows.find((candidate) => candidate && typeof candidate === 'object'
    && (candidate as Record<string, unknown>).name === name
    && (candidate as Record<string, unknown>).language === language) as Record<string, unknown> | undefined;
};

const finish = async (
  id: string,
  outcome: 'sent' | 'retry' | 'failed' | 'skipped',
  errorCode?: string,
  messageId?: string,
  retryAfter = 60,
) => {
  await restFetch('rpc/finish_communication_notification', 'POST', {
    outbox_id_input: id,
    outcome_input: outcome,
    error_code_input: errorCode || null,
    provider_message_id_input: messageId || null,
    retry_after_seconds_input: retryAfter,
  });
};

const maySend = async (notification: ClaimedNotification) => restFetch('rpc/authorize_communication_notification', 'POST', {
  outbox_id_input: notification.outbox_id,
  account_id_input: notification.account_id,
  template_name_input: notification.template_name,
  template_language_input: notification.template_language,
}) as Promise<boolean>;

const processNotification = async (notification: ClaimedNotification) => {
  try {
    if (!await maySend(notification)) {
      await finish(notification.outbox_id, 'skipped', 'consent_or_mapping_revoked');
      return { outcome: 'skipped' };
    }
    if (!notification.participant_id || !/^[1-9]\d{9,14}$/.test(notification.participant_id)) {
      await finish(notification.outbox_id, 'skipped', 'invalid_recipient');
      return { outcome: 'skipped' };
    }

    const rows = await restFetch(
      'company_communication_integrations?owner_id=eq.' + encodeURIComponent(notification.owner_id) + '&select=owner_id,zernio_api_key_ciphertext,whatsapp_account_id',
      'GET',
    ) as IntegrationSecretRow[] | null;
    const integration = rows?.[0];
    if (!integration?.zernio_api_key_ciphertext || integration.whatsapp_account_id !== notification.account_id) {
      await finish(notification.outbox_id, 'failed', 'integration_missing');
      return { outcome: 'failed' };
    }

    const apiKey = await decryptSecret(integration.zernio_api_key_ciphertext);
    const template = await providerTemplate(apiKey, notification.account_id, notification.template_name, notification.template_language);
    if (!template || String(template.status || '').toUpperCase() !== 'APPROVED' || hasTemplateVariables(template)) {
      await finish(notification.outbox_id, 'skipped', 'template_not_approved_or_unsupported');
      return { outcome: 'skipped' };
    }
    if (!await maySend(notification)) {
      await finish(notification.outbox_id, 'skipped', 'consent_or_mapping_revoked');
      return { outcome: 'skipped' };
    }

    const response = await apiRequest('https://zernio.com/api/v1/inbox/conversations', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'stampfy-outbox-' + notification.outbox_id,
      },
      body: JSON.stringify({
        accountId: notification.account_id,
        participantId: notification.participant_id,
        templateName: notification.template_name,
        templateLanguage: notification.template_language,
        templateParams: [],
      }),
    });
    const result = await parseObject(response);
    if (response.ok) {
      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : result;
      await finish(notification.outbox_id, 'sent', undefined, typeof data.messageId === 'string' ? data.messageId : undefined);
      return { outcome: 'sent' };
    }

    const providerError = result.error && typeof result.error === 'object' ? result.error as Record<string, unknown> : result;
    const code = typeof providerError.code === 'string' ? providerError.code.slice(0, 100) : 'provider_http_' + response.status;
    const retryAfterHeader = Number(response.headers.get('retry-after') || 60);
    const retry = response.status === 429 || response.status >= 500;
    await finish(notification.outbox_id, retry ? 'retry' : 'failed', code, undefined, Number.isFinite(retryAfterHeader) ? retryAfterHeader : 60);
    return { outcome: retry ? 'retry' : 'failed' };
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]+$/i.test(error.message) ? error.message.slice(0, 100) : 'worker_error';
    const retryable = error instanceof Error && (error as Error & { retryable?: boolean }).retryable === true;
    try {
      await finish(notification.outbox_id, retryable ? 'retry' : 'failed', code);
    } catch {
      // The processing lease is reclaimed by the next worker run if the database is temporarily unavailable.
    }
    return { outcome: retryable ? 'retry' : 'failed' };
  }
};

export default {
  async fetch(request: Request) {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const expected = workerSecret();
    const authorization = request.headers.get('authorization') || '';
    const supplied = authorization.replace(/^Bearer\s+/i, '');
    if (expected.length < 16 || !equalSecret(expected, supplied)) return json({ error: 'Unauthorized.' }, 401);

    try {
      const claimed = await restFetch('rpc/claim_communication_notifications', 'POST') as ClaimedNotification[] | null;
      const notifications = Array.isArray(claimed) ? claimed : [];
      const results = [];
      for (const notification of notifications) results.push(await processNotification(notification));
      return json({
        claimed: notifications.length,
        sent: results.filter((result) => result.outcome === 'sent').length,
        failed: results.filter((result) => result.outcome === 'failed').length,
        skipped: results.filter((result) => result.outcome === 'skipped').length,
      });
    } catch {
      return json({ error: 'Notification worker could not process the queue.' }, 500);
    }
  },
};
