import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { DomainMode } from '@/lib/mgmt-airo/types';
import { useDomainValidationQuery } from './useDomainValidationQuery';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

describe('useDomainValidationQuery', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should validate domain successfully', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, mode: DomainMode.PROJECT }),
    } as Response);

    const { result } = renderHook(
      () => useDomainValidationQuery('app-123', 'my-domain', { mode: DomainMode.PROJECT }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.available).toBe(true);
  });

  it('should not fetch when appId is null', () => {
    const { result } = renderHook(
      () => useDomainValidationQuery(null, 'my-domain'),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should not fetch when domain is empty', () => {
    const { result } = renderHook(
      () => useDomainValidationQuery('app-123', ''),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should handle validation errors', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      json: async () => ({
        errors: [{
          code: 'DOMAIN_FORMAT_INVALID',
          message: 'Invalid format',
          field: 'projectPrefix',
          value: 'invalid',
        }],
      }),
    } as Response);

    const { result } = renderHook(
      () => useDomainValidationQuery('app-123', 'invalid'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.available).toBe(false);
    expect(result.current.data?.errors).toBeDefined();
  });
});
