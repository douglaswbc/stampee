import React from 'react';
import { ArrowRight, Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocale } from './LocaleProvider';

export const CustomerAccountInvitation: React.FC = () => {
  const { t } = useLocale();
  return (
    <section className="mx-auto mb-6 flex w-[calc(100%_-_2rem)] max-w-xl flex-col gap-3 rounded-2xl border border-black/5 bg-white/85 p-4 sm:flex-row sm:items-center sm:justify-between md:mx-0 md:w-full">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-2 text-primary"><Ticket size={18} /></span>
        <div><p className="text-sm font-semibold text-foreground">{t('Keep your Stampfy cards together')}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('Create an optional customer account to see cards from different businesses in one place.')}</p></div>
      </div>
      <Link to="/account" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90">{t('Open my account')} <ArrowRight size={15} /></Link>
    </section>
  );
};
