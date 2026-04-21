import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useAddRow, useDeleteRow, useUpdateRow } from './useTableMutations';

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

describe('useTableMutations', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useAddRow', () => {
    it('should add a row successfully', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 1, name: 'Test' }),
      } as Response);

      const { result } = renderHook(
        () => useAddRow({ appId: 'test-app', tableName: 'users' }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Test', email: 'test@example.com' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(appFetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/users/rows',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { name: 'Test', email: 'test@example.com' } }),
        }),
        { authLevel: 3 }
      );
    });

    it('should call onSuccess callback when provided', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 1 }),
      } as Response);

      const onSuccess = vi.fn();
      const { result } = renderHook(
        () => useAddRow({ appId: 'test-app', tableName: 'users', onSuccess }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Test' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(onSuccess).toHaveBeenCalled();
    });

    it('should handle add row errors', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid data' }),
      } as Response);

      const { result } = renderHook(
        () => useAddRow({ appId: 'test-app', tableName: 'users' }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Test' });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe('Invalid data');
    });

    it('should handle HTML error responses gracefully', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: (name: string) => name === 'content-type' ? 'text/html' : null,
        },
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      } as Response);

      const { result } = renderHook(
        () => useAddRow({ appId: 'test-app', tableName: 'users' }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Test' });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toContain('500 Internal Server Error');
      expect(result.current.error?.message).toContain('text/html');
    });

  });

  describe('useUpdateRow', () => {
    it('should update a row successfully', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ updated: true }),
      } as Response);

      const { result } = renderHook(
        () =>
          useUpdateRow({
            appId: 'test-app',
            tableName: 'users',
            primaryKey: { id: 1 },
          }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Updated Name' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(appFetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/users/rows',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryKey: { id: 1 },
            data: { name: 'Updated Name' },
          }),
        }),
        { authLevel: 3 }
      );
    });

    it('should call onSuccess callback when provided', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ updated: true }),
      } as Response);

      const onSuccess = vi.fn();
      const { result } = renderHook(
        () =>
          useUpdateRow({
            appId: 'test-app',
            tableName: 'users',
            primaryKey: { id: 1 },
            onSuccess,
          }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Test' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(onSuccess).toHaveBeenCalled();
    });

    it('should handle update errors', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Row not found' }),
      } as Response);

      const { result } = renderHook(
        () =>
          useUpdateRow({
            appId: 'test-app',
            tableName: 'users',
            primaryKey: { id: 999 },
          }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Test' });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe('Row not found');
    });

    it('should handle HTML error responses gracefully', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: {
          get: (name: string) => name === 'content-type' ? 'text/html; charset=utf-8' : null,
        },
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      } as Response);

      const { result } = renderHook(
        () =>
          useUpdateRow({
            appId: 'test-app',
            tableName: 'users',
            primaryKey: { id: 1 },
          }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ name: 'Test' });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toContain('502 Bad Gateway');
      expect(result.current.error?.message).toContain('text/html');
    });

  });

  describe('useDeleteRow', () => {
    it('should delete a row successfully', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ deleted: true }),
      } as Response);

      const { result } = renderHook(
        () => useDeleteRow({ appId: 'test-app', tableName: 'users' }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ id: 1 });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(appFetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/users/rows',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryKey: { id: 1 } }),
        }),
        { authLevel: 3 }
      );
    });

    it('should handle delete errors', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Row not found' }),
      } as Response);

      const { result } = renderHook(
        () => useDeleteRow({ appId: 'test-app', tableName: 'users' }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ id: 999 });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe('Row not found');
    });


    it('should handle composite primary keys', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ deleted: true }),
      } as Response);

      const { result } = renderHook(
        () => useDeleteRow({ appId: 'test-app', tableName: 'user_roles' }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ userId: 1, roleId: 2 });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(appFetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/user_roles/rows',
        expect.objectContaining({
          body: JSON.stringify({ primaryKey: { userId: 1, roleId: 2 } }),
        }),
        { authLevel: 3 }
      );
    });

    it('should handle HTML error responses gracefully', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          get: (name: string) => name === 'content-type' ? 'text/html' : null,
        },
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      } as Response);

      const { result } = renderHook(
        () => useDeleteRow({ appId: 'test-app', tableName: 'users' }),
        { wrapper: createWrapper() }
      );

      result.current.mutate({ id: 1 });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toContain('503 Service Unavailable');
      expect(result.current.error?.message).toContain('text/html');
    });
  });
});
