import React from 'react';
import { CheckCircle2, Clock3, Gift, Sparkles } from 'lucide-react';
import type { LoyaltyMission } from '../types';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';

interface MissionProgressListProps {
  missions: LoyaltyMission[];
}

const formatMissionDate = (value: string, locale: string) => new Intl.DateTimeFormat(locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export const MissionProgressList: React.FC<MissionProgressListProps> = ({ missions }) => {
  const { language, t } = useLocale();
  if (!missions.length) return null;

  return (
    <LocalizedTree>
    <section className="mx-4 mb-6 w-full max-w-xl rounded-3xl border border-black/5 bg-white/90 p-5 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.35)] backdrop-blur md:mx-0 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <Sparkles size={19} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Your missions</h2>
          <p className="mt-1 text-sm text-gray-600">Track your progress and see the reward for each challenge.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {missions.map(mission => {
          const progress = Math.min(mission.progress ?? 0, mission.goalCount);
          const progressPercent = mission.goalCount > 0 ? (progress / mission.goalCount) * 100 : 0;
          const startsInFuture = new Date(mission.startsAt).getTime() > Date.now();
          const ended = new Date(mission.endsAt).getTime() <= Date.now();
          const completed = mission.completedCount > 0;
          const isUnavailable = !mission.isActive || ended;

          return (
            <article key={mission.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{mission.name}</h3>
                  {mission.description && <p className="mt-1 text-sm leading-5 text-gray-600">{mission.description}</p>}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                  {completed ? 'Completed' : startsInFuture ? 'Upcoming' : isUnavailable ? 'Ended' : 'In progress'}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-800">
                  {mission.missionType === 'visit_count' ? 'Visits' : 'Stamps on this card'}
                </span>
                <span className="tabular-nums text-gray-600">{progress}/{mission.goalCount}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={mission.goalCount} aria-valuenow={progress} aria-label={`${mission.name} progress`}>
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
              </div>

              <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-gray-100 pt-3">
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <Gift size={16} className="mt-0.5 shrink-0 text-amber-700" />
                  <span>{mission.rewardDescription}</span>
                </div>
                {mission.availableRewards ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14} />
                    {t(mission.rewardType === 'catalog_reward' ? 'Catalog reward unlocked' : 'Reward ready')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">Ends {formatMissionDate(mission.endsAt, language)}</span>
                )}
              </div>
              {mission.availableRewards ? <p className="mt-2 text-xs text-gray-500">
                {mission.rewardType === 'catalog_reward'
                  ? t('Claim this reward in the catalog on this card. The team validates its code when delivering it.')
                  : t('Show this card to the team to claim your reward.')}
              </p> : null}
              {mission.completedCount > 0 && mission.maxCompletions > 1 && (
                <p className="mt-2 text-xs text-gray-500">Completed {mission.completedCount} of {mission.maxCompletions} times.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
    </LocalizedTree>
  );
};
