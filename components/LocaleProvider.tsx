import React, { createContext, useContext, useEffect, useMemo } from 'react';
import type { BusinessCurrency, InterfaceLanguage } from '../types';
import { formatCurrency, translate } from '../lib/i18n';
import { useAuth } from './AuthProvider';

interface LocaleContextValue {
  language: InterfaceLanguage;
  currency: BusinessCurrency;
  setPreferredLanguage: (language: InterfaceLanguage) => void;
  t: (source: string) => string;
  formatMoney: (amount: number) => string;
}

const LANGUAGE_STORAGE_KEY = 'stampfy_interface_language_v1';

const readStoredLanguage = (): InterfaceLanguage => {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'pt-BR' || saved === 'es' || saved === 'en') return saved;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return 'pt-BR';
};

const LocaleContext = createContext<LocaleContextValue>({
  language: 'pt-BR',
  currency: 'BRL',
  setPreferredLanguage: () => undefined,
  t: source => translate('pt-BR', source),
  formatMoney: amount => formatCurrency(amount, 'BRL', 'pt-BR'),
});

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentOwner } = useAuth();
  const [storedLanguage, setStoredLanguage] = React.useState<InterfaceLanguage>(readStoredLanguage);
  const language = currentOwner?.interfaceLanguage ?? storedLanguage;
  const currency = currentOwner?.currencyCode ?? 'BRL';

  const setPreferredLanguage = React.useCallback((nextLanguage: InterfaceLanguage) => {
    setStoredLanguage(nextLanguage);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // Keep the in-memory preference for this session if storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.setAttribute('translate', 'no');
  }, [language]);

  useEffect(() => {
    if (currentOwner?.interfaceLanguage) setPreferredLanguage(currentOwner.interfaceLanguage);
  }, [currentOwner?.interfaceLanguage, setPreferredLanguage]);

  const value = useMemo<LocaleContextValue>(() => ({
    language,
    currency,
    setPreferredLanguage,
    t: source => translate(language, source),
    formatMoney: amount => formatCurrency(amount, currency, language),
  }), [currency, language, setPreferredLanguage]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = () => useContext(LocaleContext);
