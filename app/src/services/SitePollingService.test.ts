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

  it(
    'strips ?airoShareToken from preview_url when building /airo/health URL',
    async function tokenizedPreviewUrl() {
      // The BFF now injects `?airoShareToken=...` into preview_url so that
      // top-level Visit Preview navigation works in 3PC-blocking browsers.
      // String-concatenating /airo/health onto a tokenized URL would
      // produce `https://preview/?airoShareToken=abc/airo/health` — the
      // path becomes part of the query value and the health probe hits
      // the wrong endpoint. URL() resolves the absolute path against the
      // origin and discards the query, which is the contract we need to
      // pin so a future regression to template-string concat fails fast.
      fetchSite.mockResolvedValue({
        id: 'app-123',
        status: SiteStatus.Running,
        agent_url: 'https://agent.example.com',
        backend_url: null,
        preview_url: 'https://preview.example.com/?airoShareToken=abc123',
      });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);
      agentFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ app: { id: 'app-123' } }),
      } as unknown as Response);

      const service = new SitePollingService();
      await service.checkSiteStatus('app-123');

      // First fetch is the agent /health (untouched); second fetch is the
      // frontend /airo/health probe. Pin the URL it received.
      const frontendCall = fetchSpy.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('/airo/health'),
      );
      expect(frontendCall).toBeDefined();
      const probedUrl = frontendCall![0] as string;
      expect(probedUrl).toBe('https://preview.example.com/airo/health');
      // No token survives into the health-check URL — the query was
      // dropped by URL() resolution.
      expect(probedUrl).not.toContain('airoShareToken');
    },
  );

  it(
    'returns false (no throw) when preview_url is malformed',
    async function malformedPreviewUrl() {
      // Defensive guard: if the control plane ever returns a preview_url
      // that doesn't parse (no scheme, garbage characters), the URL()
      // constructor throws a TypeError. Without the try/catch in
      // probeFrontendHealth, that would escape checkSiteStatus as an
      // unhandled rejection. Pin the contract so the helper stays safe.
      fetchSite.mockResolvedValue({
        id: 'app-123',
        status: SiteStatus.Running,
        agent_url: 'https://agent.example.com',
        backend_url: null,
        preview_url: 'not-a-valid-url', // no scheme
      });

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true } as Response);

      const service = new SitePollingService();
      const status = await service.checkSiteStatus('app-123');

      // ready=false because frontendHealthy resolved to false (URL parse
      // failed → guard returns false), not because checkSiteStatus threw.
      expect(status.ready).toBe(false);
      expect(status.registrationAttempted).toBe(false);
    },
  );
});
