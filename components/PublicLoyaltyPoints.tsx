import React from 'react';
import { Award, Check, Copy, History, Share2, Sparkles } from 'lucide-react';
import type { CustomerLoyaltyPoints } from '../types';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';
import { Button } from './ui/button';

export const PublicLoyaltyPoints: React.FC<{ summary: CustomerLoyaltyPoints | null; referralUrl?: string | null }> = ({ summary, referralUrl }) => {
  const { language, t } = useLocale();
  const [shareNotice, setShareNotice] = React.useState('');
  if (!summary || (!summary.isEnabled && summary.balance === 0 && !summary.history.length && !summary.badges.length)) return null;

  const numberFormatter = new Intl.NumberFormat(language);
  const dateFormatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const pointsToNext = summary.pointsToNextLevel ?? 0;

  const copyReferralLink = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setShareNotice(t('Referral link copied.'));
    } catch {
      setShareNotice(t('Unable to copy the link. Try sharing it from your browser.'));
    }
  };

  const shareReferralLink = async () => {
    if (!referralUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('Join my loyalty campaign'),
          text: t('Invite a friend to this campaign. You earn half of their welcome points after their first verified visit.'),
          url: referralUrl,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        await copyReferralLink();
      }
      return;
    }
    await copyReferralLink();
  };

  return (
    <LocalizedTree>
      <section className="mx-auto mb-6 w-[calc(100%_-_2rem)] max-w-xl rounded-3xl border border-black/5 bg-white/90 p-4 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.35)] backdrop-blur sm:p-5 md:mx-0 md:w-full md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">{t('Loyalty balance')}</p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-gray-900">
              {numberFormatter.format(summary.balance)} <span className="text-base font-semibold">{t('points')}</span>
            </h2>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><Sparkles size={19} /></div>
        </div>

        {referralUrl && summary.isEnabled && (
          <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-4">
            <p className="text-sm leading-5 text-gray-700">{t('Invite a friend to this campaign. You earn half of their welcome points after their first verified visit, rounded down.')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void shareReferralLink()}>
                <Share2 size={15} className="mr-2" />{t('Share referral link')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyReferralLink()}>
                {shareNotice === t('Referral link copied.') ? <Check size={15} className="mr-2" /> : <Copy size={15} className="mr-2" />}
                {t('Copy referral link')}
              </Button>
            </div>
            {shareNotice && <p className="mt-2 text-xs text-emerald-700" role="status">{shareNotice}</p>}
          </div>
        )}

        <div className="mt-4 rounded-2xl bg-amber-50/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-900/65">{t('Current level')}</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{summary.currentLevel?.name ?? t('No level configured')}</p>
            </div>
            {summary.currentLevel && <Award size={21} className="mt-1 shrink-0 text-amber-700" />}
          </div>
          {summary.currentLevel?.benefit && <p className="mt-1 text-sm text-gray-600">{summary.currentLevel.benefit}</p>}
          {summary.nextLevel && (
            <div className="mt-4">
              <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-xs text-gray-600">
                <span>{t('Progress to')} {summary.nextLevel.name}</span>
                <span>{numberFormatter.format(pointsToNext)} {t('points to go')}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.progressPercent} aria-label={t('Progress to next level')}>
                <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${summary.progressPercent}%` }} />
              </div>
            </div>
          )}
          {!summary.nextLevel && summary.currentLevel && <p className="mt-3 text-xs font-medium text-amber-900">{t('You reached the highest level.')}</p>}
        </div>

        {!!summary.badges.length && (
          <div className="mt-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Award size={16} className="text-amber-700" />{t('Badges')}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {summary.badges.map((badge, index) => (
                <span key={`${badge.badgeKey}-${badge.earnedAt}-${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">
                  <Sparkles size={13} />{t(badge.badgeKey === 'first_visit' ? 'First visit' : 'Mission completed')}
                </span>
              ))}
            </div>
          </div>
        )}

        {!!summary.history.length && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><History size={16} className="text-gray-500" />{t('Points history')}</h3>
            <ul className="mt-2 space-y-2">
              {summary.history.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block text-gray-800">{entry.entryType === 'reward_redemption'
                      ? `${t('Reward redeemed')}: ${entry.description}`
                      : entry.entryType === 'reward_refund'
                        ? `${t('Reward points refunded')}: ${entry.description}`
                        : t(entry.description)}</span>
                    <span className="block text-xs text-gray-500">{dateFormatter.format(new Date(entry.createdAt))}</span>
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${entry.pointsDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {entry.pointsDelta > 0 ? '+' : ''}{numberFormatter.format(entry.pointsDelta)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </LocalizedTree>
  );
};
