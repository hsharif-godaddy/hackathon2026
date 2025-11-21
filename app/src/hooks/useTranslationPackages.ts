import { useQuery } from '@tanstack/react-query';
import { fetchTranslationPackages } from '@/lib/translations/fetch-translations';

/**
 * Hook to fetch translation packages client-side
 *
 * @param packages - Array of package names to fetch
 * @returns Query state with translation data
 */
export function useTranslationPackages(packages: string[]) {
  return useQuery({
    queryKey: ['translationPackages', packages],
    queryFn: async () => fetchTranslationPackages(packages, {
      credentials: 'include',
    }),
    enabled: packages.length > 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
