import React, { useCallback, useEffect, useState } from 'react';
import { Gift, QrCode, TicketCheck } from 'lucide-react';
import type { LoyaltyRewardRedemption, PublicLoyaltyReward } from '../types';
import {
  claimPublicLoyaltyReward,
  claimPublicMissionCatalogReward,
  fetchPublicLoyaltyRewardRedemptions,
  fetchPublicLoyaltyRewards,
} from '../lib/db/rewards';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';
import { Button } from './ui/button';
import { QrCodeDisplay } from './ui/qr-code-display';

interface PublicLoyaltyRewardsProps {
  slug: string;
  cardUniqueId: string;
  onPointsRefresh?: () => Promise<void>;
}

const formatDate = (value: string, language: string) => new Intl.DateTimeFormat(language, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const redemptionStatus = (status: LoyaltyRewardRedemption['status'], t: (source: string) => string) => t({
  issued: 'Issued', redeemed: 'Redeemed', expired: 'Expired', cancelled: 'Cancelled',
}[status]);

export const PublicLoyaltyRewards: React.FC<PublicLoyaltyRewardsProps> = ({ slug, cardUniqueId, onPointsRefresh }) => {
  const { t, language } = useLocale();
  const [rewards, setRewards] = useState<PublicLoyaltyReward[]>([]);
  const [redemptions, setRedemptions] = useState<LoyaltyRewardRedemption[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [requestKeys, setRequestKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newCode, setNewCode] = useState<{ code: string; rewardName: string; expiresAt: string; missionName?: string } | null>(null);
  const [expandedQrId, setExpandedQrId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rewardsResult, redemptionsResult] = await Promise.all([
      fetchPublicLoyaltyRewards(slug, cardUniqueId),
      fetchPublicLoyaltyRewardRedemptions(slug, cardUniqueId),
    ]);
    if (rewardsResult.ok) {
      setRewards(rewardsResult.data.rewards);
      setBalance(rewardsResult.data.balance);
    }
    if (redemptionsResult.ok) setRedemptions(redemptionsResult.redemptions);
    if (!rewardsResult.ok || !redemptionsResult.ok) setError(t('Unable to load rewards right now. Refresh this card and try again.'));
    else setError('');
    setLoading(false);
  }, [cardUniqueId, slug, t]);

  useEffect(() => { void load(); }, [load]);

  const handleClaim = async (reward: PublicLoyaltyReward) => {
    setError('');
    setNotice('');
    setClaimingId(reward.id);
    const requestKey = requestKeys[reward.id] ?? globalThis.crypto.randomUUID();
    setRequestKeys(current => ({ ...current, [reward.id]: requestKey }));
    const missionEntitlement = reward.missionCompletions?.[0];
    const result = missionEntitlement
      ? await claimPublicMissionCatalogReward({
        slug,
        cardUniqueId,
        completionId: missionEntitlement.completionId,
        idempotencyKey: requestKey,
      })
      : await claimPublicLoyaltyReward({
        slug,
        cardUniqueId,
        rewardId: reward.id,
        idempotencyKey: requestKey,
      });
    setClaimingId(null);
    if (!result.ok) {
      const errorKey = result.error === 'not_eligible' ? 'This reward is not available for your points balance.'
        : result.error === 'sold_out' ? 'This reward is out of stock.'
          : result.error === 'customer_limit' ? 'You have reached the claim limit for this reward.'
            : 'This reward is no longer available. Refresh and try again.';
      setError(t(errorKey));
      await load();
      return;
    }
    setRequestKeys(current => {
      const next = { ...current };
      delete next[reward.id];
      return next;
    });
    setNewCode({
      code: result.claim.code,
      rewardName: reward.name,
      expiresAt: result.claim.expiresAt,
      missionName: missionEntitlement?.missionName,
    });
    setBalance(result.claim.balance);
    setNotice(t('Reward claimed. Show this code to the team before it expires.'));
    await load();
    await onPointsRefresh?.();
  };

  if (loading || (!rewards.length && !redemptions.length && !error)) return null;

  return (
    <LocalizedTree>
      <section className="mx-auto mb-6 w-[calc(100%_-_2rem)] max-w-xl rounded-3xl border border-black/5 bg-white/90 p-4 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.35)] backdrop-blur sm:p-5 md:mx-0 md:w-full md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">{t('Rewards')}</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">{t('Claim a reward')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('Available points')}: {new Intl.NumberFormat(language).format(balance)}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Gift size={19} /></div>
        </div>

        {newCode && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" role="status">
            <p className="text-sm font-semibold text-emerald-900">{t('Your reward code')}: {newCode.rewardName}</p>
            {newCode.missionName && <p className="mt-1 text-xs text-emerald-800">{t('Unlocked by mission')}: {newCode.missionName}</p>}
            <p className="mt-2 break-all rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold tracking-[0.12em] text-gray-900">{newCode.code}</p>
            <div className="mt-3 flex flex-col items-center gap-2 rounded-xl bg-white p-4">
              <QrCodeDisplay value={newCode.code} label="Reward redemption QR code" className="h-44 w-44" />
              <p className="text-center text-xs text-emerald-900/75">{t('Show this QR code to the team.')}</p>
            </div>
            <p className="mt-2 text-xs text-emerald-900/75">{t('Valid until')} {formatDate(newCode.expiresAt, language)}</p>
          </div>
        )}
        {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}

        {!!rewards.length && (
          <div className="mt-4 space-y-3">
            {rewards.map(reward => (
              <article key={reward.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-semibold text-gray-900">{reward.name}</h3>
                    <p className="mt-1 text-sm text-gray-600">{reward.description}</p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {reward.missionCompletions?.length
                      ? t('Mission reward')
                      : reward.pointsCost > 0 ? `${new Intl.NumberFormat(language).format(reward.pointsCost)} ${t('points')}` : t('Free')}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                  <span>{reward.missionCompletions?.length
                    ? `${t('Unlocked by mission')}: ${reward.missionCompletions[0].missionName}`
                    : reward.minimumPoints > 0 ? `${t('Requires at least')} ${reward.minimumPoints} ${t('points')}` : `${t('Claims')}: ${reward.customerClaimCount}/${reward.maxClaimsPerCustomer}`}</span>
                  <span>{reward.remainingQuantity === null ? t('Unlimited stock') : `${reward.remainingQuantity} ${t('remaining')}`}</span>
                </div>
                <div className="mt-3 flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 break-words text-xs text-gray-500">{reward.missionCompletions?.length
                    ? t('Claim this reward with the mission completion; points are not charged.')
                    : `${t('Offer ends')} ${formatDate(reward.endsAt, language)}`}</span>
                  <Button type="button" size="sm" className="w-full shrink-0 sm:w-auto" disabled={!reward.canClaim || claimingId !== null} onClick={() => void handleClaim(reward)}>
                    <TicketCheck size={14} className="mr-1.5" />{claimingId === reward.id ? t('Creating code...') : t('Claim')}
                  </Button>
                </div>
                {!reward.canClaim && reward.unavailableReason && (
                  <p className="mt-2 text-xs text-amber-800">{t({
                    points_program_disabled: 'The points program is currently disabled.',
                    not_enough_points: 'Not enough points for this reward.',
                    sold_out: 'This reward is out of stock.',
                    customer_limit: 'You have reached the claim limit for this reward.',
                  }[reward.unavailableReason])}</p>
                )}
              </article>
            ))}
          </div>
        )}

        {!!redemptions.length && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900">{t('Your reward codes')}</h3>
            <ul className="mt-2 space-y-2">
              {redemptions.map(redemption => {
                const isQrExpanded = expandedQrId === redemption.id;
                return (
                  <li key={redemption.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-gray-800">{redemption.rewardName}</span>
                      <span className="font-mono text-xs text-gray-500">{redemption.code}</span>
                      {redemption.missionName && <span className="mt-0.5 block text-xs text-emerald-700">{t('Unlocked by mission')}: {redemption.missionName}</span>}
                    </span>
                    <span className="shrink-0 text-right text-xs text-gray-500">
                      <span className="block font-semibold">{redemptionStatus(redemption.status, t)}</span>
                      {redemption.status === 'issued' && <span>{t('Expires')}: {formatDate(redemption.expiresAt, language)}</span>}
                    </span>
                    {redemption.status === 'issued' && (
                      <div className="basis-full">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setExpandedQrId(current => current === redemption.id ? null : redemption.id)}
                        >
                          <QrCode size={14} className="mr-1.5" />
                          {isQrExpanded ? t('Hide QR code') : t('Show QR code')}
                        </Button>
                        {isQrExpanded && (
                          <div className="mt-3 flex flex-col items-center gap-2 rounded-xl bg-white p-4">
                            <QrCodeDisplay value={redemption.code} label="Reward redemption QR code" className="h-40 w-40" />
                            <p className="text-center text-xs text-gray-500">{t('Show this QR code to the team.')}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </LocalizedTree>
  );
};
