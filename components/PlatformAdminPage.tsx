import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { Button } from './ui/button';
import { supabase } from '../lib/supabase';
import { useLocale } from './LocaleProvider';

type PlatformTenant = {
  id: string;
  business_name: string;
  email: string;
  slug: string | null;
  access: 'active' | 'disabled';
  tier: string;
  created_at: string;
  staff_count: number;
  campaign_count: number;
  customer_count: number;
};

export const PlatformAdminPage: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const { t, language } = useLocale();
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTenantId, setBusyTenantId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('platform_list_tenants');
    if (rpcError) {
      setError(t('Unable to load businesses. Apply the SaaS platform database migration and try again.'));
      setTenants([]);
    } else {
      setTenants((data ?? []) as PlatformTenant[]);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const activeCount = useMemo(() => tenants.filter((tenant) => tenant.access === 'active').length, [tenants]);

  const handleToggleAccess = async (tenant: PlatformTenant) => {
    const nextAccess = tenant.access === 'active' ? 'disabled' : 'active';
    setBusyTenantId(tenant.id);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('platform_set_tenant_access', {
      owner_uid: tenant.id,
      access_value: nextAccess,
    });
    if (rpcError) {
      setError(t('Unable to update business access. Please try again.'));
    } else {
      setNotice(t(nextAccess === 'active' ? 'Business access restored.' : 'Business access suspended.'));
      await loadTenants();
    }
    setBusyTenantId(null);
  };

  const createdAt = (value: string) => new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(value));

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-subtle sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-3 text-primary"><ShieldCheck className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Stampfy SaaS</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{t('Platform administration')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{currentUser?.email}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void loadTenants()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{t('Refresh')}
            </Button>
            <Button variant="outline" onClick={() => void logout()}>
              <LogOut className="mr-2 h-4 w-4" />{t('Log Out')}
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { label: t('Business tenants'), value: tenants.length },
            { label: t('Active businesses'), value: activeCount },
            { label: t('Suspended businesses'), value: tenants.length - activeCount },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-border/80 bg-card p-5 shadow-subtle">
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{item.value}</p>
            </div>
          ))}
        </section>

        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t('Business tenants')}</h2>
          </div>
          {loading ? (
            <div className="rounded-2xl border border-border/80 bg-card p-8 text-center text-sm text-muted-foreground">{t('Loading businesses...')}</div>
          ) : tenants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <p className="font-medium">{t('No businesses have signed up yet.')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('New owner accounts will appear here after signup.')}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {tenants.map((tenant) => (
                <article key={tenant.id} className="rounded-2xl border border-border/80 bg-card p-4 shadow-subtle sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold">{tenant.business_name || t('Unnamed business')}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tenant.access === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                          {t(tenant.access === 'active' ? 'Active' : 'Suspended')}
                        </span>
                      </div>
                      <p className="break-all text-sm text-muted-foreground">{tenant.email}</p>
                      <p className="text-xs text-muted-foreground">{tenant.slug ? `/${tenant.slug}` : t('No public URL')} · {t('Joined')} {createdAt(tenant.created_at)}</p>
                    </div>
                    <Button
                      variant={tenant.access === 'active' ? 'outline' : 'default'}
                      className="w-full shrink-0 sm:w-auto"
                      disabled={busyTenantId === tenant.id}
                      onClick={() => void handleToggleAccess(tenant)}
                    >
                      {busyTenantId === tenant.id
                        ? t('Saving...')
                        : t(tenant.access === 'active' ? 'Suspend business' : 'Restore access')}
                    </Button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground sm:grid-cols-4">
                    <span>{t('Plan')}: <strong className="text-foreground">{tenant.tier}</strong></span>
                    <span>{t('Staff')}: <strong className="text-foreground">{tenant.staff_count}</strong></span>
                    <span>{t('Campaigns')}: <strong className="text-foreground">{tenant.campaign_count}</strong></span>
                    <span>{t('Customers')}: <strong className="text-foreground">{tenant.customer_count}</strong></span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
