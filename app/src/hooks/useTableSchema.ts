import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';

/**
 * Column information from the table schema
 */
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  default: string | null;
  extra: string;
}

/**
 * Response from the table schema API endpoint
 */
interface SchemaResponse {
  columns: ColumnInfo[];
}

/**
 * Options for the useTableSchema hook
 */
interface UseTableSchemaOptions {
  appId: string;
  tableName: string;
  enabled?: boolean;
}

/**
 * Fetch schema information for a database table
 *
 * Custom hook that fetches the column schema (structure) for a specific database
 * table. The schema includes column names, types, nullability, keys, defaults, and
 * extra information. Schema data is cached and considered fresh for 5 minutes.
 *
 * @param options - Configuration options
 * @param options.appId - The application ID
 * @param options.tableName - The name of the table to fetch schema for
 * @param options.enabled - Whether the query should run (default: true)
 * @returns Query result with schema columns, loading state, and error
 *
 * @example
 * ```tsx
 * const { data: schema = [], isLoading, error } = useTableSchema({
 *   appId: 'my-app-id',
 *   tableName: 'users'
 * });
 * ```
 */
export function useTableSchema({ appId, tableName, enabled = true }: UseTableSchemaOptions) {
  return useQuery({
    queryKey: ['table-schema', appId, tableName],
    queryFn: async () => {
      const response = await fetch(`/api/database/${appId}/tables/${tableName}/schema`);

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || errorData.error || errorData.message || 'Failed to fetch schema';

        logger.error('Table schema fetch error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
          tableName,
        });

        throw new Error(errorMessage);
      }

      const result: SchemaResponse = await response.json();
      return result.columns;
    },
    enabled: enabled && !!appId && !!tableName,
    staleTime: 300000,
    retry: 1,
  });
}

