import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { logger } from '@/lib/request-context';
import { getRootDomain } from '@/utils/getRootDomain';

interface ReferralLinkResponse {
  referralId: string;
}

interface UseReferralLinkOptions {
  /** Whether the query should be enabled */
  enabled?: boolean;
}

interface UseReferralLinkResult {
  /** The full referral link URL */
  referralLink: string | undefined;
  /** Whether the query is loading */
  isLoading: boolean;
  /** Error if the query failed */
  error: Error | null;
}

/**
 * Hook to fetch the authenticated user's referral link
 *
 * Fetches a secure referral ID from the /api/referral-link endpoint
 * and constructs the full referral link URL.
 *
 * @param options.enabled - Whether to enable the query (default: true when authenticated)
 * @returns Object with referralLink URL, loading state, and error
 *
 * @example
 * ```tsx
 * const { referralLink, isLoading, error } = useReferralLink({ enabled: isPopoverOpen });
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error />;
 *
 * return <input value={referralLink} />;
 * ```
 */
export function useReferralLink({ enabled = true }: UseReferralLinkOptions = {}): UseReferralLinkResult {
  const { isAuthenticated, authenticatedFetch } = useAuthContext();

  const { data, isLoading, error } = useQuery<ReferralLinkResponse>({
    queryKey: ['referral-link'],
    queryFn: async () => {
      const response = await authenticatedFetch('/api/referral-link');

      if (!response.ok) {
        logger.error('referral-link.error', {
          error: response.statusText,
        });
        throw new Error('Failed to generate referral link');
      }

      return response.json();
    },
    enabled: isAuthenticated && enabled,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Construct the full referral link URL
  const referralLink = data?.referralId
    ? `https://airo-builder.${getRootDomain()}?referralId=${data.referralId}`
    : undefined;

  // Ensure error is always Error | null to match return type
  let errorResult: Error | null = null;
  if (error instanceof Error) {
    errorResult = error;
  } else if (error) {
    errorResult = new Error(typeof error === 'string' ? error : JSON.stringify(error));
  }

  return { referralLink, isLoading, error: errorResult };
}
