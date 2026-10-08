import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bell, Check, CircleHelp, Clock3, Gift, LoaderCircle, LogOut, Mail, Plus, RefreshCw, ShieldCheck, Ticket, Trophy, Unlink } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { useLocale } from './LocaleProvider';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { CustomerPortalBusiness, CustomerPortalData } from '../lib/db/customerPortal';
import {
  claimCustomerPortalCard,
  claimCustomerPortalRecordsByEmail,
  fetchCustomerPortalData,
  initializeCustomerPortal,
  setCustomerPortalPushPreference,
  setCustomerPortalWhatsAppPreference,
  unlinkCustomerPortalBusiness,
} from '../lib/db/customerPortal';

const SERVICE_UNAVAILABLE_MESSAGE = 'Service is temporarily unavailable. Please try again later.';

function parseCardReference(value: string): { slug: string; uniqueId: string } | null {
  try {
    const parsed = new URL(value.trim(), window.location.origin);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0] === 'empresa') return null;
    const uniqueId = parts[1];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uniqueId)) return null;
    return { slug: decodeURIComponent(parts[0]), uniqueId };
  } catch {
    return null;
  }
}

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

const CustomerAccountPage: React.FC = () => {
  const { t, language } = useLocale();
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [portalData, setPortalData] = useState<CustomerPortalData | null>(null);
  const [email, setEmail] = useState('');
  const [cardReference, setCardReference] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [busyPreference, setBusyPreference] = useState<string | null>(null);
  const [busyUnlink, setBusyUnlink] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refreshPortal = useCallback(async () => {
    if (!session) {
      setPortalData(null);
      return;
    }
    setLoadingData(true);
    setError('');
    const initialized = await initializeCustomerPortal();
    if (!initialized.ok) {
      setError(t('We could not verify this customer account. Open the sign-in link again and try once more.'));
      setLoadingData(false);
      return;
    }
    const data = await fetchCustomerPortalData();
    if (!data) {
      setError(t('Your customer history could not be loaded. Please try again.'));
      setLoadingData(false);
      return;
    }
    setPortalData(data);
    setLoadingData(false);
  }, [session, t]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setCheckingSession(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSentTo('');
      setNotice('');
      setError('');
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!checkingSession) void refreshPortal();
  }, [checkingSession, refreshPortal]);

  const requestSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setRequestBusy(true);
    setError('');
    setNotice('');
    const { data: portalAvailable, error: availabilityError } = await supabase.rpc('customer_portal_is_available');
    if (availabilityError || portalAvailable !== true) {
      setRequestBusy(false);
      setError(t('The customer account is not ready yet. Please try again later.'));
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/account`,
        data: { stampfy_account_type: 'customer' },
      },
    });
    setRequestBusy(false);
    if (authError) {
      setError(t('We could not send the sign-in link. Check the email and try again.'));
      return;
    }
    setSentTo(normalizedEmail);
  };

  const linkEmailHistory = async () => {
    setRequestBusy(true);
    setError('');
    setNotice('');
    const linkedCount = await claimCustomerPortalRecordsByEmail();
    if (linkedCount === null) {
      setError(t('We could not link cards registered with this verified email. Please try again.'));
    } else {
      setNotice(linkedCount === 1
        ? t('1 card history was linked to your account.')
        : t('{{count}} card histories were linked to your account.').replace('{{count}}', String(linkedCount)));
      await refreshPortal();
    }
    setRequestBusy(false);
  };

  const linkCard = async (event: React.FormEvent) => {
    event.preventDefault();
    const reference = parseCardReference(cardReference);
    if (!reference) {
      setError(t('Enter the full public card link, including its business URL and card ID.'));
      return;
    }
    setRequestBusy(true);
    setError('');
    setNotice('');
    const linked = await claimCustomerPortalCard(reference.slug, reference.uniqueId);
    if (!linked) {
      setError(t('We could not link this card. Check the link or contact the business that issued it.'));
    } else {
      setCardReference('');
      setNotice(t('Card history linked to your account.'));
      await refreshPortal();
    }
    setRequestBusy(false);
  };

  const toggleWhatsApp = async (business: CustomerPortalBusiness, enabled: boolean) => {
    const key = `${business.ownerId}:${business.customerId}`;
    setBusyPreference(key);
    setError('');
    setNotice('');
    const saved = await setCustomerPortalWhatsAppPreference(business.ownerId, business.customerId, enabled);
    if (!saved) {
      setError(enabled
        ? t('Add a mobile number with this business before enabling WhatsApp updates.')
        : t('We could not update this preference. Please try again.'));
    } else {
      setNotice(t('Notification preference saved.'));
      await refreshPortal();
    }
    setBusyPreference(null);
  };

  const togglePush = async (business: CustomerPortalBusiness, enabled: boolean) => {
    const key = `${business.ownerId}:${business.customerId}`;
    setBusyPreference(key);
    setError('');
    setNotice('');
    const saved = await setCustomerPortalPushPreference(business.ownerId, business.customerId, enabled);
    if (!saved) {
      setError(enabled
        ? t('Activate push from this business card on a device first.')
        : t('We could not update this preference. Please try again.'));
    } else {
      setNotice(t('Notification preference saved.'));
      await refreshPortal();
    }
    setBusyPreference(null);
  };

  const unlinkBusiness = async (business: CustomerPortalBusiness) => {
    const confirmed = window.confirm(t('Remove this business from your Stampfy account? Its records will stay with the business, and WhatsApp and push loyalty updates for this customer record will be turned off.'));
    if (!confirmed) return;
    const key = `${business.ownerId}:${business.customerId}`;
    setBusyUnlink(key);
    setError('');
    setNotice('');
    const removed = await unlinkCustomerPortalBusiness(business.ownerId, business.customerId);
    if (!removed) {
      setError(t('We could not remove this business from your account. Please try again.'));
    } else {
      setNotice(t('Business removed from your account. The business records were kept.'));
      await refreshPortal();
    }
    setBusyUnlink(null);
  };

  const signOut = async () => {
    setRequestBusy(true);
    await supabase.auth.signOut();
    setPortalData(null);
    setRequestBusy(false);
  };

  if (!isSupabaseConfigured) {
    return <main className="min-h-screen bg-muted/30 px-4 py-16 text-center text-muted-foreground">{SERVICE_UNAVAILABLE_MESSAGE}</main>;
  }

  if (checkingSession) {
    return <main className="flex min-h-screen items-center justify-center"><LoaderCircle className="h-7 w-7 animate-spin text-muted-foreground" /></main>;
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-muted/30 px-4 py-10 sm:px-6 sm:py-16">
        <section className="mx-auto w-full max-w-xl rounded-3xl border border-border bg-card p-6 shadow-subtle sm:p-9">
          <Link to="/" className="text-xl font-black tracking-tight text-foreground">Stampfy</Link>
          <div className="mt-8 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Ticket size={24} /></div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t('Customer account')}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">{t('Your loyalty, in one place')}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('Save cards from different businesses, follow your progress, and check your rewards with one verified email.')}</p>

          {sentTo ? (
            <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="flex items-start gap-3"><Mail className="mt-0.5 h-5 w-5 shrink-0" /><p>{t('A secure sign-in link was sent to')} <strong>{sentTo}</strong>. {t('Open it on this device to see your customer account.')}</p></div>
            </div>
          ) : (
            <form onSubmit={requestSignIn} className="mt-7 space-y-4">
              <label className="grid gap-2 text-sm font-medium text-foreground" htmlFor="customer-account-email">
                {t('Email address')}
                <Input id="customer-account-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className="h-12 rounded-xl" />
              </label>
              <Button type="submit" disabled={requestBusy} className="h-12 w-full rounded-xl gap-2">
                {requestBusy ? <LoaderCircle size={17} className="animate-spin" /> : <Mail size={17} />}
                {t('Send a secure sign-in link')}
              </Button>
            </form>
          )}

          {error && <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <p className="mt-6 flex gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck size={15} className="mt-0.5 shrink-0" />{t('Your account is optional. Campaign signup and existing cards continue to work without an account.')}</p>
          <Link to="/login" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{t('Back to Stampfy')} <ArrowUpRight size={15} /></Link>
        </section>
      </main>
    );
  }

  const locale = language === 'pt-BR' ? 'pt-BR' : language === 'es' ? 'es-ES' : 'en-US';

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link to="/" className="text-lg font-black tracking-tight text-foreground">Stampfy</Link>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t('Customer account')}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('Your loyalty, in one place')}</h1>
            <p className="mt-2 break-all text-sm text-muted-foreground">{portalData?.email ?? session.user.email}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void signOut()} disabled={requestBusy} className="gap-2 self-start sm:self-auto"><LogOut size={16} />{t('Sign out')}</Button>
        </header>

        <section className="mt-6 grid gap-4 rounded-2xl border border-border bg-card p-4 shadow-subtle sm:grid-cols-2 sm:p-5">
          <div>
            <div className="flex items-start gap-3"><div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary"><Mail size={18} /></div><div><h2 className="font-semibold text-foreground">{t('Find cards by verified email')}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{t('Link customer records that use this verified email. This does not change the business records.')}</p></div></div>
            <Button type="button" variant="outline" onClick={() => void linkEmailHistory()} disabled={requestBusy} className="mt-4 w-full gap-2 sm:w-auto"><RefreshCw size={15} />{t('Find my cards')}</Button>
          </div>
          <form onSubmit={linkCard} className="border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <div className="flex items-start gap-3"><div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary"><Plus size={18} /></div><div><h2 className="font-semibold text-foreground">{t('Add a card with its link')}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{t('Paste the full card link you received from the business.')}</p></div></div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input value={cardReference} onChange={event => setCardReference(event.target.value)} placeholder="https://stampfy.com/business/card-id" aria-label={t('Full public card link')} className="min-w-0" /><Button type="submit" disabled={requestBusy || !cardReference.trim()} className="gap-2"><Plus size={15} />{t('Link card')}</Button></div>
          </form>
        </section>

        {(notice || error) && <div role={error ? 'alert' : 'status'} className={`mt-4 rounded-xl border p-3 text-sm ${error ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{error || notice}</div>}

        <div className="mt-8 flex items-center justify-between gap-3">
          <div><h2 className="text-xl font-bold text-foreground">{t('Your businesses')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('Cards and rewards you have linked to this account.')}</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={() => void refreshPortal()} disabled={loadingData} aria-label={t('Refresh')}><RefreshCw size={17} className={loadingData ? 'animate-spin' : ''} /></Button>
        </div>

        {loadingData ? (
          <div className="mt-5 flex items-center justify-center rounded-2xl border border-border bg-card py-16 text-muted-foreground"><LoaderCircle className="h-6 w-6 animate-spin" /></div>
        ) : portalData?.businesses.length ? (
          <div className="mt-4 space-y-5">
            {portalData.businesses.map(business => <BusinessHistoryCard
              key={`${business.ownerId}:${business.customerId}`}
              business={business}
              locale={locale}
              t={t}
              busyPreference={busyPreference === `${business.ownerId}:${business.customerId}`}
              busyUnlink={busyUnlink === `${business.ownerId}:${business.customerId}`}
              onWhatsAppChange={enabled => void toggleWhatsApp(business, enabled)}
              onPushChange={enabled => void togglePush(business, enabled)}
              onUnlink={() => void unlinkBusiness(business)}
            />)}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card px-5 py-12 text-center">
            <CircleHelp className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 font-semibold text-foreground">{t('No cards are linked yet')}</h3>
            <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{t('Find records registered with your verified email or add a card using the link provided by a business.')}</p>
          </div>
        )}

        <p className="mt-8 flex gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck size={15} className="mt-0.5 shrink-0" />{t('Each business can only manage its own loyalty records. Your account brings together only the cards you link.')}</p>
      </div>
    </main>
  );
};

const BusinessHistoryCard: React.FC<{
  business: CustomerPortalBusiness;
  locale: string;
  t: (source: string) => string;
  busyPreference: boolean;
  busyUnlink: boolean;
  onWhatsAppChange: (enabled: boolean) => void;
  onPushChange: (enabled: boolean) => void;
  onUnlink: () => void;
}> = ({ business, locale, t, busyPreference, busyUnlink, onWhatsAppChange, onPushChange, onUnlink }) => (
  <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-subtle">
    <header className="flex flex-col gap-3 border-b border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div><h3 className="text-lg font-bold text-foreground">{business.businessName}</h3><p className="mt-0.5 text-sm text-muted-foreground">{business.customerName}</p></div>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"><Trophy size={16} className="text-amber-600" /><span className="font-semibold text-foreground">{business.pointsBalance}</span><span className="text-muted-foreground">{t('points')}</span></div>
    </header>

    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-2">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Ticket size={16} />{t('Loyalty cards')}</h4>
        {business.cards.length ? <div className="mt-3 space-y-3">{business.cards.map(card => (
          <article key={card.uniqueId} className="rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium text-foreground">{card.campaignName}</p><p className="mt-1 text-xs text-muted-foreground">{t('Last visit')}: {formatDate(card.lastVisit, locale)}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${card.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{card.status === 'Active' ? t('In progress') : t('Completed')}</span></div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{card.stamps}{card.totalStamps ? `/${card.totalStamps}` : ''} {t('stamps')}</span><Link to={`/${business.slug}/${card.uniqueId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{t('Open card')} <ArrowUpRight size={14} /></Link></div>
          </article>
        ))}</div> : <p className="mt-3 text-sm text-muted-foreground">{t('No cards are available for this business yet.')}</p>}

        {business.activeMissions.length > 0 && <div className="mt-5"><h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Check size={16} />{t('Active missions')}</h4><ul className="mt-2 space-y-2">{business.activeMissions.map((mission, index) => <li key={`${mission.id}:${index}`} className="rounded-lg bg-muted/40 px-3 py-2 text-sm"><span className="font-medium text-foreground">{mission.name}</span><span className="mt-1 block text-xs text-muted-foreground">{mission.progress}/{mission.goalCount} {t(mission.missionType === 'visit_count' ? 'visits' : 'stamps')} · {mission.rewardDescription}</span></li>)}</ul></div>}

        {business.missions.length > 0 && <div className="mt-5"><h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Check size={16} />{t('Completed missions')}</h4><ul className="mt-2 space-y-2">{business.missions.map((mission, index) => <li key={`${mission.name}:${mission.completedAt}:${index}`} className="rounded-lg bg-muted/40 px-3 py-2 text-sm"><span className="font-medium text-foreground">{mission.name}</span><span className="block text-xs text-muted-foreground">{mission.rewardDescription} · {formatDate(mission.completedAt, locale)}</span></li>)}</ul></div>}
      </div>

      <div className="space-y-5">
        <div><h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Gift size={16} />{t('Rewards')}</h4>
          {business.rewards.length ? <ul className="mt-3 space-y-2">{business.rewards.slice(0, 8).map(reward => <li key={`${reward.code}:${reward.issuedAt}`} className="rounded-xl border border-border p-3"><div className="flex items-start justify-between gap-2"><span className="font-medium text-foreground">{reward.name}</span><span className="text-xs text-muted-foreground">{t(reward.status === 'issued' ? 'Available' : reward.status === 'redeemed' ? 'Redeemed' : reward.status === 'expired' ? 'Expired' : 'Cancelled')}</span></div><p className="mt-1 text-xs text-muted-foreground">{reward.description}</p>{reward.status === 'issued' && <p className="mt-2 break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{reward.code}</p>}<p className="mt-2 text-[11px] text-muted-foreground">{t('Expires')}: {formatDate(reward.expiresAt, locale)}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{t('No rewards linked to this account yet.')}</p>}
        </div>

        <div className="rounded-xl border border-border p-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Bell size={16} />{t('Communication preferences')}</h4>
          <label className={`mt-3 flex items-start justify-between gap-3 ${business.hasMobile || business.whatsappLoyaltyEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <span><span className="block text-sm font-medium text-foreground">{t('WhatsApp loyalty updates')}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{business.hasMobile ? t('Allow this business to send updates about visits, missions, and rewards on WhatsApp.') : business.whatsappLoyaltyEnabled ? t('You can turn off WhatsApp updates even if this business no longer has your mobile number.') : t('Add a mobile number with this business before enabling WhatsApp updates.')}</span></span>
            <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={business.whatsappLoyaltyEnabled} disabled={(!business.hasMobile && !business.whatsappLoyaltyEnabled) || busyPreference} onChange={event => onWhatsAppChange(event.target.checked)} aria-label={t('WhatsApp loyalty updates')} />
          </label>
          <label className={`mt-3 flex items-start justify-between gap-3 ${business.hasPushSubscription || business.pushLoyaltyEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <span><span className="block text-sm font-medium text-foreground">{t('Browser loyalty updates')}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{business.hasPushSubscription ? t('Allow this business to send visit, mission, and reward updates as browser notifications.') : business.pushLoyaltyEnabled ? t('No active browser subscription is linked now. Open a card on a device to enable it again.') : t('Open a card from this business on the device where you want to receive notifications.')}</span></span>
            <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={business.pushLoyaltyEnabled} disabled={(!business.hasPushSubscription && !business.pushLoyaltyEnabled) || busyPreference} onChange={event => onPushChange(event.target.checked)} aria-label={t('Browser loyalty updates')} />
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={onUnlink} disabled={busyUnlink || busyPreference} className="mt-3 gap-2 px-0 text-destructive hover:bg-transparent hover:text-destructive"><Unlink size={14} />{busyUnlink ? t('Removing...') : t('Remove this business from my account')}</Button>
        </div>

        {business.pointsHistory.length > 0 && <div><h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Clock3 size={16} />{t('Recent points activity')}</h4><ul className="mt-2 space-y-2">{business.pointsHistory.slice(0, 5).map((entry, index) => <li key={`${entry.createdAt}:${index}`} className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 text-muted-foreground">{entry.description}<span className="block text-xs">{formatDate(entry.createdAt, locale)}</span></span><span className={`shrink-0 font-semibold ${entry.delta > 0 ? 'text-emerald-700' : 'text-foreground'}`}>{entry.delta > 0 ? '+' : ''}{entry.delta}</span></li>)}</ul></div>}
      </div>
    </div>
  </section>
);

export default CustomerAccountPage;
