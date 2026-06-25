/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useCaaRemediation } from './useCaaRemediation';
import { DomainMutationError } from './useModifyDomains';

const setDomainJobInProgress = vi.fn();

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: () => ({
      setDomainJobInProgress,
    }),
  },
}));

describe('useCaaRemediation', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function remediateAndGetError(responseBody: Record<string, unknown>, status = 400) {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status,
      json: async () => responseBody,
    } as unknown as Response);

    const { result } = renderHook(() => useCaaRemediation(), { wrapper: createWrapper() });

    result.current.mutate({
      siteId: 'app-123',
      payload: { domainsToCreate: [{ fqdn: 'example.com' }], consent: true },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    return result.current.error as DomainMutationError;
  }

  it('seeds the in-progress domain job on success', async function success() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        statusJobId: 'job-123',
        status: 'running',
        message: 'CAA remediation workflow initiated',
      }),
    } as Response);

    const { result } = renderHook(() => useCaaRemediation(), { wrapper: createWrapper() });

    result.current.mutate({
      siteId: 'app-123',
      payload: { domainsToCreate: [{ fqdn: 'New.Example.COM', primary: false }], consent: true },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.statusJobId).toBe('job-123');
    expect(setDomainJobInProgress).toHaveBeenCalledWith('app-123', {
      fqdn: 'new.example.com',
      startedAt: expect.any(Number),
      jobStatus: 'running',
    });
  });

  it('throws DomainMutationError and extracts nestedCode from details.error.code', async function nestedError() {
    const error = await remediateAndGetError({
      details: { error: { code: 'CLOUDFLARE_CAA_INTERNAL_MISMATCH', message: 'CAA mismatch' } },
    });

    expect(error).toBeInstanceOf(DomainMutationError);
    expect(error.details.nestedCode).toBe('CLOUDFLARE_CAA_INTERNAL_MISMATCH');
    expect(error.details.message).toBe('CAA mismatch');
    expect(setDomainJobInProgress).not.toHaveBeenCalled();
  });

  it('falls back to the top-level code when there is no nested details.error', async function topLevelCode() {
    const error = await remediateAndGetError({
      code: 'CAA_REMEDIATION_FAILED',
      error: 'Failed to run CAA remediation',
    });

    expect(error.details.nestedCode).toBe('CAA_REMEDIATION_FAILED');
    expect(error.details.message).toBe('Failed to run CAA remediation');
  });

  it('uses a plain-string details value as the message', async function stringDetails() {
    const error = await remediateAndGetError({ details: 'Plain text error' });

    expect(error.details.message).toBe('Plain text error');
    expect(error.details.nestedCode).toBeUndefined();
  });

  it('falls back to a status-coded message when the body is unparseable', async function unparseable() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not JSON');
      },
    } as unknown as Response);

    const { result } = renderHook(() => useCaaRemediation(), { wrapper: createWrapper() });

    result.current.mutate({
      siteId: 'app-123',
      payload: { domainsToCreate: [{ fqdn: 'example.com' }], consent: true },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect((result.current.error as DomainMutationError).details.message).toBe(
      'Failed to run CAA remediation: 500',
    );
  });
});
