import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useProjects } from './useProjects';

// Mock appFetch
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

import { appFetch } from '@/lib/gasket-config';

describe('useProjects', function hooks() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('#useProjects', function main() {
    it('returns projects when API succeeds', async function success() {
      const mockProjects = [
        {
          node: {
            group: 'Airo',
            status: 'ACTIVE',
            billing: { id: 'billing-123', plan: 'airoPlus' },
          },
        },
        {
          node: {
            group: 'Other',
            status: 'ACTIVE',
            billing: { id: 'billing-456', plan: 'standard' },
          },
        },
      ];

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { projects: { edges: mockProjects } } }),
      } as Response);

      const { result } = renderHookWithProviders(() => useProjects());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toHaveLength(2);
      expect(result.current.data?.[0].node.group).toBe('Airo');
    });

    it('returns empty array when API returns not ok', async function notOk() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const { result } = renderHookWithProviders(() => useProjects());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual([]);
    });

    it('returns empty array when edges is missing', async function missingEdges() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { projects: {} } }),
      } as Response);

      const { result } = renderHookWithProviders(() => useProjects());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual([]);
    });

    it('respects enabled option', async function enabled() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { projects: { edges: [] } } }),
      } as Response);

      const { result } = renderHookWithProviders(() => useProjects({ enabled: false }));

      // Should not fetch when disabled
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('fetches when enabled is true', async function enabledTrue() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { projects: { edges: [] } } }),
      } as Response);

      const { result } = renderHookWithProviders(() => useProjects({ enabled: true }));

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/projects', { credentials: 'include' });
      });
    });

    it('fetches by default when enabled is not specified', async function defaultEnabled() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { projects: { edges: [] } } }),
      } as Response);

      renderHookWithProviders(() => useProjects());

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });
    });

    it('passes boolean to enabled when options is undefined (regression test)', async function booleanEnabled() {
      // This test verifies the fix for React Query expecting a boolean for enabled
      // Previously, options?.enabled would be undefined when options wasn't passed,
      // causing React Query to throw: "Expected enabled to be a boolean"
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { projects: { edges: [] } } }),
      } as Response);

      // Call without any options - should default enabled to true (boolean)
      const { result } = renderHookWithProviders(() => useProjects());

      // Verify the query runs (enabled was truthy boolean, not undefined)
      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      // Verify no errors were thrown
      expect(result.current.error).toBeNull();
    });
  });
});
