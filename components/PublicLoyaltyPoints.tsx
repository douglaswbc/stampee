import React from 'react';
import { Award, History, Sparkles } from 'lucide-react';
import type { CustomerLoyaltyPoints } from '../types';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';

export const PublicLoyaltyPoints: React.FC<{ summary: CustomerLoyaltyPoints | null }> = ({ summary }) => {
  const { language, t } = useLocale();
  if (!summary || (!summary.isEnabled && summary.balance === 0 && !summary.history.length && !summary.badges.length)) return null;

  const numberFormatter = new Intl.NumberFormat(language);
  const dateFormatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const pointsToNext = summary.pointsToNextLevel ?? 0;

  return (
    <LocalizedTree>
      <section className="mx-4 mb-6 w-full max-w-xl rounded-3xl border border-black/5 bg-white/90 p-5 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.35)] backdrop-blur md:mx-0 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">{t('Loyalty balance')}</p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-gray-900">
              {numberFormatter.format(summary.balance)} <span className="text-base font-semibold">{t('points')}</span>
            </h2>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><Sparkles size={19} /></div>
        </div>

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
              <div className="mb-1.5 flex justify-between gap-3 text-xs text-gray-600">
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
