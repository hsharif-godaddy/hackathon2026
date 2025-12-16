import { useQuery } from '@tanstack/react-query';

import { fetchTranslationPackages } from '@/lib/translations/fetch-translations';
import { useGasketData } from './useGasketData';

/**
 * Hook to fetch translation packages client-side
 *
 * @param packages - Array of package names to fetch
 * @returns Query state with translation data
 */
export function useTranslationPackages(packages: string[]) {
  const gasketData = useGasketData();
  const locale = gasketData?.intl?.locale || 'en-US';
  
  return useQuery({
    queryKey: ['translationPackages', packages, locale],
    queryFn: async () => fetchTranslationPackages(packages, locale, {
      credentials: 'include',
    }),
    enabled: packages.length > 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
