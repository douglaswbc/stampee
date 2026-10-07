import React, { useEffect, useMemo, useState } from 'react';
import { ChevronUp, Gift, Pencil, Plus, TicketCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LoyaltyReward, Template } from '../types';
import { fetchOwnerLoyaltyRewards, saveOwnerLoyaltyReward, type LoyaltyRewardInput } from '../lib/db/rewards';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';
import { useAuth } from './AuthProvider';
import { formatDateInTimeZone, formatDateTimeLocal, getBrowserTimeZone, parseDateTimeLocal } from '../lib/timezones';

interface RewardsCatalogPageProps {
  campaigns: Template[];
}

interface RewardForm {
  name: string;
  description: string;
  campaignId: string;
  pointsCost: string;
  minimumPoints: string;
  startsAt: string;
  endsAt: string;
  stockQuantity: string;
  maxClaimsPerCustomer: string;
  redemptionValidityHours: string;
  isActive: boolean;
}

const emptyForm = (timeZone = getBrowserTimeZone()): RewardForm => {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    name: '',
    description: '',
    campaignId: '',
    pointsCost: '0',
    minimumPoints: '0',
    startsAt: formatDateTimeLocal(startsAt, timeZone),
    endsAt: formatDateTimeLocal(endsAt, timeZone),
    stockQuantity: '',
    maxClaimsPerCustomer: '1',
    redemptionValidityHours: '168',
    isActive: true,
  };
};

const rewardToForm = (reward: LoyaltyReward, timeZone: string): RewardForm => ({
  name: reward.name,
  description: reward.description,
  campaignId: reward.campaignId ?? '',
  pointsCost: String(reward.pointsCost),
  minimumPoints: String(reward.minimumPoints),
  startsAt: formatDateTimeLocal(reward.startsAt, timeZone),
  endsAt: formatDateTimeLocal(reward.endsAt, timeZone),
  stockQuantity: reward.stockQuantity === null ? '' : String(reward.stockQuantity),
  maxClaimsPerCustomer: String(reward.maxClaimsPerCustomer),
  redemptionValidityHours: String(reward.redemptionValidityHours),
  isActive: reward.isActive,
});

export const RewardsCatalogPage: React.FC<RewardsCatalogPageProps> = ({ campaigns }) => {
  const { t, language } = useLocale();
  const { currentOwner } = useAuth();
  const timeZone = currentOwner?.timeZone ?? getBrowserTimeZone();
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [form, setForm] = useState<RewardForm>(() => emptyForm(timeZone));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const campaignNames = useMemo(() => new Map(campaigns.map(campaign => [campaign.id, campaign.name])), [campaigns]);

  useEffect(() => {
    if (editingId) return;
    setForm(current => current.name.trim() || current.description.trim()
      ? current
      : emptyForm(timeZone));
  }, [timeZone, editingId]);

  const loadRewards = async () => {
    setLoading(true);
    const result = await fetchOwnerLoyaltyRewards();
    if (result.ok) {
      setRewards(result.rewards);
      setError('');
    } else {
      setError(t('Unable to load rewards. Apply the loyalty rewards database patch and try again.'));
    }
    setLoading(false);
  };

  useEffect(() => { void loadRewards(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm(timeZone));
    setIsFormOpen(false);
    setError('');
    setNotice('');
  };

  const toInput = (id: string | null, startsAt: Date, endsAt: Date): LoyaltyRewardInput => ({
    id,
    name: form.name.trim(),
    description: form.description.trim(),
    campaignId: form.campaignId || null,
    pointsCost: Number(form.pointsCost),
    minimumPoints: Number(form.minimumPoints),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    stockQuantity: form.stockQuantity.trim() ? Number(form.stockQuantity) : null,
    maxClaimsPerCustomer: Number(form.maxClaimsPerCustomer),
    redemptionValidityHours: Number(form.redemptionValidityHours),
    isActive: form.isActive,
  });

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const numericFields = [form.pointsCost, form.minimumPoints, form.maxClaimsPerCustomer, form.redemptionValidityHours];
    if (numericFields.some(value => !Number.isInteger(Number(value)))
      || (form.stockQuantity.trim() && !Number.isInteger(Number(form.stockQuantity)))) {
      setError(t('Enter whole numbers for points, stock, limits, and code validity.'));
      return;
    }
    const startsAt = parseDateTimeLocal(form.startsAt, timeZone);
    const endsAt = parseDateTimeLocal(form.endsAt, timeZone);
    if (!startsAt || !endsAt) {
      setError(t('Choose start and end times that exist in the company time zone.'));
      return;
    }
    if (endsAt <= startsAt) {
      setError(t('Choose a valid reward period. The end must be after the start.'));
      return;
    }

    setSaving(true);
    const result = await saveOwnerLoyaltyReward(toInput(editingId, startsAt, endsAt));
    setSaving(false);
    if (!result.ok) {
      setError(t('Unable to save this reward. Check its rules and stock, then try again.'));
      return;
    }
    resetForm();
    setNotice(t(editingId ? 'Reward updated.' : 'Reward created.'));
    await loadRewards();
  };

  const startEditing = (reward: LoyaltyReward) => {
    setEditingId(reward.id);
    setForm(rewardToForm(reward, timeZone));
    setIsFormOpen(true);
    setError('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleActive = async (reward: LoyaltyReward) => {
    setError('');
    const result = await saveOwnerLoyaltyReward({ ...reward, isActive: !reward.isActive });
    if (!result.ok) {
      setError(t('Unable to update this reward. Refresh and try again.'));
      return;
    }
    setNotice(t(reward.isActive ? 'Reward paused. Existing codes remain valid until they expire.' : 'Reward activated.'));
    await loadRewards();
  };

  return (
    <LocalizedTree>
      <div className="min-h-full space-y-6 bg-gray-50/50 p-4 md:h-full md:overflow-y-auto md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('Loyalty tools')}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('Rewards')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('Create global or campaign rewards and control points, stock, validity, and customer limits.')}</p>
          </div>
          <Button asChild variant="outline" className="w-full sm:w-auto"><Link to="/reward-redemptions"><TicketCheck size={16} className="mr-2" />{t('Manage reward codes')}</Link></Button>
        </div>

        <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-subtle md:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{t(editingId ? 'Edit reward' : 'Create a reward')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('A zero points cost makes a free reward. Minimum points can be used as a verifiable eligibility condition.')}</p>
            </div>
            {editingId ? (
              <Button type="button" variant="outline" className="w-full shrink-0 sm:w-auto" onClick={resetForm}>{t('Cancel edit')}</Button>
            ) : (
              <Button
                type="button"
                variant={isFormOpen ? 'outline' : 'default'}
                className="w-full shrink-0 sm:w-auto"
                aria-expanded={isFormOpen}
                aria-controls="reward-form-panel"
                onClick={() => {
                  setIsFormOpen(!isFormOpen);
                  setError('');
                  if (!isFormOpen) setNotice('');
                }}
              >
                {isFormOpen ? <><ChevronUp size={16} className="mr-2" />{t('Hide form')}</> : <><Plus size={16} className="mr-2" />{t('New reward')}</>}
              </Button>
            )}
          </div>

          {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="mb-4 text-sm text-emerald-700">{notice}</p>}

          <form id="reward-form-panel" className={isFormOpen ? 'grid gap-4 md:grid-cols-2' : 'hidden'} onSubmit={handleSave}>
            <div className="space-y-2">
              <Label htmlFor="reward-name">{t('Reward name')}</Label>
              <Input id="reward-name" maxLength={100} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-campaign">{t('Reward scope')}</Label>
              <select id="reward-campaign" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.campaignId} onChange={event => setForm(current => ({ ...current, campaignId: event.target.value }))}>
                <option value="">{t('All campaigns (global)')}</option>
                {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="reward-description">{t('Reward description')}</Label>
              <Input id="reward-description" maxLength={300} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-points-cost">{t('Points cost')}</Label>
              <Input id="reward-points-cost" type="number" min={0} max={1000000} step={1} value={form.pointsCost} onChange={event => setForm(current => ({ ...current, pointsCost: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-minimum-points">{t('Minimum points eligibility')}</Label>
              <Input id="reward-minimum-points" type="number" min={0} max={100000000} step={1} value={form.minimumPoints} onChange={event => setForm(current => ({ ...current, minimumPoints: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-starts-at">{t('Offer starts (company time)')}</Label>
              <Input id="reward-starts-at" type="datetime-local" value={form.startsAt} onChange={event => setForm(current => ({ ...current, startsAt: event.target.value }))} required />
              <p className="text-xs text-muted-foreground">{timeZone}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-ends-at">{t('Offer ends (company time)')}</Label>
              <Input id="reward-ends-at" type="datetime-local" value={form.endsAt} onChange={event => setForm(current => ({ ...current, endsAt: event.target.value }))} required />
              <p className="text-xs text-muted-foreground">{timeZone}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-stock">{t('Stock quantity')}</Label>
              <Input id="reward-stock" type="number" min={0} max={1000000} step={1} value={form.stockQuantity} onChange={event => setForm(current => ({ ...current, stockQuantity: event.target.value }))} placeholder={t('Unlimited')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-customer-limit">{t('Claims per customer')}</Label>
              <Input id="reward-customer-limit" type="number" min={1} max={100} step={1} value={form.maxClaimsPerCustomer} onChange={event => setForm(current => ({ ...current, maxClaimsPerCustomer: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-code-hours">{t('Code validity (hours)')}</Label>
              <Input id="reward-code-hours" type="number" min={1} max={720} step={1} value={form.redemptionValidityHours} onChange={event => setForm(current => ({ ...current, redemptionValidityHours: event.target.value }))} required />
              <p className="text-xs text-muted-foreground">{t('A code cannot outlive the offer end date.')}</p>
            </div>
            <label className="flex items-center gap-2 self-center text-sm md:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />
              {t('Show this reward to eligible customers')}
            </label>
            <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center">
              <Button type="submit" className="w-full sm:w-auto" disabled={saving}>{saving ? t('Saving...') : t(editingId ? 'Save changes' : 'Create reward')}</Button>
              {!editingId && <span className="text-xs text-muted-foreground"><Gift size={14} className="mr-1 inline" />{t('Customers claim rewards from their public card.')}</span>}
            </div>
          </form>
        </section>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{t('Reward catalog')}</h2>
              <p className="text-sm text-muted-foreground">{t('Issued and redeemed codes reserve stock; expired and cancelled codes release it.')}</p>
            </div>
            <span className="text-sm text-muted-foreground">{rewards.length} {t('rewards')}</span>
          </div>
          {loading ? <p className="text-sm text-muted-foreground">{t('Loading...')}</p> : rewards.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">{t('No rewards yet. Create the first reward above.')}</div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {rewards.map(reward => (
                <article key={reward.id} className="rounded-2xl border border-border/80 bg-white p-5 shadow-subtle">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words font-semibold">{reward.name}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${reward.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                          {reward.isActive ? t('Active') : t('Paused')}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{reward.description}</p>
                    </div>
                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                      <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => startEditing(reward)}><Pencil size={14} className="mr-1.5" />{t('Edit')}</Button>
                      <Button type="button" size="sm" variant={reward.isActive ? 'ghost' : 'secondary'} className="w-full sm:w-auto" onClick={() => void toggleActive(reward)}>{t(reward.isActive ? 'Pause' : 'Activate')}</Button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <p><span className="text-muted-foreground">{t('Scope')}:</span> {reward.campaignId ? campaignNames.get(reward.campaignId) ?? t('Archived campaign') : t('Global')}</p>
                    <p><span className="text-muted-foreground">{t('Points')}:</span> {reward.pointsCost} {t('points')} {reward.minimumPoints > 0 ? `· ${t('minimum eligibility')} ${reward.minimumPoints}` : ''}</p>
                    <p><span className="text-muted-foreground">{t('Stock')}:</span> {reward.stockQuantity === null ? t('Unlimited') : `${reward.remainingQuantity ?? 0} / ${reward.stockQuantity} ${t('remaining')}`}</p>
                    <p><span className="text-muted-foreground">{t('Claims')}:</span> {reward.activeClaimCount} · {t('Redeemed')}: {reward.redeemedCount}</p>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{formatDateInTimeZone(reward.startsAt, language, timeZone)} – {formatDateInTimeZone(reward.endsAt, language, timeZone)} · {reward.redemptionValidityHours} {t('hours to redeem')}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </LocalizedTree>
  );
};
