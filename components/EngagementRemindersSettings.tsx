import React from 'react';
import { BellRing, LoaderCircle, Save, ShieldCheck } from 'lucide-react';
import { useLocale } from './LocaleProvider';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  getCompanyEngagementConfiguration,
  saveCompanyEngagementConfiguration,
  type CompanyEngagementSettings,
  type EngagementPushTemplate,
  type EngagementReminderType,
} from '../lib/db/customerEngagement';

type Configuration = Awaited<ReturnType<typeof getCompanyEngagementConfiguration>>;

const DEFAULT_SETTINGS: Omit<CompanyEngagementSettings, 'timeZone'> = {
  enabled: false,
  returnEnabled: false,
  missionEnabled: false,
  rewardExpiringEnabled: false,
  pushEnabled: true,
  whatsappEnabled: false,
  channelPriority: 'push_first',
  returnAfterDays: 7,
  repeatIntervalDays: 7,
  maxRemindersPerCampaign: 2,
  rewardExpiryDays: 3,
  maxPerCustomerPer7d: 2,
  minGapHours: 48,
  quietHoursEnabled: true,
  quietStart: '21:00',
  quietEnd: '08:00',
};

const DEFAULT_TEMPLATES: EngagementPushTemplate[] = [
  { eventType: 'return_reminder', title: 'Sentimos sua falta, {{customer_name}}!', body: 'A campanha {{campaign_name}} continua ativa. Volte para avançar seu cartão.' },
  { eventType: 'mission_reminder', title: 'Sua missão está em andamento', body: '{{customer_name}}, você avançou {{mission_progress}} de {{mission_goal}} etapas em {{mission_name}}.' },
  { eventType: 'reward_expiring', title: 'Sua recompensa vence em breve', body: '{{customer_name}}, resgate {{reward_name}} até {{reward_expires_at}}.' },
];

const TEMPLATE_VARIABLES: Record<EngagementReminderType, string[]> = {
  return_reminder: ['customer_name', 'business_name', 'campaign_name'],
  mission_reminder: ['customer_name', 'business_name', 'campaign_name', 'mission_name', 'mission_progress', 'mission_goal'],
  reward_expiring: ['customer_name', 'business_name', 'campaign_name', 'reward_name', 'reward_expires_at', 'days_remaining'],
};

const TEMPLATE_PREVIEW_VALUES: Record<string, string> = {
  customer_name: 'Ana',
  business_name: 'Café Central',
  campaign_name: 'Cartão de café',
  mission_name: 'Cliente frequente',
  mission_progress: '2',
  mission_goal: '5',
  reward_name: 'Café grátis',
  reward_expires_at: '15/10/2026',
  days_remaining: '2',
};

const renderTemplatePreview = (text: string) => text.replace(/\{\{([a-z_]+)\}\}/g, (token, name: string) => TEMPLATE_PREVIEW_VALUES[name] ?? token);

const REMINDER_TYPES: Array<{ id: EngagementReminderType; label: string; description: string }> = [
  { id: 'return_reminder', label: 'Customer return reminder', description: 'After a participant has no card activity for the selected period.' },
  { id: 'mission_reminder', label: 'Mission progress reminder', description: 'Only while the mission is active, has unfinished progress, and has had no recent activity.' },
  { id: 'reward_expiring', label: 'Reward expiration reminder', description: 'Before an issued reward expires and only while it remains available to redeem.' },
];

export const EngagementRemindersSettings: React.FC = () => {
  const { t } = useLocale();
  const [configuration, setConfiguration] = React.useState<Configuration>(null);
  const [settings, setSettings] = React.useState(DEFAULT_SETTINGS);
  const [selectedCampaigns, setSelectedCampaigns] = React.useState<string[]>([]);
  const [templates, setTemplates] = React.useState<EngagementPushTemplate[]>(DEFAULT_TEMPLATES);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await getCompanyEngagementConfiguration();
    setLoading(false);
    if (!result) {
      setError(t('Could not load reminder settings. Apply the customer engagement migration and try again.'));
      return;
    }
    setConfiguration(result);
    const savedSettings = Object.fromEntries(Object.entries(result.settings).filter(([key]) => key !== 'timeZone'));
    setSettings({ ...DEFAULT_SETTINGS, ...savedSettings } as typeof DEFAULT_SETTINGS);
    setSelectedCampaigns(result.campaignIds ?? []);
    setTemplates(REMINDER_TYPES.map(({ id }) => result.pushTemplates?.find(template => template.eventType === id) ?? DEFAULT_TEMPLATES.find(template => template.eventType === id)!));
  }, [t]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const updateSetting = <K extends keyof typeof DEFAULT_SETTINGS>(key: K, value: (typeof DEFAULT_SETTINGS)[K]) => {
    setSettings(current => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const saved = await saveCompanyEngagementConfiguration(settings, selectedCampaigns, templates);
    setBusy(false);
    if (!saved) {
      setError(t('Could not save reminder settings. Check the selected campaigns and message variables.'));
      return;
    }
    setNotice(t('Reminder settings saved.'));
    await refresh();
  };

  const updateTemplate = (eventType: EngagementReminderType, key: 'title' | 'body', value: string) => {
    setTemplates(current => current.map(template => template.eventType === eventType ? { ...template, [key]: value } : template));
  };

  if (loading) return <div className="flex items-center justify-center rounded-2xl border bg-white py-16 text-muted-foreground"><LoaderCircle className="h-6 w-6 animate-spin" /></div>;

  const campaigns = configuration?.campaigns ?? [];
  const activity = configuration?.activity;

  return (
    <form onSubmit={save} className="space-y-5">
      <section className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary"><BellRing size={18} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{t('Automatic campaign reminders')}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('Invite customers to return without making notifications mandatory. Reminders are sent only with the customer’s separate marketing consent.')}</p>
          </div>
        </div>
        {activity && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ActivityMetric label={t('WhatsApp accepted in the last 30 days')} value={activity.whatsappSent30d} />
            <ActivityMetric label={t('Push accepted by browser in the last 30 days')} value={activity.pushAccepted30d} />
            <ActivityMetric label={t('Failed attempts in the last 30 days')} value={activity.failedAttempts30d} />
            <ActivityMetric label={t('Waiting in channel queues')} value={activity.pending} />
          </div>
        )}
        <label className="mt-5 flex items-start gap-3 rounded-xl border p-3.5">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={settings.enabled} onChange={event => updateSetting('enabled', event.target.checked)} />
          <span><span className="block text-sm font-semibold">{t('Enable automatic reminders')}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{t('Disabled by default. The service checks active campaigns and customer eligibility on the server.')}</span></span>
        </label>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
        <h3 className="font-semibold">{t('Reminder types and campaigns')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('Only enabled campaigns can be selected. Turning a campaign off suppresses its queued reminders.')}</p>
        <div className="mt-4 grid gap-3">
          {REMINDER_TYPES.map(type => (
            <label key={type.id} className="flex items-start gap-3 rounded-xl border p-3.5">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={type.id === 'return_reminder' ? settings.returnEnabled : type.id === 'mission_reminder' ? settings.missionEnabled : settings.rewardExpiringEnabled}
                onChange={event => updateSetting(type.id === 'return_reminder' ? 'returnEnabled' : type.id === 'mission_reminder' ? 'missionEnabled' : 'rewardExpiringEnabled', event.target.checked)}
              />
              <span><span className="block text-sm font-medium">{t(type.label)}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{t(type.description)}</span></span>
            </label>
          ))}
        </div>
        {campaigns.length ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {campaigns.map(campaign => (
              <label key={campaign.id} className="flex min-w-0 items-start gap-3 rounded-xl border p-3">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={selectedCampaigns.includes(campaign.id)} onChange={event => setSelectedCampaigns(current => event.target.checked ? [...new Set([...current, campaign.id])] : current.filter(id => id !== campaign.id))} />
                <span className="min-w-0 break-words text-sm">{campaign.name}</span>
              </label>
            ))}
          </div>
        ) : <p className="mt-4 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">{t('Create and activate a campaign before choosing it for reminders.')}</p>}
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
        <h3 className="font-semibold">{t('Channels and consent')}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('For each reminder, Stampfy chooses one channel. It uses your preferred channel when the customer has opted in and a destination is available, then falls back to the other enabled channel.')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CheckField label={t('Browser push')} checked={settings.pushEnabled} onChange={value => updateSetting('pushEnabled', value)} />
          <CheckField label={t('WhatsApp')} checked={settings.whatsappEnabled} onChange={value => updateSetting('whatsappEnabled', value)} />
        </div>
        <div className="mt-4 grid gap-1.5">
          <Label htmlFor="reminder-channel-priority">{t('Preferred channel')}</Label>
          <select id="reminder-channel-priority" value={settings.channelPriority} onChange={event => updateSetting('channelPriority', event.target.value as typeof settings.channelPriority)} className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm sm:max-w-md">
            <option value="push_first">{t('Browser push first, then WhatsApp')}</option>
            <option value="whatsapp_first">{t('WhatsApp first, then browser push')}</option>
          </select>
        </div>
        <p className="mt-3 flex gap-2 rounded-xl bg-muted/40 p-3 text-xs leading-5 text-muted-foreground"><ShieldCheck size={15} className="mt-0.5 shrink-0" />{t('Email reminders are unavailable because an email delivery provider is not configured. A missing contact or consent never blocks campaign participation.')}</p>
        {settings.whatsappEnabled && <p className="mt-2 text-xs text-muted-foreground">{t('Choose approved WhatsApp reminder templates in the Communications settings. If a template or customer opt-in is missing, Stampfy falls back to browser push when enabled.')}</p>}
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
        <h3 className="font-semibold">{t('Cadence and quiet hours')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('These limits apply across reminder types for each customer and business.')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField id="return-after-days" label={t('Inactive for days before the first reminder')} min={1} max={60} value={settings.returnAfterDays} onChange={value => updateSetting('returnAfterDays', value)} />
          <NumberField id="repeat-interval-days" label={t('Days between follow-up reminders')} min={1} max={60} value={settings.repeatIntervalDays} onChange={value => updateSetting('repeatIntervalDays', value)} />
          <NumberField id="reminder-campaign-max" label={t('Maximum reminders per campaign')} min={1} max={5} value={settings.maxRemindersPerCampaign} onChange={value => updateSetting('maxRemindersPerCampaign', value)} />
          <NumberField id="reward-expiry-days" label={t('Days before reward expiration')} min={1} max={14} value={settings.rewardExpiryDays} onChange={value => updateSetting('rewardExpiryDays', value)} />
          <NumberField id="reminder-weekly-max" label={t('Maximum reminders per customer in 7 days')} min={1} max={5} value={settings.maxPerCustomerPer7d} onChange={value => updateSetting('maxPerCustomerPer7d', value)} />
          <NumberField id="reminder-min-gap" label={t('Minimum hours between reminders')} min={1} max={720} value={settings.minGapHours} onChange={value => updateSetting('minGapHours', value)} />
        </div>
        <label className="mt-5 flex items-start gap-3 rounded-xl border p-3.5">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={settings.quietHoursEnabled} onChange={event => updateSetting('quietHoursEnabled', event.target.checked)} />
          <span><span className="block text-sm font-medium">{t('Respect quiet hours')}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{t('Uses the company time zone saved in Company settings.')}: <strong>{configuration?.settings.timeZone || 'UTC'}</strong></span></span>
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="quiet-start">{t('Quiet hours start')}</Label><Input id="quiet-start" type="time" value={settings.quietStart} onChange={event => updateSetting('quietStart', event.target.value)} disabled={!settings.quietHoursEnabled} /></div>
          <div className="grid gap-1.5"><Label htmlFor="quiet-end">{t('Quiet hours end')}</Label><Input id="quiet-end" type="time" value={settings.quietEnd} onChange={event => updateSetting('quietEnd', event.target.value)} disabled={!settings.quietHoursEnabled} /></div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-xs sm:p-6">
        <h3 className="font-semibold">{t('Browser message text')}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('Use the available variables. Text is rendered by the server and saved with each reminder for history.')}</p>
        <div className="mt-4 space-y-4">
          {REMINDER_TYPES.map(type => {
            const template = templates.find(item => item.eventType === type.id) ?? DEFAULT_TEMPLATES.find(item => item.eventType === type.id)!;
            return (
              <article key={type.id} className="rounded-xl border p-3.5 sm:p-4">
                <h4 className="text-sm font-semibold">{t(type.label)}</h4>
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-1.5"><Label htmlFor={`${type.id}-title`}>{t('Notification title')}</Label><Input id={`${type.id}-title`} maxLength={70} value={template.title} onChange={event => updateTemplate(type.id, 'title', event.target.value)} /></div>
                  <div className="grid gap-1.5"><Label htmlFor={`${type.id}-body`}>{t('Notification message')}</Label><textarea id={`${type.id}-body`} maxLength={220} rows={3} value={template.body} onChange={event => updateTemplate(type.id, 'body', event.target.value)} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
                  <div className="flex flex-wrap gap-1.5">{TEMPLATE_VARIABLES[type.id].map(variable => <span key={variable} className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">{'{{' + variable + '}}'}</span>)}</div>
                  <div className="rounded-lg bg-muted/40 p-3" aria-live="polite">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Sample reminder preview')}</p>
                    <p className="mt-2 break-words text-sm font-semibold">{renderTemplatePreview(template.title)}</p>
                    <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">{renderTemplatePreview(template.body)}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={busy}>{t('Reload')}</Button>
        <Button type="submit" disabled={busy} className="gap-2"><Save size={16} />{busy ? <LoaderCircle size={16} className="animate-spin" /> : null}{t('Save reminder settings')}</Button>
      </div>
    </form>
  );
};

const CheckField: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-3 rounded-xl border p-3.5 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={event => onChange(event.target.checked)} />{label}</label>
);

const NumberField: React.FC<{ id: string; label: string; min: number; max: number; value: number; onChange: (value: number) => void }> = ({ id, label, min, max, value, onChange }) => (
  <div className="grid gap-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" min={min} max={max} step={1} value={value} onChange={event => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} /></div>
);

const ActivityMetric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl bg-muted/40 p-3"><p className="text-xl font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{label}</p></div>
);
