import React, { useEffect, useState } from 'react';
import { LocalizedTree } from './LocalizedTree';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLocale } from './LocaleProvider';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { fetchPublicCampaignSignupContext, registerPublicCampaignSignup } from '../lib/db/publicSignup';
import { isSupabaseConfigured } from '../lib/supabase';

const SERVICE_UNAVAILABLE_MESSAGE = 'Service is temporarily unavailable. Please try again later.';

export const PublicCampaignSignupPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLocale();
  const { slug, campaignId } = useParams<{ slug: string; campaignId: string }>();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref') ?? '';
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [preRedirectMessage, setPreRedirectMessage] = useState('');
  const [error, setError] = useState('');
  const [context, setContext] = useState<Awaited<ReturnType<typeof fetchPublicCampaignSignupContext>>>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !slug || !campaignId) {
      setLoading(false);
      return;
    }

    let active = true;
    void (async () => {
      const payload = await fetchPublicCampaignSignupContext(slug, campaignId);
      if (!active) return;
      setContext(payload);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [campaignId, slug]);

  const disabled = context?.campaign.isEnabled === false;
  const bonusRequiresContact = !!context && context.pointsEnabled && context.welcomePoints > 0;
  const isShowingPreRedirectLoader = preRedirectMessage.length > 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!slug || !campaignId) {
      setError('Invalid signup link.');
      return;
    }
    if ((bonusRequiresContact || referralCode) && !email.trim() && !mobile.trim()) {
      setError('Add an email or mobile number to qualify for welcome or referral points.');
      return;
    }

    setSubmitting(true);
    const result = await registerPublicCampaignSignup({
      slug,
      campaignId,
      name: trimmedName,
      email,
      mobile,
      referralCode,
      whatsappOptIn: whatsappOptIn && !!mobile.trim(),
    });

    if (result.outcome === 'issued' || result.outcome === 'redirect_existing') {
      setPreRedirectMessage(
        result.outcome === 'issued'
          ? 'Generating your loyalty card. Please wait...'
          : 'Redirecting to your loyalty card. Please wait...'
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
      navigate(`/${slug}/${result.uniqueId}`, { replace: true });
      return;
    }

    setSubmitting(false);

    if (result.outcome === 'campaign_disabled_no_existing') {
      setError('New signups are paused for this campaign. If you already have an in-progress card, enter the same email or mobile number you used before.');
      return;
    }

    setError(result.error);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="h-screen flex items-center justify-center px-6 text-center text-muted-foreground">
        {SERVICE_UNAVAILABLE_MESSAGE}
      </div>
    );
  }

  if (!context) {
    return (
      <div className="h-screen flex items-center justify-center px-6 text-center text-muted-foreground">
        Campaign signup link is invalid.
      </div>
    );
  }

  return (
    <LocalizedTree>
    <div className="min-h-screen bg-[#f5f5f7] px-4 py-10 sm:px-6 sm:py-14">
      {isShowingPreRedirectLoader && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-6 text-center shadow-[0_18px_52px_-36px_rgba(0,0,0,0.45)]">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#1d1d1f] border-t-transparent" />
            <p className="mt-4 text-sm font-medium text-[#1d1d1f]" aria-live="polite">
              {preRedirectMessage}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#efeff1]">
              <div className="h-full w-full origin-left animate-pulse rounded-full bg-[#1d1d1f]" />
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto w-full max-w-xl">
        <section className="rounded-[2rem] border border-black/[0.08] bg-white p-4 shadow-[0_24px_64px_-38px_rgba(0,0,0,0.35)] sm:p-8">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#6e6e73]">Loyalty Signup</p>
          <h1 className="mt-3 text-[clamp(1.9rem,5vw,2.7rem)] font-black leading-[0.96] tracking-[-0.03em] text-[#1d1d1f]">
            {context.owner.businessName}
          </h1>
          <p className="mt-3 text-[0.98rem] leading-7 text-[#4f5258]">
            Join <span className="font-semibold text-[#1d1d1f]">{context.campaign.name}</span> to start collecting stamps.
          </p>

          {bonusRequiresContact && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <p>{t('New customers receive')} <strong>{context.welcomePoints}</strong> {t('welcome points once per business.')}</p>
              <p className="mt-1">{t('Enter an email or mobile number to qualify for welcome or referral points.')}</p>
              {referralCode && <p className="mt-1">{t('Your inviter earns half after your first verified visit, rounded down.')}</p>}
            </div>
          )}

          {!bonusRequiresContact && referralCode && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <p>{t('Enter an email or mobile number to qualify for welcome or referral points.')}</p>
            </div>
          )}

          {disabled && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              New signups are currently paused for this campaign. If you already have an in-progress card, enter the same email or mobile to continue.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div className="grid gap-2">
              <Label htmlFor="name" className="text-sm font-medium text-[#1d1d1f]">
                Name <span className="text-[#d73a49]">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                required
                className="h-12 rounded-xl border-black/10 text-[#1d1d1f] placeholder:text-[#8f9197]"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email" className="text-sm font-medium text-[#1d1d1f]">
                Email <span className="text-[#6e6e73]">(Optional)</span>
              </Label>
              <Input
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                type="email"
                className="h-12 rounded-xl border-black/10 text-[#1d1d1f] placeholder:text-[#8f9197]"
              />
              <p className="text-xs leading-5 text-[#6e6e73]">Used for card recovery and reward updates.</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mobile" className="text-sm font-medium text-[#1d1d1f]">
                Mobile Number <span className="text-[#6e6e73]">(Optional)</span>
              </Label>
              <Input
                id="mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="09xxxxxxxxx"
                autoComplete="tel"
                className="h-12 rounded-xl border-black/10 text-[#1d1d1f] placeholder:text-[#8f9197]"
              />
              <p className="text-xs leading-5 text-[#6e6e73]">Helps staff find your card quickly.</p>
            </div>

            <div className="rounded-xl border border-black/10 bg-[#fafafa] p-4">
              <label htmlFor="whatsapp-updates" className="flex items-start gap-3 text-sm leading-6 text-[#34363a]">
                <input
                  id="whatsapp-updates"
                  type="checkbox"
                  checked={whatsappOptIn}
                  onChange={(event) => setWhatsappOptIn(event.target.checked)}
                  disabled={!mobile.trim()}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#1d1d1f]"
                />
                <span>{t('I agree to receive loyalty updates and offers by WhatsApp. Optional; I can opt out later.')}</span>
              </label>
              {!mobile.trim() && <p className="mt-2 pl-7 text-xs text-[#6e6e73]">{t('Add a mobile number to enable WhatsApp updates.')}</p>}
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#1d1d1f] text-sm font-semibold text-white hover:bg-black/85"
              disabled={submitting}
            >
              {submitting ? 'Checking your card...' : 'Get My Loyalty Card'}
            </Button>
          </form>
        </section>
      </div>
    </div>
    </LocalizedTree>
  );
};
