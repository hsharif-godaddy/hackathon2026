import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Domain attach request payload
 */
export interface DomainAttachPayload {
  domainName: string;
  ip: string;
  dryrun?: boolean;
  force?: boolean;
}

/**
 * Domain attach response
 */
export interface DomainAttachResponse {
  success?: boolean;
  message?: string;
  [key: string]: any;
}

/**
 * React Query mutation hook for attaching a customer domain to the service
 *
 * This hook calls the domain-attach API endpoint to configure DNS records
 * for a customer's GoDaddy domain to point to their Airo application.
 *
 * @returns Mutation object with mutate/mutateAsync functions
 *
 * @example
 * ```typescript
 * const attachDomainMutation = useDomainAttach();
 *
 * // Attach a domain
 * await attachDomainMutation.mutateAsync({
 *   domainName: 'example.com',
 *   ip: '192.168.1.1'
 * });
 * ```
 */
export function useDomainAttach() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: DomainAttachPayload): Promise<DomainAttachResponse> => {
      const response = await appFetch(`/api/domains/attach`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to attach domain: ${response.status}`;

        throw new Error(errorMessage);
      }

      const data: DomainAttachResponse = await response.json();

      return data;
    },
    onSuccess: () => {
      // Invalidate domains query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['domains'] });
    },
  });
}
