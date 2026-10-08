type ClaimedPushDelivery = {
  delivery_id: string;
  owner_id: string;
  customer_id: string;
  customer_name: string;
  business_name: string;
  business_slug: string;
  interface_language: string;
  event_type: 'visit_validated' | 'mission_completed' | 'reward_claimed';
  endpoint_url: string;
  p256dh_key: string;
  auth_secret: string;
  subscription_id: string;
  card_unique_id: string | null;
};

const encoder = new TextEncoder();
const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};
const encodeBase64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const concatBytes = (...values: Uint8Array[]) => {
  const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const supabaseUrl = () => process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const workerSecret = () => process.env.CRON_SECRET?.trim()
  || process.env.PUSH_CRON_SECRET?.trim()
  || process.env.COMMUNICATIONS_CRON_SECRET?.trim()
  || '';
const vapidPublicKey = () => process.env.WEB_PUSH_PUBLIC_KEY?.trim() || '';
const vapidPrivateKey = () => process.env.WEB_PUSH_PRIVATE_KEY?.trim() || '';

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

const deriveHkdf = async (inputKey: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) => {
  const key = await crypto.subtle.importKey('raw', inputKey, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
};

const trustedPushEndpoint = (endpoint: URL) => {
  const host = endpoint.hostname.toLowerCase();
  return endpoint.protocol === 'https:' && (
    host === 'fcm.googleapis.com'
    || host === 'push.services.mozilla.com'
    || host.endsWith('.push.services.mozilla.com')
    || host === 'web.push.apple.com'
    || host.endsWith('.push.apple.com')
    || host.endsWith('.notify.windows.com')
  );
};

const makeVapidToken = async (endpoint: URL) => {
  const publicKey = decodeBase64Url(vapidPublicKey());
  const privateKey = decodeBase64Url(vapidPrivateKey());
  if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) throw new Error('vapid_config');

  const x = encodeBase64Url(publicKey.subarray(1, 33));
  const y = encodeBase64Url(publicKey.subarray(33, 65));
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x, y, d: encodeBase64Url(privateKey), ext: true, key_ops: ['sign'],
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() || 'mailto:support@stampfy.com';
  const header = encodeBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = encodeBase64Url(JSON.stringify({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned),
  ));
  return `${unsigned}.${encodeBase64Url(signature)}`;
};

const encryptPayload = async (delivery: ClaimedPushDelivery, payload: Record<string, unknown>) => {
  const userPublicKey = decodeBase64Url(delivery.p256dh_key);
  const authSecret = decodeBase64Url(delivery.auth_secret);
  if (userPublicKey.length !== 65 || userPublicKey[0] !== 4 || authSecret.length < 16) throw new Error('subscription_invalid');

  const userKey = await crypto.subtle.importKey('raw', userPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: userKey }, serverKeys.privateKey, 256));
  const keyInfo = concatBytes(
    encoder.encode('WebPush: info\0'),
    userPublicKey,
    serverPublicKey,
  );
  const inputKeyMaterial = await deriveHkdf(sharedSecret, authSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await deriveHkdf(inputKeyMaterial, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await deriveHkdf(inputKeyMaterial, salt, encoder.encode('Content-Encoding: nonce\0'), 12);
  const plaintext = concatBytes(encoder.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));
  const recordHeader = new Uint8Array(21);
  recordHeader.set(salt, 0);
  new DataView(recordHeader.buffer).setUint32(16, 4096, false);
  recordHeader[20] = serverPublicKey.length;
  return concatBytes(recordHeader, serverPublicKey, encrypted);
};

const notificationCopy = (delivery: ClaimedPushDelivery) => {
  const language = delivery.interface_language?.toLowerCase() || 'en';
  const business = delivery.business_name || (language.startsWith('pt') ? 'o comércio' : language.startsWith('es') ? 'el negocio' : 'the business');
  if (language.startsWith('pt')) {
    if (delivery.event_type === 'visit_validated') return { title: 'Atualização de fidelidade', body: `Sua visita foi validada em ${business}.` };
    if (delivery.event_type === 'mission_completed') return { title: 'Missão concluída', body: `Você concluiu uma missão em ${business}.` };
    return { title: 'Recompensa solicitada', body: `Há uma atualização sobre sua recompensa em ${business}.` };
  }
  if (language.startsWith('es')) {
    if (delivery.event_type === 'visit_validated') return { title: 'Novedad de fidelidad', body: `Tu visita fue validada en ${business}.` };
    if (delivery.event_type === 'mission_completed') return { title: 'Misión completada', body: `Completaste una misión en ${business}.` };
    return { title: 'Recompensa solicitada', body: `Hay novedades sobre tu recompensa en ${business}.` };
  }
  if (delivery.event_type === 'visit_validated') return { title: 'Loyalty update', body: `Your visit was validated at ${business}.` };
  if (delivery.event_type === 'mission_completed') return { title: 'Mission completed', body: `You completed a mission at ${business}.` };
  return { title: 'Reward requested', body: `There is an update about your reward at ${business}.` };
};

const sendPush = async (delivery: ClaimedPushDelivery) => {
  const endpoint = new URL(delivery.endpoint_url);
  if (!trustedPushEndpoint(endpoint)) throw new Error('endpoint_invalid');
  const copy = notificationCopy(delivery);
  const url = delivery.business_slug && delivery.card_unique_id
    ? `/${encodeURIComponent(delivery.business_slug)}/${encodeURIComponent(delivery.card_unique_id)}`
    : '/account';
  const body = await encryptPayload(delivery, {
    title: copy.title,
    body: copy.body,
    tag: `stampfy-${delivery.delivery_id}`,
    url,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${await makeVapidToken(endpoint)}, k=${vapidPublicKey()}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: body as BodyInit,
      signal: controller.signal,
    });
  } catch {
    const error = new Error('push_network_error') as Error & { retryable?: boolean };
    error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const authorize = async (deliveryId: string) => {
  const result = await restFetch('rpc/authorize_customer_push_delivery', 'POST', {
    delivery_id_input: deliveryId,
  });
  return result === true;
};

const finish = async (deliveryId: string, outcome: string, errorCode?: string, retryAfter = 60) => {
  await restFetch('rpc/finish_customer_push_delivery', 'POST', {
    delivery_id_input: deliveryId,
    outcome_input: outcome,
    error_code_input: errorCode || null,
    retry_after_seconds_input: retryAfter,
  });
};

const processDelivery = async (delivery: ClaimedPushDelivery) => {
  try {
    if (!await authorize(delivery.delivery_id)) {
      await finish(delivery.delivery_id, 'skipped', 'consent_or_mapping_revoked');
      return 'skipped';
    }
    const response = await sendPush(delivery);
    if (response.ok) {
      await finish(delivery.delivery_id, 'sent');
      return 'sent';
    }
    if (response.status === 404 || response.status === 410) {
      await finish(delivery.delivery_id, 'skipped', 'subscription_expired');
      return 'skipped';
    }
    const retryable = response.status === 429 || response.status >= 500;
    const retryAfterHeader = Number(response.headers.get('retry-after') || 60);
    await finish(
      delivery.delivery_id,
      retryable ? 'retry' : 'failed',
      `push_http_${response.status}`,
      Number.isFinite(retryAfterHeader) ? retryAfterHeader : 60,
    );
    return retryable ? 'retry' : 'failed';
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]+$/i.test(error.message) ? error.message.slice(0, 100) : 'push_worker_error';
    const retryable = error instanceof Error && (error as Error & { retryable?: boolean }).retryable === true;
    try {
      await finish(delivery.delivery_id, retryable ? 'retry' : 'failed', code);
    } catch {
      // A stale processing lease can be reclaimed by a later worker invocation.
    }
    return retryable ? 'retry' : 'failed';
  }
};

export default {
  async fetch(request: Request) {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const expected = workerSecret();
    const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (expected.length < 16 || !equalSecret(expected, supplied)) return json({ error: 'Unauthorized.' }, 401);
    if (!supabaseUrl() || !serviceKey() || !vapidPublicKey() || !vapidPrivateKey()) {
      return json({ error: 'Push worker is not configured.' }, 503);
    }

    try {
      const claimed = await restFetch('rpc/claim_customer_push_deliveries', 'POST', { batch_limit: 10 }) as ClaimedPushDelivery[] | null;
      const deliveries = Array.isArray(claimed) ? claimed : [];
      const outcomes: string[] = [];
      for (let index = 0; index < deliveries.length; index += 5) {
        const batch = deliveries.slice(index, index + 5);
        outcomes.push(...await Promise.all(batch.map(processDelivery)));
      }
      return json({
        claimed: deliveries.length,
        sent: outcomes.filter(outcome => outcome === 'sent').length,
        failed: outcomes.filter(outcome => outcome === 'failed').length,
        skipped: outcomes.filter(outcome => outcome === 'skipped').length,
        retrying: outcomes.filter(outcome => outcome === 'retry').length,
      });
    } catch {
      return json({ error: 'Push worker could not process the queue.' }, 500);
    }
  },
};
