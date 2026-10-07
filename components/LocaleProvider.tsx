import React, { createContext, useContext, useEffect, useMemo } from 'react';
import type { BusinessCurrency, InterfaceLanguage } from '../types';
import { formatCurrency, translate } from '../lib/i18n';
import { useAuth } from './AuthProvider';

interface LocaleContextValue {
  language: InterfaceLanguage;
  currency: BusinessCurrency;
  t: (source: string) => string;
  formatMoney: (amount: number) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  language: 'pt-BR',
  currency: 'BRL',
  t: source => translate('pt-BR', source),
  formatMoney: amount => formatCurrency(amount, 'BRL', 'pt-BR'),
});

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentOwner } = useAuth();
  const language = currentOwner?.interfaceLanguage ?? 'pt-BR';
  const currency = currentOwner?.currencyCode ?? 'BRL';

  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.setAttribute('translate', 'no');
  }, [language]);

  const value = useMemo<LocaleContextValue>(() => ({
    language,
    currency,
    t: source => translate(language, source),
    formatMoney: amount => formatCurrency(amount, currency, language),
  }), [currency, language]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = () => useContext(LocaleContext);
