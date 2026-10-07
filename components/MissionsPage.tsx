import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Gift, Pause, Pencil, Play, Plus, RotateCcw, Target, Users } from 'lucide-react';
import type { LoyaltyMission, LoyaltyMissionType, Template } from '../types';
import { createMission, fetchOwnerMissions, MissionInput, setMissionActive, updateMission } from '../lib/db/missions';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

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
  rewardType: 'benefit' | 'bonus_stamps';
  rewardDescription: string;
  rewardStamps: string;
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
  maxCompletions: String(mission.maxCompletions),
  isActive: mission.isActive,
});

const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export const MissionsPage: React.FC<MissionsPageProps> = ({ campaigns }) => {
  const [missions, setMissions] = useState<LoyaltyMission[]>([]);
  const [form, setForm] = useState<MissionForm>(() => emptyForm(campaigns[0]?.id ?? ''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const campaignNames = useMemo(() => new Map(campaigns.map(campaign => [campaign.id, campaign.name])), [campaigns]);

  const loadMissions = async () => {
    setLoading(true);
    const result = await fetchOwnerMissions();
    if (result.ok) {
      setMissions(result.missions);
      setError('');
    } else {
      setError('Unable to load missions. Apply the loyalty missions database patch, then try again.');
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadMissions();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm(campaigns[0]?.id ?? ''));
    setError('');
    setNotice('');
  };

  const handleEdit = (mission: LoyaltyMission) => {
    setEditingId(mission.id);
    setForm(missionToForm(mission));
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
    if (!form.campaignId || !form.name.trim() || (form.rewardType === 'benefit' && !form.rewardDescription.trim())) {
      setError('Choose a campaign and enter a mission name and reward.');
      return null;
    }
    if (!Number.isInteger(goalCount) || goalCount < 1 || goalCount > 1000) {
      setError('The goal must be a whole number between 1 and 1,000.');
      return null;
    }
    if (!Number.isInteger(maxCompletions) || maxCompletions < 1 || maxCompletions > 100) {
      setError('The completion limit must be between 1 and 100.');
      return null;
    }
    if (form.rewardType === 'bonus_stamps' && (!Number.isInteger(rewardStamps) || rewardStamps < 1 || rewardStamps > 20)) {
      setError('Bonus stamps must be a whole number between 1 and 20.');
      return null;
    }
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      setError('Choose a valid period. The end must be after the start.');
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
        : form.rewardDescription.trim(),
      rewardStamps,
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
        ? 'This mission already has customer progress. Its rules are locked; pause it and create a new mission for different rules.'
        : 'Unable to save this mission. Check the dates and campaign, then try again.');
      return;
    }
    setNotice(editingId ? 'Mission updated.' : 'Mission created.');
    setEditingId(null);
    setForm(emptyForm(campaigns[0]?.id ?? ''));
    await loadMissions();
  };

  const handleToggle = async (mission: LoyaltyMission) => {
    setError('');
    const result = await setMissionActive(mission.id, !mission.isActive);
    if (!result.ok) {
      setError('Unable to update mission status. Please try again.');
      return;
    }
    await loadMissions();
  };

  const totalCompleted = missions.reduce((sum, mission) => sum + mission.completedCount, 0);
  const totalRedeemed = missions.reduce((sum, mission) => sum + mission.redeemedCount, 0);

  return (
    <div className="min-h-full space-y-6 bg-gray-50/50 p-4 md:h-full md:overflow-y-auto md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Loyalty tools</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Missions</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Give customers a clear visit goal and a reward to work toward.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary icon={Target} label="Missions" value={missions.length} />
        <Summary icon={Users} label="Mission participations" value={missions.reduce((sum, mission) => sum + (mission.participantCount ?? 0), 0)} />
        <Summary icon={CheckCircle2} label="Completions" value={totalCompleted} />
        <Summary icon={Gift} label="Rewards redeemed" value={totalRedeemed} />
      </div>

      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-subtle md:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{editingId ? 'Edit mission' : 'Create a mission'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Progress is recorded from verified stamps within the chosen period.</p>
          </div>
          {editingId && <Button type="button" variant="outline" onClick={resetForm}>Cancel edit</Button>}
        </div>

        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSave}>
          <div className="space-y-2">
            <Label htmlFor="mission-name">Mission name</Label>
            <Input id="mission-name" maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Three visits this week" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-campaign">Campaign</Label>
            <select id="mission-campaign" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.campaignId} onChange={event => setForm({ ...form, campaignId: event.target.value })} required>
              <option value="">Choose a campaign</option>
              {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="mission-description">Description</Label>
            <Input id="mission-description" maxLength={300} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Visit us three times before Sunday." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-type">Goal type</Label>
            <select id="mission-type" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.missionType} onChange={event => setForm({ ...form, missionType: event.target.value as LoyaltyMissionType })}>
              <option value="visit_count">Visits across the campaign</option>
              <option value="card_stamps">Stamps on this card</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-goal">Stamps needed</Label>
            <Input id="mission-goal" type="number" min={1} max={1000} step={1} value={form.goalCount} onChange={event => setForm({ ...form, goalCount: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-start">Starts at (your local time)</Label>
            <Input id="mission-start" type="datetime-local" value={form.startsAt} onChange={event => setForm({ ...form, startsAt: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-end">Ends at (your local time)</Label>
            <Input id="mission-end" type="datetime-local" value={form.endsAt} onChange={event => setForm({ ...form, endsAt: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-reward-type">Reward type</Label>
            <select id="mission-reward-type" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={form.rewardType} onChange={event => setForm({ ...form, rewardType: event.target.value as MissionForm['rewardType'] })}>
              <option value="benefit">Benefit to redeem with the team</option>
              <option value="bonus_stamps">Bonus stamps on an active card</option>
            </select>
          </div>
          <div className="space-y-2">
            {form.rewardType === 'bonus_stamps' ? <>
              <Label htmlFor="mission-reward-stamps">Bonus stamps</Label>
              <Input id="mission-reward-stamps" type="number" min={1} max={20} step={1} value={form.rewardStamps} onChange={event => setForm({ ...form, rewardStamps: event.target.value })} required />
            </> : <>
              <Label htmlFor="mission-reward">Reward for the customer</Label>
              <Input id="mission-reward" maxLength={300} value={form.rewardDescription} onChange={event => setForm({ ...form, rewardDescription: event.target.value })} placeholder="Free pastry with your next drink" required />
            </>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-limit">Maximum completions per customer</Label>
            <Input id="mission-limit" type="number" min={1} max={100} step={1} value={form.maxCompletions} onChange={event => setForm({ ...form, maxCompletions: event.target.value })} required />
          </div>
          <label className="flex items-center gap-3 text-sm md:col-span-2">
            <input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 accent-primary" />
            Show this mission to customers
          </label>
          {error && <p role="alert" className="text-sm text-destructive md:col-span-2">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-700 md:col-span-2">{notice}</p>}
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="submit" disabled={saving || campaigns.length === 0}>
              {saving ? (
                <span key="saving">Saving…</span>
              ) : editingId ? (
                <span key="save-changes">Save changes</span>
              ) : (
                <span key="create-mission" className="inline-flex items-center">
                  <Plus size={16} className="mr-2" />Create mission
                </span>
              )}
            </Button>
          </div>
        </form>
        {campaigns.length === 0 && <p className="mt-4 text-sm text-amber-700">Create a campaign before setting up a mission.</p>}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Your missions</h2>
          {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
        </div>
        {!loading && missions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-12 text-center">
            <Target size={24} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-medium">No missions yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the first visit challenge using the form above.</p>
          </div>
        )}
        {missions.map(mission => (
          <article key={mission.id} className="rounded-2xl border border-border/80 bg-card p-5 shadow-subtle">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{mission.name}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${mission.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                    {mission.isActive ? 'Visible' : 'Paused'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{mission.description || (mission.missionType === 'visit_count' ? 'Visit goal across this campaign.' : 'Stamp goal on each card.')}</p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  <span>{campaignNames.get(mission.campaignId ?? '') ?? 'Archived campaign'}</span>
                  <span>{mission.goalCount} {mission.missionType === 'visit_count' ? 'visits' : 'stamps per card'}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={14} />{formatDate(mission.startsAt)} – {formatDate(mission.endsAt)}</span>
                </div>
                <p className="mt-3 inline-flex items-center gap-2 text-sm"><Gift size={15} />{mission.rewardDescription}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => handleEdit(mission)}><Pencil size={14} className="mr-1.5" />Edit</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleToggle(mission)}>
                  {mission.isActive ? <><Pause size={14} className="mr-1.5" />Pause</> : <><Play size={14} className="mr-1.5" />Activate</>}
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
