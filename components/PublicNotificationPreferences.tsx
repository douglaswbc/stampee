import React from 'react';
import { BellOff } from 'lucide-react';
import { revokePublicWhatsAppNotificationConsent } from '../lib/db/publicSignup';
import { useLocale } from './LocaleProvider';
import { Button } from './ui/button';

export const PublicNotificationPreferences: React.FC<{ slug: string; cardUniqueId: string }> = ({ slug, cardUniqueId }) => {
  const { t } = useLocale();
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');

  const stopUpdates = async () => {
    setBusy(true);
    setNotice('');
    const revoked = await revokePublicWhatsAppNotificationConsent(slug, cardUniqueId);
    setBusy(false);
    setNotice(revoked ? t('WhatsApp updates have been turned off.') : t('No WhatsApp subscription was found for this card.'));
  };

  return (
    <div className="mx-auto mb-6 flex w-[calc(100%_-_2rem)] max-w-xl flex-col gap-2 rounded-2xl border border-black/5 bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between md:mx-0 md:w-full">
      <p className="text-xs leading-5 text-muted-foreground">{t('Manage optional WhatsApp loyalty updates for this card.')}</p>
      <Button type="button" variant="ghost" size="sm" onClick={() => void stopUpdates()} disabled={busy} className="shrink-0 gap-2 self-start sm:self-auto">
        <BellOff size={15} />{busy ? t('Updating…') : t('Stop WhatsApp updates')}
      </Button>
      {notice && <p role="status" className="text-xs text-emerald-700 sm:basis-full">{notice}</p>}
    </div>
  );
};
