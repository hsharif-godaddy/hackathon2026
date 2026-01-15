/**
 * Hook for creating language-aware paths
 *
 * Returns a function that prefixes paths with the current language code.
 * Use this for all internal navigation to maintain language consistency.
 */

import { useTranslation } from 'react-i18next';

export default function useLocalizedPath() {
  const { i18n } = useTranslation();

  return (path: string): string => {
    const lang = i18n.language;
    if (path === '/') {
      return `/${lang}`;
    }
    // Normalize: ensure leading slash, remove trailing slash
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const withoutTrailing = normalized.replace(/\/$/, '');
    return `/${lang}${withoutTrailing}`;
  };
}
