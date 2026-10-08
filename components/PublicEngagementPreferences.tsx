import React from 'react';
import { BellRing, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useLocale } from './LocaleProvider';
import {
  getPublicCustomerEngagementPreferences,
  setPublicCustomerEngagementPreference,
  type EngagementChannel,
} from '../lib/db/customerEngagement';

export const PublicEngagementPreferences: React.FC<{ slug: string; cardUniqueId: string }> = ({ slug, cardUniqueId }) => {
  const { t } = useLocale();
  const [preferences, setPreferences] = React.useState<Awaited<ReturnType<typeof getPublicCustomerEngagementPreferences>>>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<EngagementChannel | null>(null);
  const [notice, setNotice] = React.useState('');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const result = await getPublicCustomerEngagementPreferences(slug, cardUniqueId);
    setPreferences(result);
    setLoading(false);
  }, [cardUniqueId, slug]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const update = async (channel: EngagementChannel, enabled: boolean) => {
    setBusy(channel);
    setNotice('');
    const saved = await setPublicCustomerEngagementPreference(slug, cardUniqueId, channel, enabled);
    if (!saved) {
      setNotice(enabled
        ? channel === 'whatsapp'
          ? t('A mobile number is required to receive campaign reminders on WhatsApp.')
          : t('Activate browser notifications for this card before opting into push reminders.')
        : t('We could not update this preference. Please try again.'));
    } else {
      setNotice(t('Campaign reminder preference saved.'));
      await refresh();
    }
    setBusy(null);
  };

  if (loading || !preferences) return null;

  return (
    <section className="mx-auto mb-6 flex w-[calc(100%_-_2rem)] max-w-xl flex-col gap-3 rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm md:mx-0 md:w-full">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary"><BellRing size={16} /></span>
        <div><h2 className="text-sm font-semibold text-foreground">{t('Optional campaign reminders')}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('Choose separately whether this business may send return, mission, and reward reminders. Loyalty updates and campaign participation stay available either way.')}</p></div>
      </div>
      <label className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${preferences.hasMobile || preferences.whatsappEnabled ? '' : 'opacity-60'}`}>
        <span><span className="block text-sm font-medium">{t('WhatsApp campaign reminders')}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{preferences.hasMobile ? t('Allow this business to send optional campaign reminders to your phone.') : t('Add a mobile number with this business to use WhatsApp reminders.')}</span></span>
        <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={preferences.whatsappEnabled} disabled={busy !== null || (!preferences.hasMobile && !preferences.whatsappEnabled)} onChange={event => void update('whatsapp', event.target.checked)} aria-label={t('WhatsApp campaign reminders')} />
      </label>
      <label className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${preferences.hasPushSubscription || preferences.pushEnabled ? '' : 'opacity-60'}`}>
        <span><span className="block text-sm font-medium">{t('Browser push campaign reminders')}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{preferences.hasPushSubscription ? t('Allow optional reminders as notifications on this device.') : t('First activate browser notifications in the card above on this device.')}</span></span>
        <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={preferences.pushEnabled} disabled={busy !== null || (!preferences.hasPushSubscription && !preferences.pushEnabled)} onChange={event => void update('push', event.target.checked)} aria-label={t('Browser push campaign reminders')} />
      </label>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck size={14} className="mt-0.5 shrink-0" />{t('You can turn these reminders off here or in your Stampfy customer account. The business cannot turn them back on for you.')}</p>
      {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" />{t('Updating…')}</p>}
      {notice && <p role="status" className="text-xs leading-5 text-muted-foreground">{notice}</p>}
    </section>
  );
};
