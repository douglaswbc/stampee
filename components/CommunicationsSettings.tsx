import React from 'react';
import { Check, LoaderCircle, MessageCircle, Pencil, Plus, RefreshCw, Save, Trash2, Unplug, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useLocale } from './LocaleProvider';
import {
  callZernioApi,
  type ZernioIntegrationStatus,
  type ZernioMapping,
  type ZernioProfile,
  type ZernioTemplate,
} from '../lib/zernioApi';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

type EventType = 'visit_validated' | 'mission_completed' | 'reward_claimed' | 'return_reminder' | 'mission_reminder' | 'reward_expiring';
type CommunicationChannel = 'whatsapp' | 'instagram';
type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
type TemplateButtonDraft = { type: TemplateButtonType; text: string; url?: string; phone_number?: string };
type TemplateEventVariable = { key: string; sample: string };
const EVENTS: { id: EventType; label: string; description: string }[] = [
  { id: 'visit_validated', label: 'Validated visit', description: 'After a staff member validates a visit.' },
  { id: 'mission_completed', label: 'Mission completed', description: 'When the customer completes a mission.' },
  { id: 'reward_claimed', label: 'Reward claimed', description: 'When the customer claims a catalog reward.' },
  { id: 'return_reminder', label: 'Customer return reminder', description: 'When a participating customer has been inactive.' },
  { id: 'mission_reminder', label: 'Mission progress reminder', description: 'When an active mission has progress but no recent activity.' },
  { id: 'reward_expiring', label: 'Reward expiration reminder', description: 'Before an issued reward expires.' },
];
const EVENT_VARIABLES: Record<EventType, TemplateEventVariable[]> = {
  visit_validated: [
    { key: 'customer_name', sample: 'Ana' }, { key: 'business_name', sample: 'Café Central' },
    { key: 'campaign_name', sample: 'Cartão de café' }, { key: 'stamps', sample: '4' },
    { key: 'total_stamps', sample: '10' }, { key: 'stamps_remaining', sample: '6' },
    { key: 'visit_date', sample: '08/10/2026' },
  ],
  mission_completed: [
    { key: 'customer_name', sample: 'Ana' }, { key: 'business_name', sample: 'Café Central' },
    { key: 'mission_name', sample: 'Cliente frequente' }, { key: 'mission_reward', sample: 'Café grátis' },
    { key: 'completion_number', sample: '1' },
  ],
  reward_claimed: [
    { key: 'customer_name', sample: 'Ana' }, { key: 'business_name', sample: 'Café Central' },
    { key: 'reward_name', sample: 'Café grátis' }, { key: 'redemption_code', sample: 'AB12CD34' },
    { key: 'reward_expires_at', sample: '15/10/2026' },
  ],
  return_reminder: [
    { key: 'customer_name', sample: 'Ana' }, { key: 'business_name', sample: 'Café Central' },
    { key: 'campaign_name', sample: 'Cartão de café' },
  ],
  mission_reminder: [
    { key: 'customer_name', sample: 'Ana' }, { key: 'business_name', sample: 'Café Central' },
    { key: 'campaign_name', sample: 'Cartão de café' }, { key: 'mission_name', sample: 'Cliente frequente' },
    { key: 'mission_progress', sample: '2' }, { key: 'mission_goal', sample: '5' },
  ],
  reward_expiring: [
    { key: 'customer_name', sample: 'Ana' }, { key: 'business_name', sample: 'Café Central' },
    { key: 'campaign_name', sample: 'Cartão de café' }, { key: 'reward_name', sample: 'Café grátis' },
    { key: 'redemption_code', sample: 'AB12CD34' }, { key: 'reward_expires_at', sample: '15/10/2026' },
    { key: 'days_remaining', sample: '2' },
  ],
};

type ProfileResponse = { profiles?: ZernioProfile[] };
type TemplateResponse = { templates?: ZernioTemplate[]; mappings?: ZernioMapping[] };
type NotificationRecord = {
  id: string;
  event_type: EventType;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
  attempt_count: number;
  last_error_code?: string | null;
  created_at: string;
  sent_at?: string | null;
};
type NotificationAttempt = {
  id: string;
  outbox_id: string;
  attempt_number: number;
  outcome: 'sent' | 'retry' | 'failed' | 'skipped';
  error_code?: string | null;
  created_at: string;
};
type StatusResponse = { integration?: ZernioIntegrationStatus; mappings?: ZernioMapping[]; notifications?: NotificationRecord[]; attempts?: NotificationAttempt[] };

const editableTemplate = (template: ZernioTemplate) => {
  const components = template.components ?? [];
  if (!components.every((component) => ['BODY', 'BUTTONS'].includes(String(component.type || '').toUpperCase()))) return null;
  const body = components.find((component) => String(component.type || '').toUpperCase() === 'BODY');
  if (typeof body?.text !== 'string') return null;
  const bodyVariables = [...body.text.matchAll(/\{\{([^{}]+)\}\}/g)];
  if (bodyVariables.some((match) => !/^[a-z][a-z0-9_]*$/.test(match[1])) || body.text.replace(/\{\{[^{}]+\}\}/g, '').match(/\{\{|\}\}/)) return null;
  const buttonComponent = components.find((component) => String(component.type || '').toUpperCase() === 'BUTTONS');
  const buttons = Array.isArray(buttonComponent?.buttons) ? buttonComponent.buttons.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const button = value as Record<string, unknown>;
    const type = String(button.type || '').toUpperCase() as TemplateButtonType;
    const text = typeof button.text === 'string' ? button.text : '';
    if (!['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(type) || !text) return [];
    if (type === 'URL') return typeof button.url === 'string' && !/\{\{[^{}]+\}\}/.test(button.url) ? [{ type, text, url: button.url }] : [];
    if (type === 'PHONE_NUMBER') return typeof button.phone_number === 'string' ? [{ type, text, phone_number: button.phone_number }] : [];
    return [{ type, text }];
  }) : [];
  if (buttonComponent && (!Array.isArray(buttonComponent.buttons) || buttons.length !== buttonComponent.buttons.length || buttons.length > 3)) return null;
  return { body: body.text, buttons } as { body: string; buttons: TemplateButtonDraft[] };
};

const insertVariable = (
  textarea: HTMLTextAreaElement | null,
  value: string,
  variable: string,
  update: (next: string) => void,
) => {
  const token = `{{${variable}}}`;
  if (!textarea) { update(value + token); return; }
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const next = value.slice(0, start) + token + value.slice(end);
  update(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + token.length, start + token.length);
  });
};

const templateSupportsEvent = (template: ZernioTemplate, eventType: EventType) => {
  const draft = editableTemplate(template);
  if (!draft) return false;
  const matches = [...draft.body.matchAll(/\{\{([^{}]+)\}\}/g)];
  if (matches.length > 20 || matches.length !== template.parameterCount) return false;
  const allowed = new Set(EVENT_VARIABLES[eventType].map((variable) => variable.key));
  return matches.every((match) => /^[a-z][a-z0-9_]*$/.test(match[1]) && allowed.has(match[1]));
};

export const CommunicationsSettings: React.FC = () => {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [integration, setIntegration] = React.useState<ZernioIntegrationStatus | null>(null);
  const [profiles, setProfiles] = React.useState<ZernioProfile[]>([]);
  const [templates, setTemplates] = React.useState<ZernioTemplate[]>([]);
  const [mappings, setMappings] = React.useState<ZernioMapping[]>([]);
  const [notifications, setNotifications] = React.useState<NotificationRecord[]>([]);
  const [notificationAttempts, setNotificationAttempts] = React.useState<NotificationAttempt[]>([]);
  const [newTemplateName, setNewTemplateName] = React.useState('');
  const [newTemplateLanguage, setNewTemplateLanguage] = React.useState('pt_BR');
  const [newTemplateCategory, setNewTemplateCategory] = React.useState('UTILITY');
  const [newTemplateBody, setNewTemplateBody] = React.useState('');
  const [newTemplateEventType, setNewTemplateEventType] = React.useState<EventType>('visit_validated');
  const [newTemplateButtons, setNewTemplateButtons] = React.useState<TemplateButtonDraft[]>([]);
  const [editingTemplateKey, setEditingTemplateKey] = React.useState('');
  const [editingTemplateBody, setEditingTemplateBody] = React.useState('');
  const [editingTemplateButtons, setEditingTemplateButtons] = React.useState<TemplateButtonDraft[]>([]);
  const [editingTemplateEventType, setEditingTemplateEventType] = React.useState<EventType>('visit_validated');
  const newTemplateBodyRef = React.useRef<HTMLTextAreaElement>(null);
  const editingTemplateBodyRef = React.useRef<HTMLTextAreaElement>(null);
  const [selectedProfile, setSelectedProfile] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [countryCode, setCountryCode] = React.useState('55');
  const [selection, setSelection] = React.useState<Record<EventType, string>>({
    visit_validated: '',
    mission_completed: '',
    reward_claimed: '',
    return_reminder: '',
    mission_reminder: '',
    reward_expiring: '',
  });
  const [enabled, setEnabled] = React.useState<Record<EventType, boolean>>({
    visit_validated: false,
    mission_completed: false,
    reward_claimed: false,
    return_reminder: false,
    mission_reminder: false,
    reward_expiring: false,
  });
  const [busy, setBusy] = React.useState('');
  const [channelBusy, setChannelBusy] = React.useState<Record<CommunicationChannel, '' | 'connect' | 'disconnect'>>({
    whatsapp: '',
    instagram: '',
  });
  const channelBusyRef = React.useRef<Record<CommunicationChannel, '' | 'connect' | 'disconnect'>>({
    whatsapp: '',
    instagram: '',
  });
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const hasChannelActivity = Boolean(channelBusy.whatsapp || channelBusy.instagram);

  const refreshStatus = React.useCallback(async () => {
    const response = await callZernioApi<StatusResponse>({ action: 'status' });
    const nextIntegration = response.integration ?? null;
    setIntegration(nextIntegration);
    setSelectedProfile(nextIntegration?.zernio_profile_id ?? '');
    setCountryCode(nextIntegration?.phone_country_code ?? '55');
    const nextMappings = response.mappings ?? [];
    setMappings(nextMappings);
    setNotifications(response.notifications ?? []);
    setNotificationAttempts(response.attempts ?? []);
    const nextSelection = Object.fromEntries(EVENTS.map((event) => [event.id, ''])) as Record<EventType, string>;
    const nextEnabled = Object.fromEntries(EVENTS.map((event) => [event.id, false])) as Record<EventType, boolean>;
    nextMappings.forEach((mapping) => {
      if (!EVENTS.some((event) => event.id === mapping.event_type)) return;
      const eventType = mapping.event_type as EventType;
      nextSelection[eventType] = mapping.template_name + '::' + mapping.template_language;
      nextEnabled[eventType] = mapping.enabled;
    });
    setSelection(nextSelection);
    setEnabled(nextEnabled);
    if (nextIntegration?.hasZernioKey) {
      const profileResponse = await callZernioApi<ProfileResponse>({ action: 'profiles' });
      setProfiles(profileResponse.profiles ?? []);
    } else {
      setProfiles([]);
    }
    if (nextIntegration?.whatsapp_account_id) {
      const templateResponse = await callZernioApi<TemplateResponse>({ action: 'list_templates' });
      setTemplates(templateResponse.templates ?? []);
      setMappings(templateResponse.mappings ?? nextMappings);
    } else {
      setTemplates([]);
      setEditingTemplateKey('');
      setEditingTemplateBody('');
      setEditingTemplateButtons([]);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const connected = searchParams.get('connected');
        const providerError = searchParams.get('error');
        const providerErrorMessage = searchParams.get('error_message');
        const accountId = searchParams.get('accountId');
        const profileId = searchParams.get('profileId');
        if (providerError) {
          if (providerError.toLowerCase() === 'instagramloginmethod_mismatch') {
            setError(t('This Instagram account is already connected to the selected Zernio profile with a different login method. Disconnect it in Zernio first, then try again.'));
          } else {
            const safeMessage = providerErrorMessage?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
            setError(safeMessage || t('Zernio authorization was canceled or could not be completed.'));
          }
          setSearchParams({ tab: 'communications' }, { replace: true });
        } else if ((connected === 'whatsapp' || connected === 'instagram') && accountId && profileId) {
          setBusy('callback');
          await callZernioApi({
            action: 'finish_callback',
            channel: connected,
            connected,
            profileId,
            accountId,
          });
          setNotice(t('Social account connected. The account was verified with Zernio.'));
          setSearchParams({ tab: 'communications' }, { replace: true });
        }
        await refreshStatus();
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : t('Communication settings could not be loaded.'));
      } finally {
        if (active) setBusy('');
      }
    })();
    return () => { active = false; };
  }, [refreshStatus, searchParams, setSearchParams, t]);

  const withBusy = async (key: string, operation: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('Communication settings could not be updated.'));
    } finally {
      setBusy('');
    }
  };

  const withChannelBusy = async (
    channel: CommunicationChannel,
    action: 'connect' | 'disconnect',
    operation: () => Promise<void>,
  ) => {
    if (channelBusyRef.current[channel]) return;
    channelBusyRef.current[channel] = action;
    setChannelBusy((current) => ({ ...current, [channel]: action }));
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('Communication settings could not be updated.'));
    } finally {
      channelBusyRef.current[channel] = '';
      setChannelBusy((current) => ({ ...current, [channel]: '' }));
    }
  };

  const saveKey = () => withBusy('key', async () => {
    const response = await callZernioApi<ProfileResponse>({ action: 'save_key', apiKey });
    setApiKey('');
    setProfiles(response.profiles ?? []);
    await refreshStatus();
    setNotice(t('Zernio key verified and stored securely.'));
  });

  const saveProfile = () => withBusy('profile', async () => {
    await callZernioApi({ action: 'set_profile', profileId: selectedProfile });
    await refreshStatus();
    setNotice(t('Zernio profile saved.'));
  });

  const disconnectZernio = () => {
    if (!window.confirm(t('Disconnect Zernio accounts and clear the saved key? This removes connected WhatsApp and Instagram accounts from Zernio and clears the saved API key from Stampfy. Revoke the API key separately in Zernio if you no longer need it.'))) return;
    void withBusy('disconnect', async () => {
      try {
        await callZernioApi({ action: 'disconnect' });
      } catch (disconnectError) {
        await refreshStatus();
        throw disconnectError;
      }
      setApiKey('');
      setTemplates([]);
      setProfiles([]);
      setEditingTemplateKey('');
      setEditingTemplateBody('');
      setEditingTemplateButtons([]);
      await refreshStatus();
      setNotice(t('Zernio and its connected accounts were disconnected. The API key remains active in Zernio until you revoke it there.'));
    });
  };

  const connectChannel = (channel: CommunicationChannel) => withChannelBusy(channel, 'connect', async () => {
    if (!integration?.zernio_profile_id || selectedProfile !== integration.zernio_profile_id) {
      throw new Error(t('Save the selected profile before connecting a channel.'));
    }
    const response = await callZernioApi<{ authUrl?: string }>({
      action: 'connect_url',
      channel,
      profileId: integration.zernio_profile_id,
    });
    if (!response.authUrl || !/^https:\/\//i.test(response.authUrl)) throw new Error(t('Zernio did not return a secure authorization link.'));
    window.location.assign(response.authUrl);
  });

  const disconnectChannel = (channel: 'whatsapp' | 'instagram') => {
    const confirmation = channel === 'whatsapp'
      ? 'Disconnect this WhatsApp account from Zernio? The Zernio profile, API key, and Instagram connection will stay active.'
      : 'Disconnect this Instagram account from Zernio? The Zernio profile, API key, and WhatsApp connection will stay active.';
    if (!window.confirm(t(confirmation))) return;

    void withChannelBusy(channel, 'disconnect', async () => {
      await callZernioApi({ action: 'disconnect_channel', channel });
      await refreshStatus();
      setNotice(t(channel === 'whatsapp'
        ? 'WhatsApp account disconnected from Zernio.'
        : 'Instagram account disconnected from Zernio.'));
    });
  };

  const saveCountry = () => withBusy('country', async () => {
    await callZernioApi({ action: 'set_country_code', countryCode });
    await refreshStatus();
    setNotice(t('Country calling code saved.'));
  });

  const refreshTemplates = () => withBusy('templates', async () => {
    const response = await callZernioApi<TemplateResponse>({ action: 'list_templates' });
    setTemplates(response.templates ?? []);
    setMappings(response.mappings ?? []);
    setNotice(t('WhatsApp templates refreshed.'));
  });

  const saveMapping = (eventType: EventType) => withBusy(eventType, async () => {
    const [templateName, templateLanguage] = selection[eventType].split('::');
    if (!templateName || !templateLanguage) throw new Error(t('Choose a WhatsApp template first.'));
    const response = await callZernioApi<{ enabled: boolean }>({
      action: 'save_notification_template',
      eventType,
      templateName,
      templateLanguage,
      enabled: enabled[eventType],
    });
    await refreshStatus();
    if (enabled[eventType] && !response.enabled) {
      setNotice(t('Template saved but not enabled. It must be approved and use supported variables for this event.'));
    } else {
      setNotice(t('Notification template saved.'));
    }
  });

  const retryNotification = (id: string) => withBusy('retry:' + id, async () => {
    await callZernioApi({ action: 'retry_notification', outboxId: id });
    await refreshStatus();
    setNotice(t('Notification queued for a safe retry.'));
  });

  const createTemplate = () => withBusy('template-create', async () => {
    await callZernioApi({
      action: 'create_template',
      templateName: newTemplateName,
      templateLanguage: newTemplateLanguage,
      category: newTemplateCategory,
      bodyText: newTemplateBody,
      eventType: newTemplateEventType,
      buttons: newTemplateButtons,
    });
    setNewTemplateName('');
    setNewTemplateBody('');
    setNewTemplateButtons([]);
    await refreshStatus();
    setNotice(t('Template created and submitted for Meta review.'));
  });

  const beginEditTemplate = (template: ZernioTemplate) => {
    const draft = editableTemplate(template);
    if (draft === null) {
      setError(t('This template contains components that are not supported by the editor.'));
      return;
    }
    setError('');
    setEditingTemplateKey(template.name + '::' + template.language);
    setEditingTemplateBody(draft.body);
    setEditingTemplateButtons(draft.buttons);
    setEditingTemplateEventType(EVENTS.find((event) => selection[event.id] === template.name + '::' + template.language)?.id ?? 'visit_validated');
  };

  const saveTemplateEdit = (template: ZernioTemplate) => withBusy('template-edit', async () => {
    await callZernioApi({
      action: 'update_template',
      templateName: template.name,
      templateLanguage: template.language,
      bodyText: editingTemplateBody,
      eventType: editingTemplateEventType,
      buttons: editingTemplateButtons,
    });
    setEditingTemplateKey('');
    setEditingTemplateBody('');
    setEditingTemplateButtons([]);
    await refreshStatus();
    setNotice(t('Template updated and submitted for Meta review. Its notification mapping is disabled until approval.'));
  });

  const deleteTemplate = (template: ZernioTemplate) => {
    if (!window.confirm(t('Delete this exact language variant from WhatsApp? Meta may keep it pending deletion for a while.'))) return;
    void withBusy('template-delete', async () => {
      await callZernioApi({ action: 'delete_template', templateName: template.name, templateLanguage: template.language });
      setEditingTemplateKey('');
      await refreshStatus();
      setNotice(t('Template deletion was requested from Meta.'));
    });
  };

  const templatesByKey = new Map<string, ZernioTemplate>(templates.map((template): [string, ZernioTemplate] => [template.name + '::' + template.language, template]));
  const renderVariablePicker = (
    eventType: EventType,
    value: string,
    textareaRef: { current: HTMLTextAreaElement | null },
    update: (next: string) => void,
  ) => (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{t('Insert a system variable')}</p>
      <div className="flex flex-wrap gap-1.5">
        {EVENT_VARIABLES[eventType].map((variable) => (
          <Button
            key={variable.key}
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 font-mono text-xs"
            onClick={() => insertVariable(textareaRef.current, value, variable.key, update)}
          >
            {`{{${variable.key}}}`}
          </Button>
        ))}
      </div>
    </div>
  );
  const renderButtonEditor = (
    buttons: TemplateButtonDraft[],
    update: React.Dispatch<React.SetStateAction<TemplateButtonDraft[]>>,
    prefix: string,
  ) => {
    const quickReplyCount = buttons.filter((button) => button.type === 'QUICK_REPLY').length;
    const callToActionButtons = buttons.filter((button) => button.type === 'URL' || button.type === 'PHONE_NUMBER');
    const canAdd = quickReplyCount ? quickReplyCount < 3 : callToActionButtons.length < 2;
    const addButtonType: TemplateButtonType = quickReplyCount || buttons.length === 0
      ? 'QUICK_REPLY'
      : callToActionButtons.some((button) => button.type === 'URL') ? 'PHONE_NUMBER' : 'URL';

    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{t('Interactive buttons')}</p>
            <p className="text-xs text-muted-foreground">{t('Use up to three quick replies, or one link and one call button.')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAdd}
            onClick={() => update((current) => [...current, { type: addButtonType, text: '' }])}
            className="w-full gap-1.5 sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5" />{t('Add button')}
          </Button>
        </div>
        {buttons.map((button, index) => {
          const otherButtons = buttons.filter((_, itemIndex) => itemIndex !== index);
          const otherHasQuick = otherButtons.some((item) => item.type === 'QUICK_REPLY');
          const otherHasCta = otherButtons.some((item) => item.type !== 'QUICK_REPLY');
          const urlTaken = otherButtons.some((item) => item.type === 'URL');
          const phoneTaken = otherButtons.some((item) => item.type === 'PHONE_NUMBER');
          return (
            <div key={`${prefix}-${index}`} className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor={`${prefix}-type-${index}`}>{t('Button type')}</Label>
                <select
                  id={`${prefix}-type-${index}`}
                  value={button.type}
                  onChange={(event) => update((current) => current.map((item, itemIndex) => itemIndex === index
                    ? { type: event.target.value as TemplateButtonType, text: item.text }
                    : item))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="QUICK_REPLY" disabled={otherHasCta}>{t('Quick reply')}</option>
                  <option value="URL" disabled={otherHasQuick || urlTaken}>{t('Open link')}</option>
                  <option value="PHONE_NUMBER" disabled={otherHasQuick || phoneTaken}>{t('Call phone number')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${prefix}-label-${index}`}>{t('Button label')}</Label>
                <Input
                  id={`${prefix}-label-${index}`}
                  value={button.text}
                  onChange={(event) => update((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))}
                  maxLength={25}
                  placeholder={t('Example: View my card')}
                  className="h-10"
                />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={t('Remove button')} onClick={() => update((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="h-10 w-full sm:w-10">
                <X className="h-4 w-4" />
              </Button>
              {button.type === 'URL' && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={`${prefix}-url-${index}`}>{t('HTTPS link')}</Label>
                  <Input
                    id={`${prefix}-url-${index}`}
                    type="url"
                    value={button.url ?? ''}
                    onChange={(event) => update((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))}
                    placeholder="https://exemplo.com/meu-cartao"
                    className="h-10"
                  />
                </div>
              )}
              {button.type === 'PHONE_NUMBER' && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={`${prefix}-phone-${index}`}>{t('Phone number in international format')}</Label>
                  <Input
                    id={`${prefix}-phone-${index}`}
                    type="tel"
                    value={button.phone_number ?? ''}
                    onChange={(event) => update((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, phone_number: event.target.value } : item))}
                    placeholder="+5511999999999"
                    className="h-10"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
        <h2 className="text-lg font-semibold">{t('Messaging integrations')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('Connect Zernio securely to configure WhatsApp loyalty notifications and an Instagram professional account.')}</p>
        <p className="mt-2 text-xs text-muted-foreground">{t('API credentials are encrypted on the server. Only the owner can manage these settings.')}</p>
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{t(error)}</p>}
        {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="zernio-api-key">{t(integration?.hasZernioKey ? 'Replace Zernio API key' : 'Zernio API key')}</Label>
            <Input
              id="zernio-api-key"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk_••••••••••••"
              maxLength={128}
              className="h-11"
            />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={saveKey} disabled={busy !== '' || hasChannelActivity || apiKey.trim().length < 10} className="w-full gap-2 sm:w-auto">
              {busy === 'key' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t('Verify and save key')}
            </Button>
          </div>
        </div>

        {integration?.hasZernioKey && (
          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="zernio-profile">{t('Zernio profile')}</Label>
              <select id="zernio-profile" value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)} disabled={busy !== '' || hasChannelActivity} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                <option value="">{t('Choose a profile')}</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.id}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="button" variant="outline" onClick={saveProfile} disabled={!selectedProfile || selectedProfile === integration.zernio_profile_id || busy !== '' || hasChannelActivity} className="w-full sm:w-auto">
                {t('Save profile')}
              </Button>
            </div>
          </div>
        )}

        {integration?.hasZernioKey && (
          <div className="mt-5 flex justify-end border-t pt-4">
            <Button type="button" variant="destructive" onClick={disconnectZernio} disabled={busy !== '' || hasChannelActivity} className="w-full gap-2 sm:w-auto">
              {busy === 'disconnect' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              {t('Disconnect Zernio')}
            </Button>
          </div>
        )}

        {integration?.zernio_profile_id && (
          <div className="mt-6 space-y-3">
            {selectedProfile !== integration.zernio_profile_id && (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t('Save the selected profile before connecting a channel.')}
              </p>
            )}
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 26rem), 1fr))' }}>
              <div className="@container min-w-0 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium"><MessageCircle className="h-4 w-4" />{t('WhatsApp Business')}</div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${integration.whatsapp_account_id ? 'bg-emerald-50 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}>
                    {t(integration.whatsapp_account_id ? 'Connected' : 'Not connected')}
                  </span>
                </div>
                {(integration.whatsapp_display_name || integration.whatsapp_account_id) && (
                  <p className="mt-1 break-all text-sm text-muted-foreground">{integration.whatsapp_display_name || integration.whatsapp_account_id}</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">{t('This action affects WhatsApp only; the Instagram connection stays unchanged.')}</p>
                <div className="mt-4 flex flex-col gap-2 @lg:flex-row">
                  <Button type="button" onClick={() => void connectChannel('whatsapp')} disabled={busy !== '' || channelBusy.whatsapp !== '' || selectedProfile !== integration.zernio_profile_id} className="w-full min-w-0 gap-2 @lg:flex-1">
                    {channelBusy.whatsapp === 'connect' && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    {channelBusy.whatsapp === 'connect' ? t('Connecting WhatsApp...') : integration.whatsapp_account_id ? t('Reconnect WhatsApp') : t('Connect WhatsApp')}
                  </Button>
                  {integration.whatsapp_account_id && (
                    <Button type="button" variant="outline" onClick={() => disconnectChannel('whatsapp')} disabled={busy !== '' || channelBusy.whatsapp !== ''} className="w-full gap-2 @lg:w-auto">
                      {channelBusy.whatsapp === 'disconnect' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                      {t('Disconnect WhatsApp')}
                    </Button>
                  )}
                </div>
              </div>
              <div className="@container min-w-0 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium"><MessageCircle className="h-4 w-4" />{t('Instagram professional account')}</div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${integration.instagram_account_id ? 'bg-emerald-50 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}>
                    {t(integration.instagram_account_id ? 'Connected' : 'Not connected')}
                  </span>
                </div>
                {(integration.instagram_username || integration.instagram_account_id) && (
                  <p className="mt-1 break-all text-sm text-muted-foreground">{integration.instagram_username || integration.instagram_account_id}</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">{t('This action affects Instagram only; the WhatsApp connection stays unchanged.')}</p>
                <div className="mt-4 flex flex-col gap-2 @lg:flex-row">
                  <Button type="button" onClick={() => void connectChannel('instagram')} disabled={busy !== '' || channelBusy.instagram !== '' || selectedProfile !== integration.zernio_profile_id} className="w-full min-w-0 gap-2 @lg:flex-1">
                    {channelBusy.instagram === 'connect' && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    {channelBusy.instagram === 'connect' ? t('Connecting Instagram...') : integration.instagram_account_id ? t('Reconnect Instagram') : t('Connect Instagram')}
                  </Button>
                  {integration.instagram_account_id && (
                    <Button type="button" variant="outline" onClick={() => disconnectChannel('instagram')} disabled={busy !== '' || channelBusy.instagram !== ''} className="w-full gap-2 @lg:w-auto">
                      {channelBusy.instagram === 'disconnect' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                      {t('Disconnect Instagram')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {integration?.whatsapp_account_id && (
        <>
          <div className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">{t('WhatsApp notification templates')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('Approved templates can include Stampfy variables and interactive buttons. Messages are sent only to customers who opted in to WhatsApp notifications.')}</p>
              </div>
              <Button type="button" variant="outline" onClick={refreshTemplates} disabled={busy !== ''} className="gap-2">
                {busy === 'templates' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t('Refresh templates')}
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="phone-country-code">{t('Customer phone country code')}</Label>
                <Input id="phone-country-code" inputMode="numeric" value={countryCode} onChange={(event) => setCountryCode(event.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="55" className="h-10 w-full sm:max-w-40" />
              </div>
              <div className="flex items-end"><Button type="button" variant="outline" onClick={saveCountry} disabled={busy !== '' || !countryCode} className="w-full sm:w-auto">{t('Save')}</Button></div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('Numbers with 12 to 15 digits beginning with this calling code are kept; local 10 or 11 digit numbers use this prefix.')}</p>
          </div>

          {EVENTS.map((event) => {
            const currentKey = selection[event.id];
            const selectedTemplate = templatesByKey.get(currentKey);
            return (
              <div key={event.id} className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold">{t(event.label)}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{t(event.description)}</p>
                  </div>
                  {mappings.find((mapping) => mapping.event_type === event.id)?.enabled && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800"><Check className="h-3.5 w-3.5" />{t('Enabled')}</span>}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={'template-' + event.id}>{t('WhatsApp template')}</Label>
                    <select
                      id={'template-' + event.id}
                      value={currentKey}
                      onChange={(inputEvent) => setSelection((current) => ({ ...current, [event.id]: inputEvent.target.value }))}
                      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">{t('Choose a template')}</option>
                      {templates.map((template) => <option key={template.name + '::' + template.language} value={template.name + '::' + template.language}>{template.name} · {template.language} · {template.status}{template.parameterCount ? ' · ' + template.parameterCount + ' ' + t('variables') : ''}</option>)}
                    </select>
                    {selectedTemplate && <p className="text-xs text-muted-foreground">{t('Template status')}: {selectedTemplate.status}. {!templateSupportsEvent(selectedTemplate, event.id) ? t(selectedTemplate.parameterCount ? 'This template has variables that are unavailable for this event.' : 'This template cannot be used with this event.') : ''}</p>}
                  </div>
                  <div className="flex items-end">
                    <Button type="button" onClick={() => void saveMapping(event.id)} disabled={!currentKey || busy !== ''} className="w-full gap-2 sm:w-auto">
                      {busy === event.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {t('Save template')}
                    </Button>
                  </div>
                </div>
                <label className="mt-3 inline-flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled[event.id]}
                    onChange={(inputEvent) => setEnabled((current) => ({ ...current, [event.id]: inputEvent.target.checked }))}
                    disabled={!selectedTemplate || selectedTemplate.status !== 'APPROVED' || !templateSupportsEvent(selectedTemplate, event.id)}
                    className="mt-1 h-4 w-4 accent-foreground"
                  />
                  <span>{t('Enable automatic message for this event (requires an approved template with supported variables).')}</span>
                </label>
              </div>
            );
          })}

          <div className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
            <h3 className="font-semibold">{t('Manage WhatsApp templates')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('Create event messages with Stampfy variables and interactive buttons. Meta must approve each template before it can be sent.')}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-template-name">{t('Template name')}</Label>
                <Input id="new-template-name" value={newTemplateName} onChange={(event) => setNewTemplateName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} maxLength={512} placeholder="loyalty_visit" className="h-10" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-template-language">{t('Language code')}</Label>
                  <Input id="new-template-language" value={newTemplateLanguage} onChange={(event) => setNewTemplateLanguage(event.target.value)} maxLength={8} placeholder="pt_BR" className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-template-category">{t('Category')}</Label>
                  <select id="new-template-category" value={newTemplateCategory} onChange={(event) => setNewTemplateCategory(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="UTILITY">{t('Utility')}</option>
                    <option value="MARKETING">{t('Marketing')}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="new-template-event">{t('Variables for event')}</Label>
                <select id="new-template-event" value={newTemplateEventType} onChange={(event) => setNewTemplateEventType(event.target.value as EventType)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-md">
                  {EVENTS.map((event) => <option key={event.id} value={event.id}>{t(event.label)}</option>)}
                </select>
                <Label htmlFor="new-template-body" className="mt-3 block">{t('Message text')}</Label>
                <textarea ref={newTemplateBodyRef} id="new-template-body" value={newTemplateBody} onChange={(event) => setNewTemplateBody(event.target.value)} maxLength={1024} rows={4} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder={t('Example: Hello {{customer_name}}, your visit was validated!')} />
                {renderVariablePicker(newTemplateEventType, newTemplateBody, newTemplateBodyRef, setNewTemplateBody)}
                <p className="text-xs text-muted-foreground">{t('Use the variable buttons to insert values that Stampfy fills in when the event happens.')}</p>
              </div>
              <div className="md:col-span-2">
                {renderButtonEditor(newTemplateButtons, setNewTemplateButtons, 'new-template-button')}
              </div>
              <div className="md:col-span-2">
                <Button type="button" onClick={createTemplate} disabled={busy !== '' || !newTemplateName.trim() || !newTemplateLanguage.trim() || !newTemplateBody.trim() || newTemplateButtons.some((button) => !button.text.trim() || (button.type === 'URL' && !button.url?.trim()) || (button.type === 'PHONE_NUMBER' && !button.phone_number?.trim()))} className="w-full gap-2 sm:w-auto">
                  {busy === 'template-create' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {t('Create template')}
                </Button>
              </div>
            </div>
            {templates.length > 0 && (
              <ul className="mt-5 divide-y rounded-xl border">
                {templates.map((template) => {
                  const key = template.name + '::' + template.language;
                  const editableDraft = editableTemplate(template);
                  const editable = editableDraft !== null && ['APPROVED', 'REJECTED', 'PAUSED'].includes(template.status);
                  return (
                    <li key={key} className="p-3 sm:p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="break-all text-sm font-medium">{template.name} · {template.language}</p>
                          <p className="text-xs text-muted-foreground">{t(template.category || 'Template')} · {template.status}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={!editable || busy !== ''} onClick={() => beginEditTemplate(template)} className="flex-1 gap-2 sm:flex-none">
                            <Pencil className="h-3.5 w-3.5" />{t('Edit')}
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={busy !== ''} onClick={() => deleteTemplate(template)} className="flex-1 gap-2 sm:flex-none">
                            <Trash2 className="h-3.5 w-3.5" />{t('Delete')}
                          </Button>
                        </div>
                      </div>
                      {editingTemplateKey === key && (
                        <div className="mt-3 space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor={'edit-template-event-' + key}>{t('Variables for event')}</Label>
                            <select id={'edit-template-event-' + key} value={editingTemplateEventType} onChange={(event) => setEditingTemplateEventType(event.target.value as EventType)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-md">
                              {EVENTS.map((event) => <option key={event.id} value={event.id}>{t(event.label)}</option>)}
                            </select>
                            <Label htmlFor={'edit-template-' + key} className="mt-2 block">{t('Message text')}</Label>
                            <textarea ref={editingTemplateBodyRef} id={'edit-template-' + key} value={editingTemplateBody} onChange={(event) => setEditingTemplateBody(event.target.value)} maxLength={1024} rows={4} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                            {editableDraft?.body.includes('{{')
                              ? renderVariablePicker(editingTemplateEventType, editingTemplateBody, editingTemplateBodyRef, setEditingTemplateBody)
                              : <p className="text-xs text-muted-foreground">{t('To add variables, create a new WhatsApp template.')}</p>}
                          </div>
                          {renderButtonEditor(editingTemplateButtons, setEditingTemplateButtons, 'edit-template-button-' + key)}
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button type="button" onClick={() => saveTemplateEdit(template)} disabled={busy !== '' || !editingTemplateBody.trim()} className="gap-2"><Save className="h-4 w-4" />{t('Save and submit for review')}</Button>
                            <Button type="button" variant="outline" onClick={() => setEditingTemplateKey('')} disabled={busy !== ''}>{t('Cancel')}</Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
            <h3 className="font-semibold">{t('Communication history')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('Recent WhatsApp notification attempts for this business.')}</p>
            {notifications.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">{t('No notifications have been queued yet.')}</p>
            ) : (
              <ul className="mt-4 divide-y">
                {notifications.map((notification) => {
                  const history = notificationAttempts.filter((attempt) => attempt.outbox_id === notification.id);
                  const lastAttempt = history[0];
                  return (
                    <li key={notification.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t(EVENTS.find((event) => event.id === notification.event_type)?.label ?? notification.event_type)} · {t(notification.status)}</p>
                        <p className="text-xs text-muted-foreground">{new Date(notification.created_at).toLocaleString()} · {t('Attempts')}: {history.length}{lastAttempt?.error_code ? ' · ' + lastAttempt.error_code : notification.last_error_code ? ' · ' + notification.last_error_code : ''}</p>
                      </div>
                      {notification.status === 'failed' && (
                        <Button type="button" variant="outline" size="sm" onClick={() => void retryNotification(notification.id)} disabled={busy !== ''} className="w-full sm:w-auto">
                          {busy === 'retry:' + notification.id ? t('Updating…') : t('Try again')}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
};
