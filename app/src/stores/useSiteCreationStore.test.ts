import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react';

const { appFetch, fetchSite, cleanup, checkSiteStatus, updateSite } = vi.hoisted(() => ({
  appFetch: vi.fn(),
  fetchSite: vi.fn(),
  cleanup: vi.fn(),
  checkSiteStatus: vi.fn(),
  updateSite: vi.fn(),
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

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}));

vi.mock('@/services/AppService', () => ({
  appService: {
    ensureAppRegistered: vi.fn(),
    updateNameAndRegister: vi.fn(),
  },
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: {
    getState: () => ({
      fetchSite,
      cleanup,
      sites: {},
      updateSite,
    }),
  },
}));

vi.mock('@/services/SitePollingService', () => ({
  sitePollingService: {
    checkSiteStatus,
  },
}));

import { SiteStatus } from '@/lib/control-plane/types';
import { useSiteCreationStore } from './useSiteCreationStore';

describe('useSiteCreationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appFetch.mockReset();
    fetchSite.mockReset();
    cleanup.mockReset();
    checkSiteStatus.mockReset();
    updateSite.mockReset();

    act(() => {
      useSiteCreationStore.getState().reset();
    });
  });

  afterEach(() => {
    act(() => {
      useSiteCreationStore.getState().cleanup();
    });
    vi.useRealTimers();
  });

  it('does not trigger a second deploy for legacy jobs already creating', async () => {
    fetchSite.mockResolvedValue({
      id: 'dev-job-site-456',
      status: SiteStatus.Creating,
      account_id: 'account-123',
      created_at: '2026-03-12T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
    });
    checkSiteStatus.mockResolvedValue({
      siteId: 'dev-job-site-456',
      status: SiteStatus.Creating,
      agent_url: null,
      backend_url: null,
      preview_url: null,
      ready: false,
      registrationComplete: false,
      registrationAttempted: false,
      message: 'Agent URL not available yet',
    });

    await act(async () => {
      await useSiteCreationStore.getState().initializeSite('dev-job-site-456');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(appFetch).not.toHaveBeenCalledWith('/api/sites/dev-job-site-456/deploy', expect.anything());
    expect(useSiteCreationStore.getState().phase).toBe('polling');

  });
});
