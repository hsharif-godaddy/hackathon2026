import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { DomainMutationError, useModifyDomains } from './useModifyDomains';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useModifyDomains', () => {
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

  it('should modify domains successfully', async function success() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        statusJobId: 'job-123',
        status: 'pending',
        message: 'Domain modification started',
      }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'new.example.com', primary: false }],
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.statusJobId).toBe('job-123');
  });

  it('should throw DomainMutationError on non-ok response', async function throwsMutationError() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid domain' }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'invalid', primary: false }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(DomainMutationError);
  });

  it('should populate details.message from error response', async function populatesMessage() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ details: { message: 'Domain already in use' } }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'taken.example.com' }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as DomainMutationError;
    expect(error.details.message).toBe('Domain already in use');
  });

  it('should key domainSpecificError by lowercased trimmed fqdn', async function keysByFqdn() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Conflict' }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [
          { fqdn: '  My-Domain.Example.COM  ' },
          { fqdn: 'Other.IO ' },
        ],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as DomainMutationError;
    expect(error.details.domainSpecificError).toBeDefined();
    expect(error.details.domainSpecificError!['my-domain.example.com']).toBe('Conflict');
    expect(error.details.domainSpecificError!['other.io']).toBe('Conflict');
  });

  it('should key domainSpecificError by fqdn for delete operations', async function deleteKeyed() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal failure' }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToDelete: [{ fqdn: 'old.example.com' }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as DomainMutationError;
    expect(error.details.domainSpecificError).toBeDefined();
    expect(error.details.domainSpecificError!['old.example.com']).toBe('Internal failure');
    expect(error.details.message).toBe('Internal failure');
  });

  it('should fall back to status code message when response body is unparseable', async function unparseable() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not JSON'); },
    } as unknown as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'example.com' }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as DomainMutationError;
    expect(error.details.message).toBe('Failed to modify domains: 502');
  });

  it('should use string details when details is a plain string', async function stringDetails() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ details: 'Plain text error' }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'example.com' }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as DomainMutationError;
    expect(error.details.message).toBe('Plain text error');
  });

  it('should extract message and code from AiroApiErrorV2 details', async function airoApiErrorV2Details() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        details: {
          error: {
            code: 'DOMAIN_NOT_UNIQUE',
            message: 'Domain already in use',
          },
        },
      }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'taken.example.com' }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as DomainMutationError;
    expect(error.details.message).toBe('Domain already in use');
  });
});
