import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Gift, Pause, Pencil, Play, Plus, RotateCcw, Target, Users, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LoyaltyMission, LoyaltyMissionType, LoyaltyReward, Template } from '../types';
import { createMission, fetchOwnerMissions, MissionInput, setMissionActive, updateMission } from '../lib/db/missions';
import { fetchOwnerLoyaltyRewards } from '../lib/db/rewards';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';

interface MissionsPageProps {
  campaigns: Template[];
}

type MissionForm = {
  campaignId: string;
  name: string;
  description: string;
  missionType: LoyaltyMissionType;
  goalCount: string;
  startsAt: string;
  endsAt: string;
  rewardType: 'benefit' | 'bonus_stamps' | 'catalog_reward';
  rewardDescription: string;
  rewardStamps: string;
  catalogRewardId: string;
  maxCompletions: string;
  isActive: boolean;
};

const toLocalInput = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
};

const emptyForm = (campaignId = ''): MissionForm => {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    campaignId,
    name: '',
    description: '',
    missionType: 'visit_count',
    goalCount: '3',
    startsAt: toLocalInput(startsAt),
    endsAt: toLocalInput(endsAt),
    rewardType: 'benefit',
    rewardDescription: '',
    rewardStamps: '1',
    catalogRewardId: '',
    maxCompletions: '1',
    isActive: true,
  };
};

const missionToForm = (mission: LoyaltyMission): MissionForm => ({
  campaignId: mission.campaignId ?? '',
  name: mission.name,
  description: mission.description,
  missionType: mission.missionType,
  goalCount: String(mission.goalCount),
  startsAt: toLocalInput(new Date(mission.startsAt)),
  endsAt: toLocalInput(new Date(mission.endsAt)),
  rewardType: mission.rewardType,
  rewardDescription: mission.rewardDescription,
  rewardStamps: String(mission.rewardStamps || 1),
  catalogRewardId: mission.catalogRewardId ?? '',
  maxCompletions: String(mission.maxCompletions),
  isActive: mission.isActive,
});

const formatDate = (value: string, language: string) => new Intl.DateTimeFormat(language, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export const MissionsPage: React.FC<MissionsPageProps> = ({ campaigns }) => {
  const { t, language } = useLocale();
  const [missions, setMissions] = useState<LoyaltyMission[]>([]);
  const [catalogRewards, setCatalogRewards] = useState<LoyaltyReward[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [form, setForm] = useState<MissionForm>(() => emptyForm(campaigns[0]?.id ?? ''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const campaignNames = useMemo(() => new Map(campaigns.map(campaign => [campaign.id, campaign.name])), [campaigns]);
  const eligibleCatalogRewards = useMemo(() => {
    const startsAt = new Date(form.startsAt).getTime();
    const endsAt = new Date(form.endsAt).getTime();
    return catalogRewards.filter(reward => {
      const campaignMatches = reward.campaignId === null || reward.campaignId === form.campaignId;
      const datesOverlap = new Date(reward.startsAt).getTime() < endsAt && new Date(reward.endsAt).getTime() > startsAt;
      return (reward.isActive && campaignMatches && datesOverlap) || reward.id === form.catalogRewardId;
    });
  }, [catalogRewards, form.campaignId, form.catalogRewardId, form.startsAt, form.endsAt]);

  const loadMissions = async () => {
    setLoading(true);
    const [missionsResult, rewardsResult] = await Promise.all([
      fetchOwnerMissions(),
      fetchOwnerLoyaltyRewards(),
    ]);
    if (missionsResult.ok) {
      setMissions(missionsResult.missions);
      setError('');
    } else {
      setError(t('Unable to load missions. Apply the loyalty missions database patch, then try again.'));
    }
    if (rewardsResult.ok) {
      setCatalogRewards(rewardsResult.rewards);
      setCatalogError('');
    } else {
      setCatalogError(t('Unable to load rewards. Apply the loyalty rewards database patch and try again.'));
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadMissions();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm(campaigns[0]?.id ?? ''));
    setIsFormOpen(false);
    setError('');
    setNotice('');
  };

  const handleEdit = (mission: LoyaltyMission) => {
    setEditingId(mission.id);
    setForm(missionToForm(mission));
    setIsFormOpen(true);
    setError('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toInput = (): MissionInput | null => {
    const goalCount = Number(form.goalCount);
    const maxCompletions = Number(form.maxCompletions);
    const startsAt = new Date(form.startsAt);
    const endsAt = new Date(form.endsAt);
    const rewardStamps = form.rewardType === 'bonus_stamps' ? Number(form.rewardStamps) : 0;
    const selectedCatalogReward = catalogRewards.find(reward => reward.id === form.catalogRewardId);
    if (!form.campaignId || !form.name.trim()
      || (form.rewardType === 'benefit' && !form.rewardDescription.trim())
      || (form.rewardType === 'catalog_reward' && !selectedCatalogReward)) {
      setError(t('Choose a campaign and enter a mission name and reward.'));
      return null;
    }
    if (!Number.isInteger(goalCount) || goalCount < 1 || goalCount > 1000) {
      setError(t('The goal must be a whole number between 1 and 1,000.'));
      return null;
    }
    if (!Number.isInteger(maxCompletions) || maxCompletions < 1 || maxCompletions > 100) {
      setError(t('The completion limit must be between 1 and 100.'));
      return null;
    }
    if (form.rewardType === 'bonus_stamps' && (!Number.isInteger(rewardStamps) || rewardStamps < 1 || rewardStamps > 20)) {
      setError(t('Bonus stamps must be a whole number between 1 and 20.'));
      return null;
    }
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      setError(t('Choose a valid period. The end must be after the start.'));
      return null;
    }

    return {
      campaignId: form.campaignId,
      name: form.name.trim(),
      description: form.description.trim(),
      missionType: form.missionType,
      goalCount,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      rewardType: form.rewardType,
      rewardDescription: form.rewardType === 'bonus_stamps'
        ? `${rewardStamps} bonus stamp${rewardStamps === 1 ? '' : 's'}`
        : form.rewardType === 'catalog_reward'
          ? selectedCatalogReward?.name ?? ''
          : form.rewardDescription.trim(),
      rewardStamps,
      catalogRewardId: form.rewardType === 'catalog_reward' ? form.catalogRewardId : null,
      maxCompletions,
      isActive: form.isActive,
    };
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const input = toInput();
    if (!input) return;
    setSaving(true);
    const result = editingId
      ? await updateMission(editingId, input)
      : await createMission(input);
    setSaving(false);
    if (!result.ok) {
      setError((result.error ?? '').includes('rules cannot be edited')
        ? t('This mission already has customer progress. Its rules are locked; pause it and create a new mission for different rules.')
        : t('Unable to save this mission. Check the dates and campaign, then try again.'));
      return;
    }
    setNotice(t(editingId ? 'Mission updated.' : 'Mission created.'));
    setEditingId(null);
    setForm(emptyForm(campaigns[0]?.id ?? ''));
    setIsFormOpen(false);
    await loadMissions();
  };

  const handleToggle = async (mission: LoyaltyMission) => {
    setError('');
    const result = await setMissionActive(mission.id, !mission.isActive);
    if (!result.ok) {
      setError(t('Unable to update mission status. Please try again.'));
      return;
    }
    await loadMissions();
  };

  const totalCompleted = missions.reduce((sum, mission) => sum + mission.completedCount, 0);
  const totalRedeemed = missions.reduce((sum, mission) => sum + mission.redeemedCount, 0);

  return (
    <LocalizedTree>
    <div className="min-h-full space-y-6 bg-gray-50/50 p-4 md:h-full md:overflow-y-auto md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('Loyalty tools')}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('Missions')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('Give customers a clear visit goal and a reward to work toward.')}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary icon={Target} label={t('Missions')} value={missions.length} />
        <Summary icon={Users} label={t('Mission participations')} value={missions.reduce((sum, mission) => sum + (mission.participantCount ?? 0), 0)} />
        <Summary icon={CheckCircle2} label={t('Completions')} value={totalCompleted} />
        <Summary icon={Gift} label={t('Rewards redeemed')} value={totalRedeemed} />
      </div>

      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-subtle md:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t(editingId ? 'Edit mission' : 'Create a mission')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('Progress is recorded from verified stamps within the chosen period.')}</p>
          </div>
          {editingId ? (
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={resetForm}>{t('Cancel edit')}</Button>
          ) : (
            <Button
              type="button"
              variant={isFormOpen ? 'outline' : 'default'}
              className="w-full sm:w-auto"
              aria-expanded={isFormOpen}
              aria-controls="mission-form-panel"
              onClick={() => {
                setIsFormOpen(!isFormOpen);
                setError('');
                if (!isFormOpen) setNotice('');
              }}
            >
              {isFormOpen ? <><ChevronUp size={16} className="mr-2" />{t('Hide form')}</> : <><Plus size={16} className="mr-2" />{t('New mission')}</>}
            </Button>
          )}
        </div>

        {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="mb-4 text-sm text-emerald-700">{notice}</p>}
        {campaigns.length === 0 && <p className="mb-4 text-sm text-amber-700">{t('Create a campaign before setting up a mission.')}</p>}

        <form id="mission-form-panel" className={isFormOpen ? 'grid gap-4 md:grid-cols-2' : 'hidden'} onSubmit={handleSave}>
          <div className="space-y-2">
            <Label htmlFor="mission-name">{t('Mission name')}</Label>
            <Input id="mission-name" maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder={t('Three visits this week')} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-campaign">{t('Campaign')}</Label>
            <select id="mission-campaign" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.campaignId} onChange={event => setForm({ ...form, campaignId: event.target.value, catalogRewardId: '' })} required>
              <option value="">{t('Choose a campaign')}</option>
              {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="mission-description">{t('Description')}</Label>
            <Input id="mission-description" maxLength={300} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder={t('Visit us three times before Sunday.')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-type">{t('Goal type')}</Label>
            <select id="mission-type" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.missionType} onChange={event => setForm({ ...form, missionType: event.target.value as LoyaltyMissionType })}>
              <option value="visit_count">{t('Visits across the campaign')}</option>
              <option value="card_stamps">{t('Stamps on this card')}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-goal">{t('Stamps needed')}</Label>
            <Input id="mission-goal" type="number" min={1} max={1000} step={1} value={form.goalCount} onChange={event => setForm({ ...form, goalCount: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-start">{t('Starts at (your local time)')}</Label>
            <Input id="mission-start" type="datetime-local" value={form.startsAt} onChange={event => setForm({ ...form, startsAt: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-end">{t('Ends at (your local time)')}</Label>
            <Input id="mission-end" type="datetime-local" value={form.endsAt} onChange={event => setForm({ ...form, endsAt: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-reward-type">{t('Reward type')}</Label>
            <select id="mission-reward-type" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.rewardType} onChange={event => setForm({ ...form, rewardType: event.target.value as MissionForm['rewardType'] })}>
              <option value="benefit">{t('Benefit to redeem with the team')}</option>
              <option value="bonus_stamps">{t('Bonus stamps on an active card')}</option>
              <option value="catalog_reward">{t('Reward from the catalog')}</option>
            </select>
          </div>
          <div className="space-y-2">
            {form.rewardType === 'catalog_reward' ? <>
              <Label htmlFor="mission-catalog-reward">{t('Catalog reward')}</Label>
              <select id="mission-catalog-reward" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.catalogRewardId} onChange={event => setForm({ ...form, catalogRewardId: event.target.value })} required>
                <option value="">{t('Choose a catalog reward')}</option>
                {eligibleCatalogRewards.map(reward => (
                  <option key={reward.id} value={reward.id}>{reward.name} ({reward.pointsCost > 0 ? `${reward.pointsCost} ${t('points')}` : t('Free')})</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t('Mission completions unlock this catalog reward. Customers claim a code on their card; points are not charged, while catalog stock and customer limits still apply.')}</p>
              {!catalogRewards.length && !catalogError && <p className="text-xs text-amber-700">{t('Create a reward in the catalog before linking it to a mission.')} <Link className="underline" to="/rewards">{t('Open reward catalog')}</Link></p>}
              {catalogError && <p className="text-xs text-rose-700">{catalogError}</p>}
              {catalogRewards.length > 0 && eligibleCatalogRewards.length === 0 && <p className="text-xs text-amber-700">{t('No active catalog rewards match this campaign and mission period.')}</p>}
            </> : form.rewardType === 'bonus_stamps' ? <>
              <Label htmlFor="mission-reward-stamps">{t('Bonus stamps')}</Label>
              <Input id="mission-reward-stamps" type="number" min={1} max={20} step={1} value={form.rewardStamps} onChange={event => setForm({ ...form, rewardStamps: event.target.value })} required />
            </> : <>
              <Label htmlFor="mission-reward">{t('Reward for the customer')}</Label>
              <Input id="mission-reward" maxLength={300} value={form.rewardDescription} onChange={event => setForm({ ...form, rewardDescription: event.target.value })} placeholder={t('Free pastry with your next drink')} required />
            </>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-limit">{t('Maximum completions per customer')}</Label>
            <Input id="mission-limit" type="number" min={1} max={100} step={1} value={form.maxCompletions} onChange={event => setForm({ ...form, maxCompletions: event.target.value })} required />
          </div>
          <label className="flex items-center gap-3 text-sm md:col-span-2">
            <input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 accent-primary" />
            {t('Show this mission to customers')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row md:col-span-2">
            <Button type="submit" className="w-full sm:w-auto" disabled={saving || campaigns.length === 0 || (form.rewardType === 'catalog_reward' && !form.catalogRewardId)}>
              {saving ? (
              <span key="saving">{t('Saving…')}</span>
              ) : editingId ? (
                <span key="save-changes">{t('Save changes')}</span>
              ) : (
                <span key="create-mission" className="inline-flex items-center">
                  <Plus size={16} className="mr-2" />{t('Create mission')}
                </span>
              )}
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{t('Your missions')}</h2>
          {loading && <span className="text-sm text-muted-foreground">{t('Loading…')}</span>}
        </div>
        {!loading && missions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-12 text-center">
            <Target size={24} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-medium">{t('No missions yet')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('Create the first visit challenge using the form above.')}</p>
          </div>
        )}
        {missions.map(mission => (
          <article key={mission.id} className="rounded-2xl border border-border/80 bg-card p-5 shadow-subtle">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{mission.name}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${mission.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                    {t(mission.isActive ? 'Visible' : 'Paused')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{mission.description || t(mission.missionType === 'visit_count' ? 'Visit goal across this campaign.' : 'Stamp goal on each card.')}</p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  <span>{campaignNames.get(mission.campaignId ?? '') ?? 'Archived campaign'}</span>
                  <span>{mission.goalCount} {t(mission.missionType === 'visit_count' ? 'visits' : 'stamps per card')}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={14} />{formatDate(mission.startsAt, language)} – {formatDate(mission.endsAt, language)}</span>
                </div>
                <p className="mt-3 inline-flex items-center gap-2 text-sm"><Gift size={15} />{mission.rewardDescription}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => handleEdit(mission)}><Pencil size={14} className="mr-1.5" />{t('Edit')}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleToggle(mission)}>
                  {mission.isActive ? <><Pause size={14} className="mr-1.5" />{t('Pause')}</> : <><Play size={14} className="mr-1.5" />{t('Activate')}</>}
                </Button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 border-t border-border/70 pt-4 text-sm sm:grid-cols-2">
              <span className="inline-flex items-center gap-2 text-muted-foreground"><Users size={15} />{mission.participantCount ?? 0} customer{mission.participantCount === 1 ? '' : 's'} participating</span>
              <span className="inline-flex items-center gap-2 text-muted-foreground"><CheckCircle2 size={15} />{mission.completedCount} completion{mission.completedCount === 1 ? '' : 's'}</span>
              <span className="inline-flex items-center gap-2 text-muted-foreground"><RotateCcw size={15} />{mission.redeemedCount} reward{mission.redeemedCount === 1 ? '' : 's'} redeemed</span>
            </div>
          </article>
        ))}
      </section>
    </div>
    </LocalizedTree>
  );
};

const Summary: React.FC<{ icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number }> = ({ icon: Icon, label, value }) => (
  <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-subtle">
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{label}</span>
      <Icon size={17} />
    </div>
    <p className="mt-3 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
  </div>
);
