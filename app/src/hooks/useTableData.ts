import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';

/**
 * Response from the table data API endpoint
 */
interface TableDataResult {
  rows: Record<string, any>[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Options for the useTableData hook
 */
interface UseTableDataOptions {
  appId: string;
  tableName: string;
  page: number;
  limit?: number;
  enabled?: boolean;
}

/**
 * Fetch paginated data from a database table
 *
 * Custom hook that fetches rows from a specific database table with pagination
 * support. Provides proper error handling and caching via React Query.
 *
 * @param options - Configuration options
 * @param options.appId - The application ID
 * @param options.tableName - The name of the table to fetch data from
 * @param options.page - The page number to fetch (1-indexed)
 * @param options.limit - Number of rows per page (default: 25)
 * @param options.enabled - Whether the query should run (default: true)
 * @returns Query result with table data, pagination info, loading state, and error
 *
 * @example
 * ```tsx
 * const { data, isLoading, error, refetch } = useTableData({
 *   appId: 'my-app-id',
 *   tableName: 'users',
 *   page: 1,
 *   limit: 25
 * });
 * ```
 */
export function useTableData({ appId, tableName, page, limit = 25, enabled = true }: UseTableDataOptions) {
  return useQuery({
    queryKey: ['table-data', appId, tableName, page, limit],
    queryFn: async () => {
      const response = await fetch(
        `/api/database/${appId}/tables/${tableName}/data?page=${page}&limit=${limit}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || errorData.error || errorData.message || 'Failed to fetch data';

        logger.error('Table data fetch error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
          tableName,
          page,
          limit,
        });

        throw new Error(errorMessage);
      }

      const result: TableDataResult = await response.json();
      return result;
    },
    enabled: enabled && !!appId && !!tableName,
    staleTime: 10000,
    retry: 1,
  });
}

