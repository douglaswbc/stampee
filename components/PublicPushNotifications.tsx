import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Download, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useLocale } from './LocaleProvider';
import { Button } from './ui/button';
import {
  isPublicCustomerPushEnabled,
  registerPublicCustomerPushSubscription,
  revokePublicCustomerPushSubscription,
} from '../lib/db/publicPushNotifications';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const decodeApplicationServerKey = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const serializeSubscription = (subscription: PushSubscription) => {
  const keys = subscription.toJSON().keys;
  return keys?.p256dh && keys.auth ? {
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    expirationTime: subscription.expirationTime ? new Date(subscription.expirationTime).toISOString() : null,
  } : null;
};

export const PublicPushNotifications: React.FC<{ slug: string; cardUniqueId: string }> = ({ slug, cardUniqueId }) => {
  const { t } = useLocale();
  const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim() || '';
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [notice, setNotice] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    setStandalone(isStandalone);
    setIosNeedsInstall(isAppleMobile && !isStandalone);

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
      setIosNeedsInstall(false);
    };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    setPermission(supported ? Notification.permission : 'unsupported');
    if (!supported || !slug || !cardUniqueId) return;

    void navigator.serviceWorker.ready.then(async registration => {
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;
      if (!endpoint) {
        if (!cancelled) setActive(false);
        return;
      }
      const enabled = await isPublicCustomerPushEnabled(slug, cardUniqueId, endpoint);
      if (!cancelled) setActive(enabled);
    }).catch(() => {
      if (!cancelled) setActive(false);
    });
    return () => { cancelled = true; };
  }, [cardUniqueId, slug]);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const enable = async () => {
    setBusy(true);
    setNotice('');
    try {
      if (!window.isSecureContext) {
        setNotice(t('Push notifications require a secure HTTPS connection.'));
        return;
      }
      if (iosNeedsInstall) {
        setNotice(t('On iPhone or iPad, add Stampfy to your Home Screen, open it there, and then enable updates.'));
        return;
      }
      if (!publicKey) {
        setNotice(t('Push notifications are not configured yet.'));
        return;
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setNotice(t('Push notifications are not available in this browser. Your loyalty card will keep working.'));
        return;
      }

      let nextPermission = Notification.permission;
      if (nextPermission === 'default') nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== 'granted') {
        setNotice(nextPermission === 'denied'
          ? t('Notifications are blocked in browser settings. Your loyalty card will keep working.')
          : t('Allow notifications to receive loyalty updates. Your loyalty card will keep working either way.'));
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(publicKey),
        });
      const serialized = serializeSubscription(subscription);
      if (!serialized || !await registerPublicCustomerPushSubscription(slug, cardUniqueId, serialized)) {
        setNotice(t('We could not save this device. Please try again.'));
        return;
      }
      setActive(true);
      setNotice(t('Loyalty updates are enabled for this business on this device.'));
    } catch {
      setNotice(t('We could not enable notifications on this device. Your loyalty card will keep working.'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setNotice('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setActive(false);
        setNotice(t('This device no longer has an active push subscription.'));
        return;
      }
      const result = await revokePublicCustomerPushSubscription(slug, cardUniqueId, subscription.endpoint);
      if (!result.ok) {
        setNotice(t('We could not turn off updates for this business. Please try again.'));
        return;
      }
      if (result.unsubscribeBrowser) await subscription.unsubscribe();
      setActive(false);
      setNotice(t('Push updates for this business have been turned off.'));
    } catch {
      setNotice(t('We could not turn off push updates right now. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const pushSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const needsSecureOrigin = typeof window !== 'undefined' && !window.isSecureContext;
  const canInstall = !!installPrompt && !standalone;

  return (
    <section className="mx-auto mb-6 flex w-[calc(100%_-_2rem)] max-w-xl flex-col gap-3 rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm md:mx-0 md:w-full" aria-label={t('Browser notifications')}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary"><Bell size={17} /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{t('Loyalty updates on this device')}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('Get optional updates about visits, missions, and rewards linked to this card.')}</p>
        </div>
        {active && <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">{t('Enabled')}</span>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {active ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void disable()} disabled={busy} className="gap-2 self-start">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <BellOff size={15} />}
            {t('Turn off updates for this business')}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => void enable()} disabled={busy || needsSecureOrigin || (!pushSupported && !iosNeedsInstall)} className="gap-2 self-start">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Bell size={15} />}
            {t('Receive loyalty updates')}
          </Button>
        )}
        {canInstall && (
          <Button type="button" variant="outline" size="sm" onClick={() => void installApp()} className="gap-2 self-start">
            <Download size={15} />{t('Install Stampfy')}
          </Button>
        )}
      </div>

      {(iosNeedsInstall || needsSecureOrigin || !pushSupported) && !active && (
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          {iosNeedsInstall
            ? t('On iPhone or iPad, add Stampfy to your Home Screen, open it there, and then enable updates.')
            : needsSecureOrigin
              ? t('Push notifications require a secure HTTPS connection.')
              : !pushSupported
                ? t('Push notifications are not available in this browser. Your loyalty card will keep working.')
                : t('Notifications are blocked in browser settings. Your loyalty card will keep working.')}
        </p>
      )}

      {permission === 'denied' && <p role="status" className="text-xs leading-5 text-muted-foreground">{t('Notifications are blocked in browser settings. Your loyalty card will keep working.')}</p>}
      {notice && <p role="status" className="text-xs leading-5 text-muted-foreground">{notice}</p>}
    </section>
  );
};
