/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { DomainStatus, DomainType, type SiteDomain } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { type Site, useSiteStore } from '@/stores/useSiteStore';
import { DomainMutationError, useModifyDomains } from './useModifyDomains';

const setDomainJobInProgress = vi.fn();

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
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
    useSiteStore.setState({ sites: {}, loading: {}, error: null, _pendingRequests: {} });
  });

  const makeDomain = (overrides: Partial<SiteDomain>): SiteDomain => ({
    fqdn: 'custom.example.com',
    isPrimary: false,
    domainType: DomainType.CUSTOM,
    prefix: '',
    status: DomainStatus.ACTIVE,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  const seedStore = (domains: SiteDomain[]): void => {
    useSiteStore.setState({
      sites: {
        'app-123': { id: 'app-123', status: 'active', account_id: 'acc-1', domains } as unknown as Site,
      },
      loading: {},
      error: null,
      _pendingRequests: {},
    });
  };

  const mockDeleteSuccess = (): void => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ statusJobId: 'job-del', status: 'pending', message: 'Delete started' }),
    } as Response);
  };

  async function mutateAndGetError({
    responseBody,
    payload = { domainsToCreate: [{ fqdn: 'taken.example.com' }] },
    status = 409,
  }: {
    responseBody: Record<string, unknown>;
    payload?: Record<string, unknown>;
    status?: number;
  }) {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status,
      json: async () => responseBody,
    } as unknown as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload,
    } as any);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    return result.current.error as DomainMutationError;
  }

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
    expect(setDomainJobInProgress).toHaveBeenCalledWith('app-123', {
      fqdn: 'new.example.com',
      startedAt: expect.any(Number),
      jobStatus: 'pending',
    });
  });

  it('should not track domain job for delete-only success', async function deleteNoJobTrack() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        statusJobId: 'job-del',
        status: 'pending',
        message: 'Delete started',
      }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToDelete: [{ fqdn: 'gone.example.com' }],
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(setDomainJobInProgress).not.toHaveBeenCalled();
  });

  it('should remove a deleted fqdn from useSiteStore and preserve prefix domains', async function deleteSyncsStore() {
    seedStore([
      makeDomain({ fqdn: 'custom.example.com', isPrimary: true, domainType: DomainType.CUSTOM }),
      makeDomain({ fqdn: 'myapp.airoapp.ai', domainType: DomainType.PREFIX, prefix: 'myapp' }),
    ]);
    mockDeleteSuccess();

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: { domainsToDelete: [{ fqdn: 'custom.example.com' }] },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const storedDomains = useSiteStore.getState().sites['app-123']?.domains;
    expect(storedDomains).toHaveLength(1);
    expect(storedDomains?.find(d => d.fqdn === 'custom.example.com')).toBeUndefined();
    expect(storedDomains?.find(d => d.domainType === DomainType.PREFIX)?.fqdn).toBe('myapp.airoapp.ai');
  });

  it('should remove a domain from useSiteStore case-insensitively', async function deleteSyncsStoreCaseInsensitive() {
    seedStore([makeDomain({ fqdn: 'Custom.Example.com' })]);
    mockDeleteSuccess();

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: { domainsToDelete: [{ fqdn: 'CUSTOM.EXAMPLE.COM' }] },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(useSiteStore.getState().sites['app-123']?.domains).toHaveLength(0);
  });

  it('should not throw when deleting and the site is not cached in useSiteStore', async function deleteNoCachedSite() {
    mockDeleteSuccess();

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: { domainsToDelete: [{ fqdn: 'custom.example.com' }] },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(useSiteStore.getState().sites['app-123']).toBeUndefined();
  });

  it('should leave useSiteStore domains unchanged for a connect-only mutation', async function connectLeavesStore() {
    seedStore([makeDomain({ fqdn: 'existing.example.com', isPrimary: true })]);
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ statusJobId: 'job-con', status: 'pending', message: 'Connect started' }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: { domainsToCreate: [{ fqdn: 'new.example.com', primary: false }] },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const storedDomains = useSiteStore.getState().sites['app-123']?.domains;
    expect(storedDomains).toHaveLength(1);
    expect(storedDomains?.[0]?.fqdn).toBe('existing.example.com');
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

  it('should extract nestedCode when details.error.code is present', async function extractsNestedCode() {
    const error = await mutateAndGetError({
      responseBody: {
        details: {
          error: {
            code: 'DOMAIN_IN_USE_BY_OWN_APP',
            message: 'Domain already in use',
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_IN_USE_BY_OWN_APP');
  });

  it('should extract conflictDetails when all required fields are present', async function extractsConflictDetails() {
    const error = await mutateAndGetError({
      responseBody: {
        details: {
          error: {
            code: 'DOMAIN_IN_USE_BY_OWN_APP',
            message: 'Domain already in use',
            details: {
              existingAppId: 'app-1',
              existingSystemId: 'sys-1',
              existingOwnerType: 'airoSubscriptionId',
              existingOwnerId: 'sub-1',
              existingAppName: 'My Existing App',
              domain: 'taken.example.com',
            },
          },
        },
      },
    });

    expect(error.details.conflictDetails).toEqual({
      existingAppId: 'app-1',
      existingSystemId: 'sys-1',
      existingOwnerType: 'airoSubscriptionId',
      existingOwnerId: 'sub-1',
      existingAppName: 'My Existing App',
      domain: 'taken.example.com',
    });
  });

  it('should extract MWP conflictDetails from nested details.error.code shape', async function extractsNestedMwpConflictDetails() {
    const error = await mutateAndGetError({
      responseBody: {
        details: {
          error: {
            code: 'DOMAIN_ALREADY_IN_USE',
            message: 'Domain is already in use',
            details: {
              value: 'example.com',
              mwpTransfer: {
                transferable: true,
                v2AppId: '1129971',
                siteName: 'My WP Site',
              },
            },
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_ALREADY_IN_USE');
    expect(error.details.conflictDetails).toEqual({
      existingAppId: '1129971',
      existingOwnerType: 'mwpV2AppId',
      existingOwnerId: '1129971',
      existingAppName: 'My WP Site',
      domain: 'example.com',
    });
  });

  it('should extract nestedCode and conflictDetails from flat details shape', async function extractsFlatConflictDetails() {
    const error = await mutateAndGetError({
      responseBody: {
        details: {
          code: 'DOMAIN_IN_USE_BY_OWN_APP',
          message: 'Domain already in use',
          details: {
            existingAppId: 'app-1',
            existingSystemId: 'sys-1',
            existingOwnerType: 'airoSubscriptionId',
            existingOwnerId: 'sub-1',
            existingAppName: 'My Existing App',
            domain: 'taken.example.com',
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_IN_USE_BY_OWN_APP');
    expect(error.details.conflictDetails).toEqual({
      existingAppId: 'app-1',
      existingSystemId: 'sys-1',
      existingOwnerType: 'airoSubscriptionId',
      existingOwnerId: 'sub-1',
      existingAppName: 'My Existing App',
      domain: 'taken.example.com',
    });
  });

  it('should extract MWP conflictDetails from flat airo-go response shape', async function extractsFlatAiroGoMwpConflictDetails() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_ALREADY_IN_USE',
        details: {
          value: 'example.com',
          mwpTransfer: {
            transferable: true,
            v2AppId: '123',
            siteName: 'My Site',
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_ALREADY_IN_USE');
    expect(error.details.conflictDetails).toEqual({
      existingAppId: '123',
      existingOwnerType: 'mwpV2AppId',
      existingOwnerId: '123',
      existingAppName: 'My Site',
      domain: 'example.com',
    });
  });

  it('should extract Airo conflictDetails from flat airo-go response shape', async function extractsFlatAiroGoAiroConflictDetails() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_IN_USE_BY_OWN_APP',
        details: {
          existingAppId: 'app1',
          existingSystemId: 'sys1',
          existingOwnerType: 'airoSubscriptionId',
          existingOwnerId: 'sub1',
          existingAppName: 'Test App',
          domain: 'test.com',
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_IN_USE_BY_OWN_APP');
    expect(error.details.conflictDetails).toEqual({
      existingAppId: 'app1',
      existingSystemId: 'sys1',
      existingOwnerType: 'airoSubscriptionId',
      existingOwnerId: 'sub1',
      existingAppName: 'Test App',
      domain: 'test.com',
    });
  });

  it('should extract MWP conflictDetails from flat DOMAIN_ALREADY_IN_USE shape when transferable', async function extractsMwpConflictDetails() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_MODIFY_FAILED',
        details: {
          code: 'DOMAIN_ALREADY_IN_USE',
          message: 'Domain is already configured for MWP',
          details: {
            value: 'example.com',
            mwpTransfer: {
              transferable: true,
              siteName: 'A WordPress Site',
              v2AppId: '1129971',
              product: 'Managed Hosting for WordPress',
            },
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_ALREADY_IN_USE');
    expect(error.details.conflictDetails).toEqual({
      existingAppId: '1129971',
      existingOwnerType: 'mwpV2AppId',
      existingOwnerId: '1129971',
      existingAppName: 'A WordPress Site',
      domain: 'example.com',
    });
  });

  it('should not set conflictDetails for non-transferable MWP domain conflict', async function skipsMwpConflictDetailsWhenNotTransferable() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_MODIFY_FAILED',
        details: {
          code: 'DOMAIN_ALREADY_IN_USE',
          message: 'Domain is already configured for MWP',
          details: {
            value: 'example.com',
            mwpTransfer: {
              transferable: false,
              siteName: 'A WordPress Site',
              v2AppId: '1129971',
            },
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_ALREADY_IN_USE');
    expect(error.details.conflictDetails).toBeUndefined();
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('should not set conflictDetails for DOMAIN_ALREADY_IN_USE without mwpTransfer', async function skipsMwpConflictDetailsWhenMissingPayload() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_MODIFY_FAILED',
        details: {
          code: 'DOMAIN_ALREADY_IN_USE',
          message: 'Domain is already in use by another product',
          details: {
            value: 'example.com',
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_ALREADY_IN_USE');
    expect(error.details.conflictDetails).toBeUndefined();
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('should extract conflicting product from nested DOMAIN_ALREADY_IN_USE details', async function extractsConflictingProduct() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_MODIFY_FAILED',
        error: 'Failed to modify domains',
        details: {
          code: 'DOMAIN_ALREADY_IN_USE',
          details: {
            action: 'SELF_SERVICE',
            allErrors: [
              {
                action: 'SELF_SERVICE',
                canRetry: true,
                code: 'DOMAIN_ALREADY_IN_USE',
                conflictingProduct: 'Airo Builder',
                fqdn: 'dbrace002.muaoto.plus',
                message: "Domain 'dbrace002.muaoto.plus' is already configured for Airo Builder. Please disconnect it first.",
                planId: 'AIROWAFCDNBasic',
              },
            ],
            canRetry: true,
            conflictingProduct: 'Airo Builder',
            field: 'fqdn',
            planId: 'AIROWAFCDNBasic',
            value: 'dbrace002.muaoto.plus',
          },
          message: "Domain 'dbrace002.muaoto.plus' is already configured for Airo Builder. Please disconnect it first.",
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_ALREADY_IN_USE');
    expect((error.details as { conflictingProduct?: string }).conflictingProduct).toBe('Airo Builder');
  });

  it('should log parse failure when transferable MWP conflict is malformed', async function logsTransferableMwpParseFailure() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_MODIFY_FAILED',
        details: {
          code: 'DOMAIN_ALREADY_IN_USE',
          message: 'Domain is already configured for MWP',
          details: {
            value: 'example.com',
            mwpTransfer: {
              transferable: true,
              siteName: 'A WordPress Site',
            },
          },
        },
      },
    });

    expect(error.details.nestedCode).toBe('DOMAIN_ALREADY_IN_USE');
    expect(error.details.conflictDetails).toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'domain-operations.modify.mwp-conflict-parse-failed',
      expect.objectContaining({
        appId: 'app-123',
        effectiveNestedCode: 'DOMAIN_ALREADY_IN_USE',
      })
    );
  });

  it('should keep conflictDetails undefined when required fields are missing', async function missingConflictFields() {
    const error = await mutateAndGetError({
      responseBody: {
        details: {
          error: {
            code: 'DOMAIN_IN_USE_BY_OWN_APP',
            message: 'Domain already in use',
            details: {
              existingAppId: 'app-1',
              existingSystemId: 'sys-1',
              existingOwnerType: 'airoSubscriptionId',
              existingAppName: 'Missing ownerId and domain',
            },
          },
        },
      },
    });

    expect(error.details.conflictDetails).toBeUndefined();
  });

  it('should keep conflictDetails undefined when required field types are wrong', async function wrongConflictFieldTypes() {
    const error = await mutateAndGetError({
      responseBody: {
        details: {
          error: {
            code: 'DOMAIN_IN_USE_BY_OWN_APP',
            message: 'Domain already in use',
            details: {
              existingAppId: 'app-1',
              existingSystemId: 123,
              existingOwnerType: 'airoSubscriptionId',
              existingOwnerId: 'sub-1',
              domain: 'taken.example.com',
            },
          },
        },
      },
    });

    expect(error.details.conflictDetails).toBeUndefined();
  });

  it('should keep nested fields undefined when details is not an object', async function nonObjectDetails() {
    const error = await mutateAndGetError({
      responseBody: {
        details: 'simple text details',
      },
      status: 400,
    });

    expect(error.details.nestedCode).toBeUndefined();
    expect(error.details.conflictDetails).toBeUndefined();
  });

  it('should keep nested fields undefined when details.error is not an object', async function nonObjectNestedError() {
    const error = await mutateAndGetError({
      responseBody: {
        details: {
          error: 'not-an-object',
        },
      },
    });

    expect(error.details.nestedCode).toBeUndefined();
    expect(error.details.conflictDetails).toBeUndefined();
  });

  it('should include existingAppName when present and omit when absent', async function optionalExistingAppName() {
    const withNameError = await mutateAndGetError({
      responseBody: {
        details: {
          error: {
            code: 'DOMAIN_IN_USE_BY_OWN_APP',
            message: 'Domain already in use',
            details: {
              existingAppId: 'app-1',
              existingSystemId: 'sys-1',
              existingOwnerType: 'airoSubscriptionId',
              existingOwnerId: 'sub-1',
              existingAppName: 'Named app',
              domain: 'taken.example.com',
            },
          },
        },
      },
    });

    expect(withNameError.details.conflictDetails?.existingAppName).toBe('Named app');

    const withoutNameError = await mutateAndGetError({
      responseBody: {
        details: {
          error: {
            code: 'DOMAIN_IN_USE_BY_OWN_APP',
            message: 'Domain already in use',
            details: {
              existingAppId: 'app-1',
              existingSystemId: 'sys-1',
              existingOwnerType: 'airoSubscriptionId',
              existingOwnerId: 'sub-1',
              domain: 'taken.example.com',
            },
          },
        },
      },
    });

    expect(withoutNameError.details.conflictDetails).toBeDefined();
    expect(withoutNameError.details.conflictDetails).not.toHaveProperty('existingAppName');
  });

  it('should preserve code, message, and domainSpecificError behavior with nested parsing', async function preservesExistingErrorBehavior() {
    const error = await mutateAndGetError({
      responseBody: {
        code: 'DOMAIN_MODIFY_FAILED',
        error: 'Failed to modify domains',
        details: {
          error: {
            code: 'DOMAIN_IN_USE_BY_OWN_APP',
            message: 'Domain already in use',
            details: {
              existingAppId: 'app-1',
              existingSystemId: 'sys-1',
              existingOwnerType: 'airoSubscriptionId',
              existingOwnerId: 'sub-1',
              domain: 'taken.example.com',
            },
          },
        },
      },
      payload: {
        domainsToCreate: [{ fqdn: ' Taken.Example.com ' }],
      },
    });

    expect(error.details.code).toBe('DOMAIN_MODIFY_FAILED');
    expect(error.details.message).toBe('Domain already in use');
    expect(error.details.domainSpecificError).toEqual({
      'taken.example.com': 'Domain already in use',
    });
    expect(error.details.nestedCode).toBe('DOMAIN_IN_USE_BY_OWN_APP');
  });
});
