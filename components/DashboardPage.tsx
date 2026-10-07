import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Gift,
  PlusCircle,
  ReceiptText,
  Sparkles,
  Target,
  TicketCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type { Customer, Template } from '../types';
import { fetchOwnerDashboardSummary } from '../lib/db/dashboard';
import type { DashboardActivityEvent, DashboardActivityType, DashboardSummary } from '../lib/db/dashboard';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useAuth } from './AuthProvider';
import { loadFromStorage, saveToStorage } from '../lib/storage';
import { cn } from '../lib/utils';
import { useLocale } from './LocaleProvider';
import { LocalizedTree } from './LocalizedTree';

interface DashboardPageProps {
  campaigns: Template[];
  customers: Customer[];
}

interface ChecklistStep {
  title: string;
  description: string;
  href: string;
  complete: boolean;
  buttonLabel: string;
}

interface DashboardDismissState {
  getStarted: boolean;
}

const dashboardDismissStateKey = (ownerId: string) => `dashboard:dismissed:${ownerId}`;
const defaultDismissState: DashboardDismissState = {
  getStarted: false,
};

const formatAction = (type: DashboardActivityType, t: (source: string) => string) => {
  switch (type) {
    case 'issued':
      return t('Card issued');
    case 'redeem':
      return t('Reward redeemed');
    case 'mission_bonus':
      return t('Mission bonus stamps');
    case 'stamp_remove':
      return t('Stamp removed');
    case 'mission_completed':
      return t('Mission completed');
    case 'mission_reward_redeemed':
      return t('Mission reward redeemed');
    case 'reward_code_issued':
      return t('Reward code issued');
    case 'reward_code_redeemed':
      return t('Reward code redeemed');
    case 'welcome_bonus':
      return t('Welcome bonus');
    case 'referral_reward':
      return t('Referral reward');
    case 'stamp_add':
      return t('Stamp added');
  }
};

const formatTimestamp = (timestamp: number, locale: string) =>
  new Date(timestamp).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const DashboardPage: React.FC<DashboardPageProps> = ({ campaigns, customers }) => {
  const { currentOwner } = useAuth();
  const { t, language } = useLocale();
  const cards = useMemo(() => customers.flatMap((customer) => customer.cards), [customers]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryUnavailable, setSummaryUnavailable] = useState(false);
  const [dismissedSections, setDismissedSections] = useState<DashboardDismissState>(defaultDismissState);

  const cardActivity = useMemo<DashboardActivityEvent[]>(
    () =>
      customers
        .flatMap((customer) =>
          customer.cards.flatMap((card) =>
            (card.history || []).map((transaction) => ({
              id: transaction.id,
              type: transaction.type,
              customerName: customer.name,
              contextName: card.campaignName,
              pointsDelta: null,
              timestamp: transaction.timestamp,
            }))
          )
        )
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 8),
    [customers]
  );
  const recentActivity = dashboardSummary?.recentActivity ?? cardActivity;

  useEffect(() => {
    let isCurrent = true;
    if (!currentOwner?.id) {
      setDashboardSummary(null);
      setSummaryUnavailable(false);
      setSummaryLoading(false);
      return () => { isCurrent = false; };
    }

    setDashboardSummary(null);
    setSummaryUnavailable(false);
    setSummaryLoading(true);
    void fetchOwnerDashboardSummary()
      .then(result => {
        if (!isCurrent) return;
        if (result.ok) setDashboardSummary(result.summary);
        else setSummaryUnavailable(true);
      })
      .catch(() => {
        if (isCurrent) setSummaryUnavailable(true);
      })
      .finally(() => {
        if (isCurrent) setSummaryLoading(false);
      });

    return () => { isCurrent = false; };
  }, [currentOwner?.id]);

  const activeCardCount = cards.filter((card) => card.status === 'Active').length;
  const redeemedCardCount = cards.filter((card) => card.status === 'Redeemed').length;
  const activeCampaignCount = campaigns.filter((campaign) => campaign.isEnabled !== false).length;
  const hasStampActivity = cardActivity.some((transaction) => transaction.type === 'stamp_add');

  const steps: ChecklistStep[] = [
    {
      title: t('Create Campaign'),
      description: t('Create your first loyalty campaign.'),
      href: '/gallery',
      complete: campaigns.length > 0,
      buttonLabel: t('Create campaign'),
    },
    {
      title: t('Issue Card'),
      description: t('Issue your first loyalty card to a customer.'),
      href: '/issued-cards',
      complete: cards.length > 0,
      buttonLabel: t('Issue card'),
    },
    {
      title: t('Stamp a Card'),
      description: t('Open an issued card and add the first stamp.'),
      href: '/issued-cards',
      complete: hasStampActivity,
      buttonLabel: t('Add stamp'),
    },
  ];

  const completedSteps = steps.filter((step) => step.complete).length;
  const setupComplete = completedSteps === steps.length;
  const progressPercent = (completedSteps / steps.length) * 100;
  const showGetStarted = !setupComplete || !dismissedSections.getStarted;

  const statCards = [
    {
      label: t('Campaigns'),
      value: activeCampaignCount,
      detail: `${campaigns.length} ${t('total campaigns')}`,
      icon: CreditCard,
    },
    {
      label: t('Issued Cards'),
      value: cards.length,
      detail: cards.length === 1 ? t('1 card issued') : `${cards.length} ${t('cards issued')}`,
      icon: Wallet,
    },
    {
      label: t('Customers'),
      value: customers.length,
      detail: customers.length === 1 ? t('1 customer added') : `${customers.length} ${t('customers added')}`,
      icon: Users,
    },
    {
      label: t('Active Cards'),
      value: activeCardCount,
      detail: `${redeemedCardCount} ${t('redeemed')}`,
      icon: Sparkles,
    },
  ];

  useEffect(() => {
    if (!currentOwner?.id) {
      setDismissedSections(defaultDismissState);
      return;
    }

    const stored = loadFromStorage<DashboardDismissState>(dashboardDismissStateKey(currentOwner.id));
    setDismissedSections({
      getStarted: stored?.getStarted ?? false,
    });
  }, [currentOwner?.id]);

  const dismissSection = (section: keyof DashboardDismissState) => {
    if (!setupComplete || !currentOwner?.id) return;

    const nextState = {
      ...dismissedSections,
      [section]: true,
    };

    setDismissedSections(nextState);
    saveToStorage(dashboardDismissStateKey(currentOwner.id), nextState);
  };

  return (
    <LocalizedTree>
    <div className="h-full overflow-y-auto bg-gray-50/50 p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-[28px] border border-border/80 bg-card px-6 py-6 shadow-subtle md:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
                {t('Owner Overview')}
              </Badge>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">{t('Dashboard')}</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
                  {t('Get your loyalty program live in three steps. Progress updates automatically as you create campaigns, issue cards, and start stamping.')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/campaigns">{t('View Campaigns')}</Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link to="/gallery">{t('Create Campaign')}</Link>
              </Button>
            </div>
          </div>
        </header>

        {showGetStarted && (
          <Card className="rounded-[28px] border-border/80">
            <CardHeader className="gap-4 border-b border-border/70 pb-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl">{t('Get started')}</CardTitle>
                    {setupComplete && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                        onClick={() => dismissSection('getStarted')}
                        aria-label={t('Dismiss get started')}
                      >
                        {t('Dismiss')}
                      </Button>
                    )}
                  </div>
                  <CardDescription className="mt-1 text-sm">
                    {t('Launch your loyalty program in three steps.')}
                  </CardDescription>
                </div>
                <Badge
                  variant={setupComplete ? 'default' : 'outline'}
                  className={cn(
                    'w-fit rounded-full px-3 py-1',
                    setupComplete && 'bg-emerald-600 text-white hover:bg-emerald-600'
                  )}
                >
                  {setupComplete ? t('Setup complete') : `${completedSteps} ${t('of')} ${steps.length} ${t('completed')}`}
                </Badge>
              </div>
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {setupComplete ? (
                  <p className="text-sm text-muted-foreground">
                    {t('Your loyalty workflow is ready. Jump back into campaigns or issued cards anytime.')}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('Complete each step in order. The next action stays one click away.')}
                  </p>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-3">
                {steps.map((step, index) => (
                  <div
                    key={step.title}
                    className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-background/70 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                          step.complete
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-border bg-card text-foreground'
                        )}
                      >
                        {step.complete ? <CheckCircle2 size={20} /> : <span>{index + 1}</span>}
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                          {step.complete && (
                            <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                              {t('Completed')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    {step.complete ? (
                      <Button asChild variant="ghost" className="justify-start rounded-full md:justify-center">
                        <Link to={step.href}>
                          {setupComplete
                            ? step.title === t('Create Campaign')
                              ? t('Create another')
                              : t('Open workflow')
                            : t('Review')}
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild className="justify-start rounded-full md:justify-center">
                        <Link to={step.href}>
                          {step.buttonLabel}
                          <ArrowRight size={16} className="ml-2" />
                        </Link>
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {setupComplete && (
                <div className="flex flex-wrap gap-3 border-t border-border/70 pt-2">
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to="/gallery">Create Campaign</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to="/campaigns">View Campaigns</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to="/issued-cards">View Issued Cards</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((item) => (
            <Card key={item.label} className="rounded-[24px]">
              <CardContent className="flex items-start justify-between p-6">
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-foreground">{item.value}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <div className="rounded-2xl bg-muted p-3 text-foreground">
                  <item.icon size={20} />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">{t('Loyalty program snapshot')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('Quick status for missions, reward codes, points, and referrals.')}</p>
          </div>

          {summaryLoading && (
            <Card className="rounded-[24px]">
              <CardContent className="p-5 text-sm text-muted-foreground" role="status">{t('Loading...')}</CardContent>
            </Card>
          )}

          {summaryUnavailable && (
            <Card className="rounded-[24px] border-amber-200 bg-amber-50/70">
              <CardContent className="p-5 text-sm text-amber-900" role="status">
                {t('Dashboard loyalty summary is unavailable. Apply the dashboard summary database patch, then refresh this page.')}
              </CardContent>
            </Card>
          )}

          {dashboardSummary && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card className="rounded-[24px]">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg"><Target size={18} />{t('Missions')}</CardTitle>
                  <CardDescription>{t('Active missions')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-3xl font-bold tabular-nums">{dashboardSummary.activeMissionCount}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>{dashboardSummary.missionParticipantCount} {t('participants')}</span>
                    <span>{dashboardSummary.missionCompletionCount} {t('Completions')}</span>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                    <Link to="/missions">{t('View missions')}</Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[24px]">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg"><TicketCheck size={18} />{t('Rewards & codes')}</CardTitle>
                  <CardDescription>{t('Codes awaiting validation')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-3xl font-bold tabular-nums">{dashboardSummary.pendingRewardCodeCount}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>{dashboardSummary.activeRewardCount} {t('active rewards')}</span>
                    <span>{dashboardSummary.redeemedRewardCodeCount} {t('codes redeemed')}</span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Button asChild size="sm" className="w-full min-w-0 whitespace-normal text-center">
                      <Link to="/reward-redemptions">{t('Manage reward codes')}</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="w-full min-w-0 whitespace-normal text-center">
                      <Link to="/rewards">{t('Reward catalog')}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[24px]">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg"><Wallet size={18} />{t('Points and referrals')}</CardTitle>
                  <CardDescription>{t(dashboardSummary.pointsEnabled ? 'Points enabled' : 'Points disabled')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1 text-sm">
                    <p>{dashboardSummary.pointsPerVisit} {t('points per verified visit')}</p>
                    <p>{dashboardSummary.welcomePoints} {t('welcome points per new customer')}</p>
                    <p>{dashboardSummary.loyaltyLevelCount} {t('loyalty levels')}</p>
                    {dashboardSummary.welcomePoints > 0 && (
                      <p className="text-xs text-muted-foreground">{t('The referrer earns half after the friend’s first verified visit.')}</p>
                    )}
                  </div>
                  <div className="border-t border-border/70 pt-3 text-sm text-muted-foreground">
                    <p>{dashboardSummary.rewardedReferralCount} {t('referrals rewarded')} · {dashboardSummary.pendingReferralCount} {t('pending referrals')}</p>
                    <p className="mt-1">{dashboardSummary.referralPointsAwarded} {t('referral points awarded')}</p>
                    <p className="mt-1">{dashboardSummary.welcomeBonusCustomerCount} {t('customers received welcome points')} · {dashboardSummary.welcomePointsAwarded} {t('welcome points awarded')}</p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                    <Link to="/settings?tab=loyalty">{t('Loyalty settings')}</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        <Card className="rounded-[28px]">
          <CardHeader className="border-b border-border/70 pb-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                  <CardTitle className="text-xl">{t('Recent activity')}</CardTitle>
                <CardDescription className="mt-1">
                  {t('Latest customer activity across cards, missions, rewards, and points.')}
                </CardDescription>
              </div>
              <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                {recentActivity.length} {t('shown')}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {recentActivity.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-subtle">
                  <ReceiptText size={20} className="text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{t('No activity yet')}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('Complete the checklist above to get started.')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <div
                    key={`${activity.type}:${activity.id}`}
                    className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/70 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-muted p-3 text-foreground">
                        {activity.type.startsWith('reward_code_') || activity.type === 'redeem' || activity.type === 'mission_reward_redeemed' ? (
                          <Gift size={18} />
                        ) : activity.type.startsWith('mission_') ? (
                          <Target size={18} />
                        ) : activity.type === 'issued' || activity.type === 'welcome_bonus' || activity.type === 'referral_reward' ? (
                          <Wallet size={18} />
                        ) : (
                          <PlusCircle size={18} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{formatAction(activity.type, t)}</p>
                        <p className="text-sm text-muted-foreground">
                          {activity.customerName}
                          {activity.contextName && <> · {activity.contextName}</>}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground md:text-right">
                      <div>{formatTimestamp(activity.timestamp, language)}</div>
                      {activity.pointsDelta !== null && (
                        <div className="text-xs font-medium text-emerald-700">+{activity.pointsDelta} {t('points')}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </LocalizedTree>
  );
};
