import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

interface AddRowOptions {
  appId: string;
  tableName: string;
  onSuccess?: () => void;
}

interface UpdateRowOptions {
  appId: string;
  tableName: string;
  primaryKey: Record<string, any>;
  onSuccess?: () => void;
}

interface DeleteRowOptions {
  appId: string;
  tableName: string;
}

/**
 * Hook for adding a new row to a database table
 *
 * Automatically invalidates table data queries on success to trigger a refetch.
 *
 * @param options - Configuration options
 * @param options.appId - The application ID
 * @param options.tableName - The name of the table
 * @param options.onSuccess - Optional callback to execute on successful mutation
 * @returns Mutation object with mutate function and loading/error states
 */
export function useAddRow({ appId, tableName, onSuccess }: AddRowOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await appFetch(`/api/database/${appId}/tables/${tableName}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      }, { authLevel: 3 });

      if (!response.ok) {
        const errorData = await response.json().catch((parseError) => {
          logger.error('Add row response parse error:', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            parseError: parseError.message,
            appId,
            tableName,
          });
          return {
            error: `Server returned ${response.status} ${response.statusText} (expected JSON, got ${response.headers.get('content-type') || 'unknown'})`
          };
        });
        const errorMessage = errorData.error || 'Failed to insert row';

        logger.error('Add row error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
          tableName,
        });

        throw new Error(errorMessage);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-data', appId, tableName] });
      onSuccess?.();
    },
  });
}

/**
 * Hook for updating an existing row in a database table
 *
 * Automatically invalidates table data queries on success to trigger a refetch.
 *
 * @param options - Configuration options
 * @param options.appId - The application ID
 * @param options.tableName - The name of the table
 * @param options.primaryKey - The primary key identifying the row to update
 * @param options.onSuccess - Optional callback to execute on successful mutation
 * @returns Mutation object with mutate function and loading/error states
 */
export function useUpdateRow({ appId, tableName, primaryKey, onSuccess }: UpdateRowOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await appFetch(`/api/database/${appId}/tables/${tableName}/rows`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryKey, data }),
      }, { authLevel: 3 });

      if (!response.ok) {
        const errorData = await response.json().catch((parseError) => {
          logger.error('Update row response parse error:', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            parseError: parseError.message,
            appId,
            tableName,
            primaryKey,
          });
          return {
            error: `Server returned ${response.status} ${response.statusText} (expected JSON, got ${response.headers.get('content-type') || 'unknown'})`
          };
        });
        const errorMessage = errorData.error || 'Failed to update row';

        logger.error('Update row error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
          tableName,
          primaryKey,
        });

        throw new Error(errorMessage);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-data', appId, tableName] });
      onSuccess?.();
    },
  });
}

/**
 * Hook for deleting a row from a database table
 *
 * Automatically invalidates table data queries on success to trigger a refetch.
 *
 * @param options - Configuration options
 * @param options.appId - The application ID
 * @param options.tableName - The name of the table
 * @returns Mutation object with mutate function and loading/error states
 *
 * @example
 * ```tsx
 * const deleteRow = useDeleteRow({
 *   appId: 'my-app',
 *   tableName: 'users'
 * });
 * deleteRow.mutate({ id: 1 });
 * ```
 */
export function useDeleteRow({ appId, tableName }: DeleteRowOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (primaryKey: Record<string, any>) => {
      const response = await appFetch(`/api/database/${appId}/tables/${tableName}/rows`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryKey }),
      }, { authLevel: 3 });

      if (!response.ok) {
        const errorData = await response.json().catch((parseError) => {
          logger.error('Delete row response parse error:', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            parseError: parseError.message,
            appId,
            tableName,
            primaryKey,
          });
          return {
            error: `Server returned ${response.status} ${response.statusText} (expected JSON, got ${response.headers.get('content-type') || 'unknown'})`
          };
        });
        const errorMessage = errorData.error || 'Failed to delete row';

        logger.error('Delete row error:', {
          status: response.status,
          errorData,
          errorMessage,
          appId,
          tableName,
          primaryKey,
        });

        throw new Error(errorMessage);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-data', appId, tableName] });
    },
  });
}

