import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { InterfaceLanguage, LoyaltyPointLevel } from '../types';
import {
  adjustLoyaltyPoints,
  fetchLoyaltyPointsConfiguration,
  fetchLoyaltyPointsCustomers,
  LoyaltyPointsConfiguration,
  LoyaltyPointsCustomer,
  saveLoyaltyPointsConfiguration,
} from '../lib/db/loyaltyPoints';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';

const defaultLevels = (language: InterfaceLanguage): LoyaltyPointLevel[] => {
  if (language === 'es') return [
    { name: 'Inicial', minPoints: 0, benefit: 'Empieza a acumular puntos y descubre los beneficios.' },
    { name: 'Plata', minPoints: 100, benefit: 'Accede a beneficios especiales de la empresa.' },
    { name: 'Oro', minPoints: 500, benefit: 'Disfruta de beneficios exclusivos de la empresa.' },
  ];
  if (language === 'en') return [
    { name: 'Starter', minPoints: 0, benefit: 'Start earning points and unlock benefits.' },
    { name: 'Silver', minPoints: 100, benefit: 'Access special business benefits.' },
    { name: 'Gold', minPoints: 500, benefit: 'Enjoy exclusive business benefits.' },
  ];
  return [
    { name: 'Inicial', minPoints: 0, benefit: 'Comece a acumular pontos e descubra os benefícios.' },
    { name: 'Prata', minPoints: 100, benefit: 'Acesse benefícios especiais da empresa.' },
    { name: 'Ouro', minPoints: 500, benefit: 'Aproveite benefícios exclusivos da empresa.' },
  ];
};

export const LoyaltyPointsSettings: React.FC = () => {
  const { language, t } = useLocale();
  const [configuration, setConfiguration] = useState<LoyaltyPointsConfiguration>({
    isEnabled: false,
    pointsPerVisit: 10,
    levels: defaultLevels(language),
  });
  const [customers, setCustomers] = useState<LoyaltyPointsCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [pointsDelta, setPointsDelta] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState('');
  const [adjustmentError, setAdjustmentError] = useState('');
  const [notice, setNotice] = useState('');
  const [adjustmentNotice, setAdjustmentNotice] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([fetchLoyaltyPointsConfiguration(), fetchLoyaltyPointsCustomers()])
      .then(([settingsResult, customersResult]) => {
        if (!active) return;
        if (settingsResult.ok) {
          setConfiguration({
            ...settingsResult.configuration,
            levels: settingsResult.configuration.levels.length
              ? settingsResult.configuration.levels
              : defaultLevels(language),
          });
        } else {
          setError(t('Unable to load loyalty point settings. Apply the loyalty points database patch and try again.'));
        }
        if (customersResult.ok) {
          setCustomers(customersResult.customers);
          setSelectedCustomerId(customersResult.customers[0]?.id ?? '');
        } else if (settingsResult.ok) {
          setAdjustmentError(t('Unable to load customers for point adjustments.'));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(t('Unable to load loyalty point settings. Apply the loyalty points database patch and try again.'));
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const updateLevel = (index: number, changes: Partial<LoyaltyPointLevel>) => {
    setConfiguration(current => ({
      ...current,
      levels: current.levels.map((level, levelIndex) => levelIndex === index ? { ...level, ...changes } : level),
    }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!Number.isInteger(configuration.pointsPerVisit) || configuration.pointsPerVisit < 1 || configuration.pointsPerVisit > 10000) {
      setError(t('Points per visit must be a whole number between 1 and 10,000.'));
      return;
    }
    if (!configuration.levels.length || configuration.levels.length > 10 || configuration.levels[0].minPoints !== 0) {
      setError(t('Add between 1 and 10 levels. The first level must start at 0 points.'));
      return;
    }
    let previousThreshold = -1;
    for (const level of configuration.levels) {
      if (!level.name.trim() || level.name.trim().length > 50 || !level.benefit.trim() || level.benefit.trim().length > 200
        || !Number.isInteger(level.minPoints) || level.minPoints < 0 || level.minPoints <= previousThreshold) {
        setError(t('Check each level name, benefit, and increasing point threshold.'));
        return;
      }
      previousThreshold = level.minPoints;
    }

    setSaving(true);
    const result = await saveLoyaltyPointsConfiguration(configuration);
    setSaving(false);
    if (!result.ok) {
      setError(t('Unable to save loyalty point settings. Check the levels and try again.'));
      return;
    }
    setConfiguration(result.configuration);
    setNotice(t('Loyalty settings saved.'));
  };

  const handleAdjustment = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdjustmentError('');
    setAdjustmentNotice('');
    const points = Number(pointsDelta);
    if (!selectedCustomerId || !Number.isInteger(points) || points === 0 || Math.abs(points) > 100000 || reason.trim().length < 3) {
      setAdjustmentError(t('Choose a customer, enter a non-zero whole number, and provide a reason.'));
      return;
    }
    setAdjusting(true);
    const result = await adjustLoyaltyPoints({
      customerId: selectedCustomerId,
      pointsDelta: points,
      reason: reason.trim(),
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
    setAdjusting(false);
    if (!result.ok) {
      setAdjustmentError(result.error.includes('negative')
        ? t('This adjustment cannot make the customer balance negative.')
        : t('Unable to adjust points. Check the customer and try again.'));
      return;
    }
    setCustomers(current => current.map(customer => customer.id === selectedCustomerId
      ? { ...customer, balance: result.balance }
      : customer));
    setPointsDelta('');
    setReason('');
    setAdjustmentNotice(t('Point adjustment recorded.'));
  };

  const addLevel = () => {
    if (configuration.levels.length >= 10) return;
    const previous = configuration.levels[configuration.levels.length - 1];
    const nextNumber = configuration.levels.length + 1;
    setConfiguration(current => ({
      ...current,
      levels: [...current.levels, {
        name: `${t('Level')} ${nextNumber}`,
        minPoints: (previous?.minPoints ?? 0) + 100,
        benefit: t('Describe the benefit for this level.'),
      }],
    }));
  };

  const selectedCustomer = customers.find(customer => customer.id === selectedCustomerId);

  return (
    <LocalizedTree>
      <>
        <section className="space-y-5 rounded-2xl border bg-white p-4 shadow-xs md:rounded-3xl md:p-6">
          <div>
            <h2 className="text-lg font-semibold md:text-xl">{t('Loyalty points and levels')}</h2>
            <p className="text-sm text-muted-foreground">{t('Award points for verified visits, configure levels, and show progress to customers.')}</p>
          </div>

          {loading ? <p className="text-sm text-muted-foreground">{t('Loading…')}</p> : (
            <form className="space-y-5" onSubmit={handleSave}>
              <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={configuration.isEnabled}
                  onChange={event => setConfiguration(current => ({ ...current, isEnabled: event.target.checked }))}
                />
                <span>
                  <span className="block font-medium">{t('Enable points and badges')}</span>
                  <span className="mt-1 block text-muted-foreground">{t('Only new verified visits earn points after you enable this program.')}</span>
                </span>
              </label>

              <div className="max-w-sm space-y-1.5">
                <Label htmlFor="points-per-visit">{t('Points per verified visit')}</Label>
                <Input id="points-per-visit" type="number" min={1} max={10000} step={1} value={configuration.pointsPerVisit} onChange={event => setConfiguration(current => ({ ...current, pointsPerVisit: Number(event.target.value) }))} required />
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{t('Customer levels')}</h3>
                    <p className="text-xs text-muted-foreground">{t('Set the minimum point balance and benefit for each level.')}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={configuration.levels.length >= 10} onClick={addLevel}>
                    <Plus size={15} className="mr-1.5" />{t('Add level')}
                  </Button>
                </div>

                <div className="space-y-3">
                  {configuration.levels.map((level, index) => (
                    <div key={`${index}-${level.minPoints}`} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_140px_1.5fr_auto] sm:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor={`loyalty-level-name-${index}`}>{t('Level name')}</Label>
                        <Input id={`loyalty-level-name-${index}`} maxLength={50} value={level.name} onChange={event => updateLevel(index, { name: event.target.value })} required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`loyalty-level-points-${index}`}>{t('Minimum points')}</Label>
                        <Input id={`loyalty-level-points-${index}`} type="number" min={0} max={100000000} step={1} value={level.minPoints} disabled={index === 0} onChange={event => updateLevel(index, { minPoints: Number(event.target.value) })} required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`loyalty-level-benefit-${index}`}>{t('Level benefit')}</Label>
                        <Input id={`loyalty-level-benefit-${index}`} maxLength={200} value={level.benefit} onChange={event => updateLevel(index, { benefit: event.target.value })} required />
                      </div>
                      <Button type="button" variant="ghost" size="icon" aria-label={t('Remove level')} title={t('Remove level')} disabled={index === 0} onClick={() => setConfiguration(current => ({ ...current, levels: current.levels.filter((_, levelIndex) => levelIndex !== index) }))}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 p-4 text-xs leading-5 text-muted-foreground">
                <p>{t('Points are earned only for verified added stamps. Purchase points are unavailable because the current checkout flow does not record a trusted purchase amount.')}</p>
                <p className="mt-2">{t('Points do not expire. Removing a stamp reverses its matching points, up to the available balance. Badges remain once earned.')}</p>
                <p className="mt-2">{t('Manual adjustments are owner-only, require a reason visible to the customer, and are kept in the ledger. Use an opposite adjustment to correct an earlier one.')}</p>
              </div>

              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
              <Button type="submit" disabled={saving || loading}>
                {saving ? t('Saving…') : t('Save loyalty settings')}
              </Button>
            </form>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-xs md:rounded-3xl md:p-6">
          <div>
            <h2 className="text-lg font-semibold md:text-xl">{t('Manual point adjustment')}</h2>
            <p className="text-sm text-muted-foreground">{t('Adjustments are recorded as new ledger entries and cannot make a balance negative.')}</p>
          </div>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleAdjustment}>
            <div className="space-y-1.5">
              <Label htmlFor="points-customer">{t('Customer')}</Label>
              <select id="points-customer" className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm" value={selectedCustomerId} onChange={event => setSelectedCustomerId(event.target.value)} required>
                <option value="">{t('Choose a customer')}</option>
                {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
              {selectedCustomer && <p className="text-xs text-muted-foreground">{t('Current balance')}: {selectedCustomer.balance}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="points-adjustment">{t('Points change')}</Label>
              <Input id="points-adjustment" type="number" min={-100000} max={100000} step={1} value={pointsDelta} onChange={event => setPointsDelta(event.target.value)} placeholder="+50 / -20" required />
              <p className="text-xs text-muted-foreground">{t('Use a positive number to add points or a negative number to remove them.')}</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="points-adjustment-reason">{t('Reason shown to the customer')}</Label>
              <Input id="points-adjustment-reason" maxLength={250} minLength={3} value={reason} onChange={event => setReason(event.target.value)} required />
            </div>
            {adjustmentError && <p role="alert" className="text-sm text-destructive sm:col-span-2">{adjustmentError}</p>}
            {adjustmentNotice && <p role="status" className="text-sm text-emerald-700 sm:col-span-2">{adjustmentNotice}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={adjusting || !customers.length}>
                {adjusting ? t('Saving…') : t('Apply adjustment')}
              </Button>
            </div>
          </form>
        </section>
      </>
    </LocalizedTree>
  );
};
