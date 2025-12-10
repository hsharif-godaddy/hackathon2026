import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAddRow, useUpdateRow, useDeleteRow } from './useTableMutations';
import React, { type ReactNode } from 'react';

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn() },
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
    global.fetch = vi.fn();
  });

  describe('useAddRow', () => {
    it('should add a row successfully', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
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

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/users/rows',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { name: 'Test', email: 'test@example.com' } }),
        })
      );
    });

    it('should call onSuccess callback when provided', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
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
      vi.mocked(global.fetch).mockResolvedValue({
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

  });

  describe('useUpdateRow', () => {
    it('should update a row successfully', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
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

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/users/rows',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryKey: { id: 1 },
            data: { name: 'Updated Name' },
          }),
        })
      );
    });

    it('should call onSuccess callback when provided', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
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
      vi.mocked(global.fetch).mockResolvedValue({
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

  });

  describe('useDeleteRow', () => {
    it('should delete a row successfully', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
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

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/users/rows',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryKey: { id: 1 } }),
        })
      );
    });

    it('should handle delete errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
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
      vi.mocked(global.fetch).mockResolvedValue({
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

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/user_roles/rows',
        expect.objectContaining({
          body: JSON.stringify({ primaryKey: { userId: 1, roleId: 2 } }),
        })
      );
    });
  });
});
