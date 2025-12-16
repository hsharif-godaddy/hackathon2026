import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';

/**
 * Response from the database tables API endpoint
 */
interface TablesResponse {
  tables: string[];
  count: number;
}

/**
 * Options for the useDatabaseTables hook
 */
interface UseDatabaseTablesOptions {
  appId: string;
  enabled?: boolean;
}

/**
 * Fetch database tables for an application
 * 
 * Custom hook that fetches the list of database tables for a given app ID.
 * Handles 404 responses as empty state (no tables created yet) and provides
 * proper error handling for other failure scenarios.
 * 
 * @param options - Configuration options
 * @param options.appId - The application ID to fetch tables for
 * @param options.enabled - Whether the query should run (default: true)
 * @returns Query result with tables data, loading state, and error
 * 
 * @example
 * ```tsx
 * const { data: tables = [], isLoading, error, refetch } = useDatabaseTables({
 *   appId: 'my-app-id'
 * });
 * ```
 */
export function useDatabaseTables({ appId, enabled = true }: UseDatabaseTablesOptions) {
  return useQuery({
    queryKey: ['database-tables', appId],
    queryFn: async () => {
      const response = await fetch(`/api/database/${appId}/tables`);

      // Handle 404 as empty state (no tables created yet)
      if (response.status === 404) {
        return [];
      }

      if (!response.ok) {
        const errorData = await response.json();
        // Handle nested error structures from API
        const errorMessage = errorData.error?.message || errorData.error || errorData.message || 'Failed to fetch tables';
        
        logger.error('Database tables fetch error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
        });
        
        throw new Error(errorMessage);
      }

      const data: TablesResponse = await response.json();
      return data.tables;
    },
    enabled: enabled && !!appId,
    staleTime: 30000, // Consider data fresh for 30 seconds
    retry: 1, // Retry once on failure
  });
}

