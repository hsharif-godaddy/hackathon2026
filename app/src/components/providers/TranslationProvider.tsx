'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { IntlProvider } from 'react-intl';
import { IntlErrorCode } from '@formatjs/intl';

import LoadingComponent from '@/components/auth/LoadingComponent';
import { useGasketData } from '@/hooks/useGasketData';
import { useTranslationPackages } from '@/hooks/useTranslationPackages';
import { logger } from '@/lib/request-context';
import { mergeDevPreviewOverrides } from '@/lib/translations/merge-dev-preview-overrides';

interface TranslationsState {
  translationsLoading: boolean;
  translationsError: boolean;
  translationsSuccess: boolean;
}

interface TranslationsProviderProps {
  locale?: string;
  messages?: Record<string, string>;
  packages?: string[];
  children: React.ReactNode;
}

const defaultTranslationsState: TranslationsState = {
  translationsLoading: false,
  translationsError: false,
  translationsSuccess: false,
};

const TranslationsContext = createContext<TranslationsState>(defaultTranslationsState);

/**
 * Translations provider that wraps the app with IntlProvider
 *
 * Supports both server-side pre-loaded translations and client-side fetching:
 * - If messages are provided, uses them directly (server-side mode)
 * - If messages are not provided, fetches them client-side (client-side mode)
 *
 * @param props - Provider props
 * @param props.locale - The locale to use (optional, defaults to gasketData locale)
 * @param props.messages - Pre-loaded translation messages from server (optional)
 * @param props.packages - Package names to fetch translations from (required if messages not provided)
 * @param props.children - Child components to wrap
 *
 * @example
 * ```tsx
 * // Server-side mode (in layout.tsx)
 * const messages = await loadTranslations('en-US', ['@airo-app-builder/aab']);
 * const locale = await detectTranslationLocale();
 *
 * <TranslationsProvider locale={locale} messages={messages}>
 *   {children}
 * </TranslationsProvider>
 * ```
 *
 * @example
 * ```tsx
 * // Client-side mode
 * <TranslationsProvider packages={['@airo-app-builder/aab']}>
 *   {children}
 * </TranslationsProvider>
 * ```
 */
export function TranslationsProvider(props: TranslationsProviderProps) {
  const {
    locale: localeFromProps,
    messages: messagesFromProps,
    packages,
    children,
  } = props;

  const gasketData = useGasketData();
  const clientFetch = useTranslationPackages(messagesFromProps ? [] : packages || []);

  const isServerSideMode = messagesFromProps !== undefined;
  const isLoading = !isServerSideMode && clientFetch.isLoading;
  const isError = !isServerSideMode && clientFetch.isError;
  const isSuccess = isServerSideMode || clientFetch.isSuccess;

  const locale = localeFromProps || gasketData?.intl?.locale || 'en-US';
  const messages = useMemo(
    () => mergeDevPreviewOverrides(messagesFromProps || clientFetch.data || {}),
    [messagesFromProps, clientFetch.data],
  );

  const translationsState = useMemo<TranslationsState>(() => ({
    translationsLoading: isLoading,
    translationsError: isError,
    translationsSuccess: isSuccess,
  }), [isLoading, isError, isSuccess]);

  return (
    <TranslationsContext.Provider value={ translationsState }>
      <IntlProvider
        defaultLocale={ locale }
        locale={ locale }
        messages={ messages }
        onError={(error) => {
          if (error.code === IntlErrorCode.MISSING_TRANSLATION) {
            if (process.env.NODE_ENV !== 'development') {
              logger.warn('translations.intl.missing', { code: error.code, message: error.message });
            }
            return;
          }
          logger.error('translations.intl.error', { code: error.code, message: error.message });
          if (process.env.NODE_ENV === 'development') throw error;
        }}
      >
        { isLoading
          ? <LoadingComponent />
          : children
        }
      </IntlProvider>
    </TranslationsContext.Provider>
  );
}

/**
 * Hook to access translation loading state
 *
 * @returns Translation state with loading, error, and success flags
 */
export function useTranslationsState(): TranslationsState {
  return useContext(TranslationsContext);
}

/**
 * Hook to check if translations are loaded
 *
 * @returns True if translations are successfully loaded
 */
export function useAreTranslationsLoaded(): boolean {
  const { translationsSuccess } = useTranslationsState();
  return translationsSuccess;
}
