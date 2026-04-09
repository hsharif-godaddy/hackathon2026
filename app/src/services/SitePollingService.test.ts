import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentFetch, appFetch, fetchSite, updateSite } = vi.hoisted(() => ({
  agentFetch: vi.fn(),
  appFetch: vi.fn(),
  fetchSite: vi.fn(),
  updateSite: vi.fn(),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch,
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch,
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: {
    getState: () => ({
      fetchSite,
      updateSite,
    }),
  },
}));

import { SiteStatus } from '@/lib/control-plane/types';
import { SitePollingService } from '@/services/SitePollingService';

describe('SitePollingService', function sitePollingServiceTests() {
  beforeEach(function resetMocks() {
    vi.restoreAllMocks();
    agentFetch.mockReset();
    appFetch.mockReset();
    fetchSite.mockReset();
    updateSite.mockReset();
  });

  it('marks registration incomplete when app metadata is missing', async function missingAppMetadata() {
    fetchSite.mockResolvedValue({
      id: 'app-123',
      status: SiteStatus.Running,
      agent_url: 'https://agent.example.com',
      backend_url: null,
      preview_url: 'https://preview.example.com',
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    agentFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn(),
    } as unknown as Response);

    const service = new SitePollingService();
    const status = await service.checkSiteStatus('app-123');

    expect(status.ready).toBe(true);
    expect(status.registrationAttempted).toBe(true);
    expect(status.registrationComplete).toBe(false);
    expect(agentFetch).toHaveBeenCalledWith(
      'https://agent.example.com/apps/app-123',
      expect.objectContaining({
        method: 'GET',
        siteId: 'app-123',
      })
    );
  });

  it('marks registration complete when app metadata exists', async function existingAppMetadata() {
    fetchSite.mockResolvedValue({
      id: 'app-123',
      status: SiteStatus.Running,
      agent_url: 'https://agent.example.com',
      backend_url: null,
      preview_url: 'https://preview.example.com',
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    agentFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ app: { id: 'app-123' } }),
    } as unknown as Response);

    const service = new SitePollingService();
    const status = await service.checkSiteStatus('app-123');

    expect(status.ready).toBe(true);
    expect(status.registrationAttempted).toBe(true);
    expect(status.registrationComplete).toBe(true);
  });

  it('marks registration incomplete when app lookup returns non-404 error', async function appLookupErrorResponse() {
    fetchSite.mockResolvedValue({
      id: 'app-123',
      status: SiteStatus.Running,
      agent_url: 'https://agent.example.com',
      backend_url: null,
      preview_url: 'https://preview.example.com',
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    agentFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn(),
    } as unknown as Response);

    const service = new SitePollingService();
    const status = await service.checkSiteStatus('app-123');

    expect(status.ready).toBe(true);
    expect(status.registrationAttempted).toBe(true);
    expect(status.registrationComplete).toBe(false);
  });

  it('marks registration incomplete when app lookup throws', async function appLookupErrorThrown() {
    fetchSite.mockResolvedValue({
      id: 'app-123',
      status: SiteStatus.Running,
      agent_url: 'https://agent.example.com',
      backend_url: null,
      preview_url: 'https://preview.example.com',
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    agentFetch.mockRejectedValue(new Error('network failed'));

    const service = new SitePollingService();
    const status = await service.checkSiteStatus('app-123');

    expect(status.ready).toBe(true);
    expect(status.registrationAttempted).toBe(true);
    expect(status.registrationComplete).toBe(false);
  });

  it('does not attempt registration when services are unhealthy', async function unhealthyServices() {
    fetchSite.mockResolvedValue({
      id: 'app-123',
      status: SiteStatus.Running,
      agent_url: 'https://agent.example.com',
      backend_url: null,
      preview_url: 'https://preview.example.com',
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);

    const service = new SitePollingService();
    const status = await service.checkSiteStatus('app-123');

    expect(status.ready).toBe(false);
    expect(status.registrationAttempted).toBe(false);
    expect(status.registrationComplete).toBe(false);
    expect(agentFetch).not.toHaveBeenCalled();
  });
});
