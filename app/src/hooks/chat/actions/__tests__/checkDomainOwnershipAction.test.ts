/**
 * Tests for checkDomainOwnershipAction
 *
 * Read-only pre-attach ownership check used by the custom-domain skill to detect
 * a domain owned by a different GoDaddy account (AIROBUILD-2952). Throws on any
 * failure so the agent-side caller can fail open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as gasketConfig from '@/lib/gasket-config';
import { checkDomainOwnershipAction } from '../checkDomainOwnershipAction';
import type { ClientActionContext } from '../types';

const mockContext = {} as ClientActionContext;

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('checkDomainOwnershipAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return ownership fields on a successful response', async () => {
    const mockFetch = vi.mocked(gasketConfig.appFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ isGdDomain: true, isGDDomainOwner: false, isGoDaddyDns: true, extra: 'ignored' }),
    } as any);

    await expect(
      checkDomainOwnershipAction({ appId: 'test-app', domainName: 'foreign.com' }, mockContext)
    ).resolves.toEqual({ isGdDomain: true, isGDDomainOwner: false });
  });

  it('should call the domain-dns-ownership route with an encoded fqdns query', async () => {
    const mockFetch = vi.mocked(gasketConfig.appFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ isGdDomain: false, isGDDomainOwner: false, isGoDaddyDns: false }),
    } as any);

    await checkDomainOwnershipAction({ appId: 'app-123', domainName: 'sub.example.com' }, mockContext);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sites/app-123/domain-dns-ownership?fqdns=sub.example.com'
    );
  });

  it('should throw when the response is not ok', async () => {
    const mockFetch = vi.mocked(gasketConfig.appFetch);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'mgmt-airo unavailable' }),
    } as any);

    await expect(
      checkDomainOwnershipAction({ appId: 'test-app', domainName: 'example.com' }, mockContext)
    ).rejects.toThrow('mgmt-airo unavailable');
  });

  it('should throw when the response is not ok and has no error body', async () => {
    const mockFetch = vi.mocked(gasketConfig.appFetch);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('no body');
      },
    } as any);

    await expect(
      checkDomainOwnershipAction({ appId: 'test-app', domainName: 'example.com' }, mockContext)
    ).rejects.toThrow('Failed to check domain ownership: 404');
  });

  it('should reject missing appId', async () => {
    await expect(
      checkDomainOwnershipAction({ appId: '', domainName: 'example.com' }, mockContext)
    ).rejects.toThrow('appId is required');
  });

  it('should reject non-string appId', async () => {
    await expect(
      checkDomainOwnershipAction({ appId: 123 as any, domainName: 'example.com' }, mockContext)
    ).rejects.toThrow('appId is required');
  });

  it('should reject missing domainName', async () => {
    await expect(
      checkDomainOwnershipAction({ appId: 'test-app', domainName: '' }, mockContext)
    ).rejects.toThrow('domainName is required');
  });

  it('should reject an invalid domain name format', async () => {
    await expect(
      checkDomainOwnershipAction({ appId: 'test-app', domainName: 'example' }, mockContext)
    ).rejects.toThrow('must have at least two labels');
  });

  it('should not call the API when validation fails', async () => {
    const mockFetch = vi.mocked(gasketConfig.appFetch);

    await expect(
      checkDomainOwnershipAction({ appId: 'test-app', domainName: 'bad domain!.com' }, mockContext)
    ).rejects.toThrow();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
