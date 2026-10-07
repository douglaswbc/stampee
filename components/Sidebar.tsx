import React from 'react';
import { LayoutDashboard, Users, CreditCard, Settings, LogOut, Wallet, History, QrCode, Crown, Sparkles, Target, Gift, TicketCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useSubscriptionContext } from './SubscriptionContext';
import { useLocale } from './LocaleProvider';

interface SidebarProps {
  className?: string;
  onScanQr?: () => void;
}

interface SidebarContentProps {
  onNavigate?: () => void;
  onScanQr?: () => void;
}

export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner'] },
  { path: '/campaigns', label: 'Campaigns', icon: CreditCard, roles: ['owner'] },
  { path: '/missions', label: 'Missions', icon: Target, roles: ['owner'] },
  { path: '/rewards', label: 'Rewards', icon: Gift, roles: ['owner'] },
  { path: '/reward-redemptions', label: 'Reward Codes', icon: TicketCheck, roles: ['owner', 'staff'] },
  { path: '/issued-cards', label: 'Issued Cards', icon: Wallet, roles: ['owner', 'staff'] },
  { path: '/transactions', label: 'Transactions', icon: History, roles: ['owner'] },
  { path: '/customers', label: 'Customers', icon: Users, roles: ['owner', 'staff'] },
  { path: '/analytics', label: 'Analytics', icon: Sparkles, roles: ['owner'] },
  { path: '/settings', label: 'Settings', icon: Settings, roles: ['owner'] },
];

const PlanBadge: React.FC = () => {
  const {
    isProTier,
    campaignCount,
    campaignLimit,
    issuedCardCount,
    cardLimit,
  } = useSubscriptionContext();
  const { isStaff } = useAuth();
  const { t } = useLocale();
  if (isStaff) return null;

  if (isProTier) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-3 py-2 text-xs">
        <Crown size={14} className="text-amber-500" />
        <span className="font-semibold text-amber-700">{t('Pro Plan')}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground">{t('Beta Plan')}</span>
        <Sparkles size={12} className="text-muted-foreground" />
      </div>
      <div className="flex items-center gap-3 text-muted-foreground">
        <span>{campaignCount}/{campaignLimit === Infinity ? '∞' : campaignLimit} {t('campaigns')}</span>
        <span className="text-border">|</span>
        <span>{issuedCardCount}/{cardLimit === Infinity ? '∞' : cardLimit} {t('cards')}</span>
      </div>
    </div>
  );
};

export const SidebarContent: React.FC<SidebarContentProps> = ({ onNavigate, onScanQr }) => {
  const navigate = useNavigate();
  const { currentUser, currentOwner, isStaff, logout } = useAuth();
  const { t } = useLocale();

  return (
    <div className="flex h-full flex-col py-8">
      <div className="px-3 py-2">
        <div className="mb-6 px-4 flex items-center gap-3">
          <Link to="/" className="inline-flex items-center" onClick={onNavigate}>
            <img
              src="/stampfy.svg?v=2"
              alt="Stampfy logo"
              className="h-12 w-auto"
            />
          </Link>
        </div>
        <div className="space-y-2">
          {NAV_ITEMS.filter((item) => item.roles.includes(isStaff ? 'staff' : 'owner')).map((item) => (
            <NavLink to={item.path} key={item.path} onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2"
                >
                  <item.icon size={20} />
                  {t(item.label)}
                </Button>
              )}
            </NavLink>
          ))}
          {isStaff && (
            <Button
              variant="default"
              className="w-full justify-start gap-2 mt-2"
              onClick={() => {
                onScanQr?.();
                onNavigate?.();
              }}
            >
              <QrCode size={20} />
              {t('Scan QR Code')}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-auto px-4 pt-6 space-y-3">
         <PlanBadge />
         {currentUser && (
          <div className="rounded-lg border border-border/80 bg-card px-3 py-3 text-xs text-muted-foreground shadow-subtle">
              <div className="break-words font-semibold text-foreground">{currentUser.businessName}</div>
              <div className="break-all font-mono">@{currentOwner?.slug ?? "staff"}</div>
              {isStaff && <div className="text-[10px] uppercase tracking-widest mt-1">{t('Staff Access')}</div>}
          </div>
         )}
         <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
         >
            <LogOut size={20} />
            {t('Log Out')}
         </Button>
         <div className="px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            v0.5
         </div>
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ className, onScanQr }) => {
  return (
    <div className={cn("hidden h-screen w-72 border-r border-border/80 bg-card md:block", className)}>
      <SidebarContent onScanQr={onScanQr} />
    </div>
  );
};
