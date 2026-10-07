import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, QrCode, ScanLine, TicketCheck } from 'lucide-react';
import type { LoyaltyRewardRedemption } from '../types';
import { cancelLoyaltyRewardCode, fetchStaffLoyaltyRewardRedemptions, validateLoyaltyRewardCode } from '../lib/db/rewards';
import { useAuth } from './AuthProvider';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';
import { ScanQrDialog, type ScanDetectionResult } from './ScanQrDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const formatDate = (value: string, language: string) => new Intl.DateTimeFormat(language, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const statusMessage = (error: string, t: (source: string) => string) => {
  if (error === 'not_found') return t('Code not found for this business.');
  if (error === 'expired') return t('This reward code has expired.');
  if (error === 'cancelled') return t('This reward code was cancelled.');
  if (error === 'redeemed') return t('This reward code was already redeemed.');
  return t('Unable to process this code. Refresh and try again.');
};

export const RewardRedemptionsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { t, language } = useLocale();
  const isOwner = currentUser?.role === 'owner';
  const [redemptions, setRedemptions] = useState<LoyaltyRewardRedemption[]>([]);
  const [code, setCode] = useState('');
  const [cancelCode, setCancelCode] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [notice, setNotice] = useState('');
  const [isScanOpen, setIsScanOpen] = useState(false);

  const loadRedemptions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchStaffLoyaltyRewardRedemptions();
      if (result.ok) {
        setRedemptions(result.redemptions);
        setError('');
      } else {
        setError(t('Unable to load reward codes. Apply the loyalty rewards database patch and try again.'));
      }
    } catch {
      setError(t('Unable to load reward codes. Apply the loyalty rewards database patch and try again.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadRedemptions(); }, [loadRedemptions]);

  const validateCode = useCallback(async (value: string): Promise<ScanDetectionResult> => {
    const normalizedCode = value.trim().toUpperCase();
    if (!normalizedCode) {
      const message = t('Enter the redemption code.');
      setError(message);
      return { ok: false, message };
    }

    setError('');
    setNotice('');
    setValidating(true);
    try {
      const result = await validateLoyaltyRewardCode(normalizedCode);
      if (!result.ok) {
        const message = t('Unable to process this code. Refresh and try again.');
        setError(message);
        return { ok: false, message };
      }
      if (!result.success) {
        const message = statusMessage(result.error, t);
        setError(message);
        return { ok: false, message };
      }

      setCode('');
      setNotice(`${t('Reward delivered to')} ${result.customerName}: ${result.rewardName}`);
      await loadRedemptions();
      return { ok: true };
    } catch {
      const message = t('Unable to process this code. Refresh and try again.');
      setError(message);
      return { ok: false, message };
    } finally {
      setValidating(false);
    }
  }, [loadRedemptions, t]);

  const handleValidate = async (event: React.FormEvent) => {
    event.preventDefault();
    await validateCode(code);
  };

  const closeScanner = useCallback(() => setIsScanOpen(false), []);

  const handleCancel = async (event: React.FormEvent) => {
    event.preventDefault();
    setCancelError('');
    setNotice('');
    if (cancelReason.trim().length < 3) {
      setCancelError(t('Enter a reason of at least 3 characters.'));
      return;
    }
    setCancelling(true);
    const result = await cancelLoyaltyRewardCode(cancelCode.trim(), cancelReason.trim());
    setCancelling(false);
    if (!result.ok) {
      setCancelError(statusMessage(result.error, t));
      return;
    }
    setCancelCode('');
    setCancelReason('');
    setNotice(t('Code cancelled. Points were refunded when applicable.'));
    await loadRedemptions();
  };

  const stateLabel = (status: LoyaltyRewardRedemption['status']) => t({
    issued: 'Issued', redeemed: 'Redeemed', expired: 'Expired', cancelled: 'Cancelled',
  }[status]);

  return (
    <LocalizedTree>
      <div className="min-h-full space-y-6 bg-gray-50/50 p-4 md:h-full md:overflow-y-auto md:p-8">
        <ScanQrDialog
          isOpen={isScanOpen}
          onClose={closeScanner}
          onDetected={validateCode}
          purpose="reward"
        />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('Loyalty tools')}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('Reward codes')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('Validate a customer code once when the reward is delivered. Expired and cancelled codes cannot be reused.')}</p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="space-y-4 rounded-2xl border border-border/80 bg-white p-5 shadow-subtle md:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ScanLine size={19} /></div>
              <div>
                <h2 className="font-semibold">{t('Validate a reward code')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t('Enter the code shown on the customer card.')}</p>
              </div>
            </div>
            <form className="space-y-3" onSubmit={handleValidate}>
              <div className="space-y-2">
                <Label htmlFor="reward-code">{t('Redemption code')}</Label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input id="reward-code" autoComplete="off" className="font-mono uppercase" maxLength={40} value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="SF-XXXXXXXXXXXXXXX" required />
                  <Button type="button" variant="outline" className="gap-2 rounded-full" onClick={() => setIsScanOpen(true)} disabled={validating}>
                    <QrCode size={16} />{t('Scan QR')}
                  </Button>
                </div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
              <Button type="submit" disabled={validating || !code.trim()}><BadgeCheck size={16} className="mr-2" />{validating ? t('Checking...') : t('Validate and deliver')}</Button>
            </form>
          </section>

          {isOwner && (
            <section className="space-y-4 rounded-2xl border border-border/80 bg-white p-5 shadow-subtle md:p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><TicketCheck size={19} /></div>
                <div>
                  <h2 className="font-semibold">{t('Cancel an unused code')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t('Cancellation is owner-only, requires a reason, and refunds points when applicable.')}</p>
                </div>
              </div>
              <form className="space-y-3" onSubmit={handleCancel}>
                <div className="space-y-2">
                  <Label htmlFor="cancel-reward-code">{t('Redemption code')}</Label>
                  <Input id="cancel-reward-code" autoComplete="off" className="font-mono uppercase" value={cancelCode} onChange={event => setCancelCode(event.target.value.toUpperCase())} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cancel-reason">{t('Cancellation reason')}</Label>
                  <Input id="cancel-reason" minLength={3} maxLength={250} value={cancelReason} onChange={event => setCancelReason(event.target.value)} required />
                </div>
                {cancelError && <p role="alert" className="text-sm text-destructive">{cancelError}</p>}
                <Button type="submit" variant="outline" disabled={cancelling || !cancelCode.trim()}>{cancelling ? t('Cancelling...') : t('Cancel code')}</Button>
              </form>
            </section>
          )}
        </div>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{t('Recent reward codes')}</h2>
              <p className="text-sm text-muted-foreground">{t('The latest 100 claims for this business.')}</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadRedemptions()}>{t('Refresh')}</Button>
          </div>
          {loading ? <p className="text-sm text-muted-foreground">{t('Loading...')}</p> : redemptions.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">{t('No reward codes have been issued yet.')}</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-white">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">{t('Reward / customer')}</th>
                    <th className="px-4 py-3">{t('Code')}</th>
                    <th className="px-4 py-3">{t('Status')}</th>
                    <th className="px-4 py-3">{t('Issued / expires')}</th>
                    <th className="px-4 py-3">{t('Validated by')}</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions.map(redemption => (
                    <tr key={redemption.id} className="border-t">
                      <td className="px-4 py-3">
                        <span className="block font-medium">{redemption.rewardName}</span>
                        {redemption.customerName && <span className="text-xs text-muted-foreground">{redemption.customerName}</span>}
                        {redemption.missionName && <span className="mt-0.5 block text-xs text-emerald-700">{t('Mission')}: {redemption.missionName}</span>}
                        {redemption.cancellationReason && <span className="mt-1 block text-xs text-muted-foreground">{t('Reason')}: {redemption.cancellationReason}</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{redemption.code}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${redemption.status === 'redeemed' ? 'bg-emerald-50 text-emerald-700' : redemption.status === 'issued' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{stateLabel(redemption.status)}</span></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground"><span className="block">{formatDate(redemption.issuedAt, language)}</span><span>{t('Expires')}: {formatDate(redemption.expiresAt, language)}</span></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{redemption.redeemedBy || (redemption.redeemedAt ? formatDate(redemption.redeemedAt, language) : '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </LocalizedTree>
  );
};
