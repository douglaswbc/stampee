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

const eventVariableKeys: Record<string, Set<string>> = {
  visit_validated: new Set(['customer_name', 'business_name', 'campaign_name', 'stamps', 'total_stamps', 'stamps_remaining', 'visit_date']),
  mission_completed: new Set(['customer_name', 'business_name', 'mission_name', 'mission_reward', 'completion_number']),
  reward_claimed: new Set(['customer_name', 'business_name', 'reward_name', 'redemption_code', 'reward_expires_at']),
  return_reminder: new Set(['customer_name', 'business_name', 'campaign_name']),
  mission_reminder: new Set(['customer_name', 'business_name', 'campaign_name', 'mission_name', 'mission_progress', 'mission_goal']),
  reward_expiring: new Set(['customer_name', 'business_name', 'campaign_name', 'reward_name', 'redemption_code', 'reward_expires_at', 'days_remaining']),
};

const readFirst = async <T = Record<string, unknown>>(path: string) => {
  const rows = await restFetch(path, 'GET') as T[] | null;
  return rows?.[0] ?? null;
};

const loadEventVariables = async (
  notification: ClaimedNotification,
  eventKey: string,
  requiredKeys: string[],
  reminderContext?: { campaign_id: string | null; card_id: string | null; reminder_subject_id: string | null; activity_snapshot_at: string | null },
) => {
  const values: Record<string, string> = {};
  if (requiredKeys.includes('customer_name')) values.customer_name = notification.customer_name || '';
  if (requiredKeys.includes('business_name')) {
    const profile = await readFirst<{ business_name: string }>(
      'profiles?id=eq.' + encodeURIComponent(notification.owner_id) + '&select=business_name',
    );
    values.business_name = profile?.business_name || '';
  }

  if (notification.event_type === 'visit_validated') {
    const match = /^visit:([0-9a-f-]{36})$/i.exec(eventKey);
    if (!match) return null;
    const transaction = await readFirst<{ card_id: string; date: string }>(
      'transactions?id=eq.' + encodeURIComponent(match[1]) + '&select=card_id,date',
    );
    if (!transaction?.card_id) return null;
    const card = await readFirst<{ campaign_name: string; stamps: number; campaign_id: string | null }>(
      'issued_cards?id=eq.' + encodeURIComponent(transaction.card_id)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id)
        + '&customer_id=eq.' + encodeURIComponent(notification.customer_id)
        + '&select=campaign_name,stamps,campaign_id',
    );
    if (!card) return null;
    const campaign = card.campaign_id ? await readFirst<{ name: string; total_stamps: number }>(
      'campaigns?id=eq.' + encodeURIComponent(card.campaign_id)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id)
        + '&select=name,total_stamps',
    ) : null;
    const total = Number(campaign?.total_stamps || 0);
    const stamps = Number(card.stamps || 0);
    values.campaign_name = card.campaign_name || campaign?.name || '';
    values.stamps = String(stamps);
    values.total_stamps = String(total);
    values.stamps_remaining = String(Math.max(0, total - stamps));
    values.visit_date = transaction.date || '';
  } else if (notification.event_type === 'mission_completed') {
    const match = /^mission:([0-9a-f-]{36})$/i.exec(eventKey);
    if (!match) return null;
    const completion = await readFirst<{ mission_id: string; reward_description: string; completion_number: number }>(
      'mission_completions?id=eq.' + encodeURIComponent(match[1])
        + '&customer_id=eq.' + encodeURIComponent(notification.customer_id)
        + '&select=mission_id,reward_description,completion_number',
    );
    if (!completion) return null;
    const mission = await readFirst<{ name: string }>(
      'loyalty_missions?id=eq.' + encodeURIComponent(completion.mission_id)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id)
        + '&select=name',
    );
    if (!mission) return null;
    values.mission_name = mission.name || '';
    values.mission_reward = completion.reward_description || '';
    values.completion_number = String(completion.completion_number || 1);
  } else if (notification.event_type === 'reward_claimed') {
    const match = /^reward:([0-9a-f-]{36})$/i.exec(eventKey);
    if (!match) return null;
    const redemption = await readFirst<{ reward_name: string; redemption_code: string; expires_at: string }>(
      'loyalty_reward_redemptions?id=eq.' + encodeURIComponent(match[1])
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id)
        + '&customer_id=eq.' + encodeURIComponent(notification.customer_id)
        + '&select=reward_name,redemption_code,expires_at',
    );
    if (!redemption) return null;
    values.reward_name = redemption.reward_name || '';
    values.redemption_code = redemption.redemption_code || '';
    const expiresAt = new Date(redemption.expires_at);
    const locale = notification.template_language.toLowerCase().startsWith('pt')
      ? 'pt-BR'
      : notification.template_language.toLowerCase().startsWith('es') ? 'es-ES' : 'en-US';
    values.reward_expires_at = Number.isNaN(expiresAt.getTime()) ? '' : expiresAt.toLocaleDateString(locale, { timeZone: 'UTC' });
  } else if (notification.event_type === 'return_reminder') {
    const campaign = reminderContext?.campaign_id ? await readFirst<{ name: string }>(
      'campaigns?id=eq.' + encodeURIComponent(reminderContext.campaign_id)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id) + '&select=name',
    ) : null;
    if (!campaign) return null;
    values.campaign_name = campaign.name || '';
  } else if (notification.event_type === 'mission_reminder') {
    const missionId = reminderContext?.reminder_subject_id || '';
    const mission = await readFirst<{ name: string; campaign_id: string; goal_count: number; starts_at: string; mission_type: 'visit_count' | 'card_stamps' }>(
      'loyalty_missions?id=eq.' + encodeURIComponent(missionId)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id)
        + '&campaign_id=eq.' + encodeURIComponent(reminderContext?.campaign_id || '')
        + '&select=name,campaign_id,goal_count,starts_at,mission_type',
    );
    if (!mission || !reminderContext?.card_id || !reminderContext.activity_snapshot_at) return null;
    const campaign = await readFirst<{ name: string }>(
      'campaigns?id=eq.' + encodeURIComponent(mission.campaign_id)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id) + '&select=name',
    );
    const [events, cardCompletions, generalCompletions] = await Promise.all([
      restFetch('mission_progress_events?mission_id=eq.' + encodeURIComponent(missionId)
        + '&customer_id=eq.' + encodeURIComponent(notification.customer_id)
        + '&select=card_id,created_at', 'GET') as Promise<Array<{ card_id: string; created_at: string }> | null>,
      readFirst<{ completed_at: string }>('mission_completions?mission_id=eq.' + encodeURIComponent(missionId)
        + '&customer_id=eq.' + encodeURIComponent(notification.customer_id)
        + '&card_id=eq.' + encodeURIComponent(reminderContext.card_id)
        + '&select=completed_at&order=completed_at.desc&limit=1'),
      readFirst<{ completed_at: string }>('mission_completions?mission_id=eq.' + encodeURIComponent(missionId)
        + '&customer_id=eq.' + encodeURIComponent(notification.customer_id)
        + '&card_id=is.null&select=completed_at&order=completed_at.desc&limit=1'),
    ]);
    const completionTime = [cardCompletions?.completed_at, generalCompletions?.completed_at]
      .filter((value): value is string => !!value)
      .map(value => new Date(value).getTime())
      .filter(Number.isFinite)
      .reduce((latest, value) => Math.max(latest, value), new Date(mission.starts_at).getTime());
    const snapshotTime = new Date(reminderContext.activity_snapshot_at).getTime();
    const progress = (Array.isArray(events) ? events : []).filter(event => {
      const createdAt = new Date(event.created_at).getTime();
      return (mission.mission_type === 'visit_count' || event.card_id === reminderContext.card_id)
        && createdAt > completionTime && createdAt <= snapshotTime;
    }).length;
    values.campaign_name = campaign?.name || '';
    values.mission_name = mission.name || '';
    values.mission_progress = String(progress);
    values.mission_goal = String(mission.goal_count || 0);
  } else if (notification.event_type === 'reward_expiring') {
    const redemptionId = reminderContext?.reminder_subject_id || '';
    const redemption = await readFirst<{ reward_name: string; redemption_code: string; expires_at: string }>(
      'loyalty_reward_redemptions?id=eq.' + encodeURIComponent(redemptionId)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id)
        + '&customer_id=eq.' + encodeURIComponent(notification.customer_id)
        + '&status=eq.issued&select=reward_name,redemption_code,expires_at',
    );
    const campaign = reminderContext?.campaign_id ? await readFirst<{ name: string }>(
      'campaigns?id=eq.' + encodeURIComponent(reminderContext.campaign_id)
        + '&owner_id=eq.' + encodeURIComponent(notification.owner_id) + '&select=name',
    ) : null;
    if (!redemption || !campaign) return null;
    const expiresAt = new Date(redemption.expires_at);
    if (Number.isNaN(expiresAt.getTime())) return null;
    values.campaign_name = campaign.name || '';
    values.reward_name = redemption.reward_name || '';
    values.redemption_code = redemption.redemption_code || '';
    values.reward_expires_at = expiresAt.toLocaleDateString(notification.template_language.toLowerCase().startsWith('pt') ? 'pt-BR' : notification.template_language.toLowerCase().startsWith('es') ? 'es-ES' : 'en-US', { timeZone: 'UTC' });
    values.days_remaining = String(Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)));
  }

  return requiredKeys.every((key) => Boolean(values[key]?.trim())) ? values : null;
};

const templateParameterNames = (template: Record<string, unknown>, eventType: string) => {
  const allowed = eventVariableKeys[eventType];
  if (!allowed) return null;
  const components = templateComponents(template.components);
  const bodies = components.filter((component) => String(component.type || '').toUpperCase() === 'BODY');
  if (bodies.length !== 1 || components.some((component) => !['BODY', 'BUTTONS'].includes(String(component.type || '').toUpperCase()))) return null;
  const body = typeof bodies[0].text === 'string' ? bodies[0].text : '';
  const names = [...body.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
  const bodyWithoutVariables = body.replace(/\{\{[^{}]+\}\}/g, '');
  if (bodyWithoutVariables.includes('{{') || bodyWithoutVariables.includes('}}')) return null;
  if (names.some((name) => !/^[a-z][a-z0-9_]{0,49}$/.test(name) || !allowed.has(name))) return null;
  for (const component of components) {
    const type = String(component.type || '').toUpperCase();
    if (type === 'BUTTONS') {
      if (!Array.isArray(component.buttons) || component.buttons.length > 3) return null;
      const buttonTypes: string[] = [];
      for (const rawButton of component.buttons) {
        if (!rawButton || typeof rawButton !== 'object') return null;
        const button = rawButton as Record<string, unknown>;
        const buttonType = String(button.type || '').toUpperCase();
        if (!['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(buttonType)) return null;
        buttonTypes.push(buttonType);
        if (buttonType === 'URL' && (typeof button.url !== 'string' || /\{\{[^{}]+\}\}/.test(button.url))) return null;
      }
      const quickCount = buttonTypes.filter((buttonType) => buttonType === 'QUICK_REPLY').length;
      const callToActionButtons = buttonTypes.filter((buttonType) => buttonType === 'URL' || buttonType === 'PHONE_NUMBER');
      if ((quickCount && callToActionButtons.length) || quickCount > 3 || callToActionButtons.length > 2
        || new Set(callToActionButtons).size !== callToActionButtons.length) return null;
    }
  }
  return names;
};

const resolveTemplateParams = async (notification: ClaimedNotification, template: Record<string, unknown>) => {
  const names = templateParameterNames(template, notification.event_type);
  if (!names) return null;
  if (!names.length) return [];
  const outbox = await readFirst<{
    event_key: string; campaign_id: string | null; card_id: string | null;
    reminder_subject_id: string | null; activity_snapshot_at: string | null;
  }>(
    'communication_notification_outbox?id=eq.' + encodeURIComponent(notification.outbox_id)
      + '&owner_id=eq.' + encodeURIComponent(notification.owner_id)
      + '&status=eq.processing&select=event_key,campaign_id,card_id,reminder_subject_id,activity_snapshot_at',
  );
  if (!outbox?.event_key) return null;
  const values = await loadEventVariables(notification, outbox.event_key, [...new Set(names)], outbox);
  if (!values) return null;
  return names.map((name) => values[name]);
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
    if (!template || String(template.status || '').toUpperCase() !== 'APPROVED') {
      await finish(notification.outbox_id, 'skipped', 'template_not_approved');
      return { outcome: 'skipped' };
    }
    const templateParams = await resolveTemplateParams(notification, template);
    if (templateParams === null) {
      await finish(notification.outbox_id, 'skipped', 'template_variables_unavailable');
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
        templateParams,
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
      try {
        await restFetch('rpc/enqueue_due_customer_engagement_reminders', 'POST', { batch_limit: 250 });
      } catch {
        // Reminder planning must not block the existing transactional WhatsApp queue.
      }
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
