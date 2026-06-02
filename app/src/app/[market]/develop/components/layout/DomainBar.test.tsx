/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainBar from './DomainBar';

const mockDevelopStore = {
  site: {
    name: 'Test App',
    domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
  },
  app: { name: 'Test App' },
  deploymentInProgressId: null,
  setActiveChatTab: vi.fn(),
};

const mockSendMessage = vi.fn();
const mockShipAnalyticsLog = vi.fn();
const mockGetSite = vi.fn(function (_id: string) { return null; });

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(function () { return 'app-123'; }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn(function (selector: any) { return selector({
      getSite: () => null,
    }); },
  ),
}));

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({ sendMessage: mockSendMessage }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: vi.fn(function () { return false; }),
  useIsLoading: vi.fn(function () { return false; }),
}));

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: vi.fn(function () { return { data: null, isError: false }; }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(function () { return mockShipAnalyticsLog; }),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(function () { return true; }),
}));

vi.mock('@/utils/domain', () => ({
  isAiroSubdomain: vi.fn(function (fqdn: string) { return fqdn?.includes('airoapp.ai'); }),
  resolveSiteFqdn: vi.fn(function (site: any) { return site?.domains?.[0]?.fqdn || null; }),
}));

// Import mocked modules to control their behavior
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useDomainSearch } from '@/hooks/useDomainSearch';
import { shipAnalyticsLog } from '@/lib/logging';
import { useSiteStore } from '@/stores/useSiteStore';

describe('DomainBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSite.mockReset();
    mockGetSite.mockImplementation(function () { return null; });
    vi.mocked(useAppIdFromParams).mockReturnValue('app-123');
    vi.mocked(useSiteStore).mockImplementation(function (selector: any) { return selector({
        getSite: mockGetSite,
      }); },
    );
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };
    mockDevelopStore.app = { name: 'Test App' };
    sessionStorage.clear();
  });

  it('should not render for custom domains', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'custom.example.com', domainType: 'custom' }],
    };

    const { container } = renderWithProviders(<DomainBar />);
    expect(container.firstChild).toBeNull();
  });

  it('should not render when no domain suggestion available', () => {
    vi.mocked(useDomainSearch).mockReturnValue({
      data: null,
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);
    expect(container.firstChild).toBeNull();
  });

  it('should render when domain suggestion is available', () => {
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    // Should render the purple suggestion bar
    const bar = container.querySelector('.bg-ai');
    expect(bar).toBeInTheDocument();
  });

  it('should normalize diacritics to ASCII in domain query', () => {
    mockDevelopStore.site = {
      name: 'Manoirs Lotbinière',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'manoirslotbiniere' })
    );
  });

  it('should normalize mixed diacritics in domain query', () => {
    mockDevelopStore.site = {
      name: 'Café Résumé',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'caferesume' })
    );
  });

  it('should use site name when app name is missing', () => {
    mockDevelopStore.app = {};
    mockDevelopStore.site = {
      name: 'Site Only Brand',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'siteonlybrand' })
    );
  });

  it('should use site name when app name is an empty string', () => {
    mockDevelopStore.app = { name: '' };
    mockDevelopStore.site = {
      name: 'Empty App Site Name',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'emptyappsitename' })
    );
  });

  it('should prefer site name over app name when both exist', () => {
    mockDevelopStore.app = { name: 'App Preferred' };
    mockDevelopStore.site = {
      name: 'Site Other',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'siteother' })
    );
  });

  it('should prefer cached site when getSite returns published airo subdomain and develop store differs', () => {
    mockDevelopStore.app = {};
    mockDevelopStore.site = {
      name: 'Stale Unpublished',
      domains: [{ fqdn: 'custom-stale.example.com', domainType: 'custom' }],
    };
    const cachedPublished = {
      name: 'Cached Published',
      variants: ['publish'],
      domains: [{ fqdn: 'cached.airoapp.ai', domainType: 'prefix' }],
    };
    vi.mocked(useSiteStore).mockImplementation(function (selector: any) { return selector({
        getSite: (id: string) => (id === 'app-123' ? cachedPublished : null),
      }); },
    );
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'cachedbrand.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    expect(container.querySelector('.bg-ai')).toBeInTheDocument();
    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        query: 'cachedpublished',
      }),
    );
  });

  it('should not render when cached site is custom domain even if develop site is airo subdomain', () => {
    mockDevelopStore.site = {
      name: 'Develop Airo',
      domains: [{ fqdn: 'develop.airoapp.ai', domainType: 'prefix' }],
    };
    const cachedCustom = {
      name: 'Cached Custom',
      domains: [{ fqdn: 'owner-custom.example.com', domainType: 'custom' }],
    };
    vi.mocked(useSiteStore).mockImplementation(function (selector: any) { return selector({
        getSite: (id: string) => (id === 'app-123' ? cachedCustom : null),
      }); },
    );
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'ignored.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    expect(container.firstChild).toBeNull();
  });

  it('should skip getSite and use develop site when appId is absent', () => {
    vi.mocked(useAppIdFromParams).mockReturnValue(undefined);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'fallback.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    expect(mockGetSite).not.toHaveBeenCalled();
    expect(container.querySelector('.bg-ai')).toBeInTheDocument();
    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        query: 'testapp',
      }),
    );
  });

  describe('dismiss functionality', () => {
    beforeEach(() => {
      vi.mocked(useDomainSearch).mockReturnValue({
        data: {
          domains: [{ fqdn: 'testapp.com', available: true }],
        },
        isError: false,
      } as any);
    });

    it('should render dismiss button when domain suggestion is available', () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="Dismiss domain suggestion"]');
      expect(dismissButton).toBeInTheDocument();
    });

    it('should hide DomainBar when dismiss button is clicked', async () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="Dismiss domain suggestion"]');
      expect(dismissButton).toBeInTheDocument();

      fireEvent.click(dismissButton!);

      await waitFor(() => {
        const bar = container.querySelector('.bg-ai');
        expect(bar).not.toBeInTheDocument();
      });
    });

    it('should store dismissal state in sessionStorage', () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="Dismiss domain suggestion"]');
      fireEvent.click(dismissButton!);

      expect(sessionStorage.getItem('domainbar_dismissed')).toBe('true');
    });

    it('should log analytics event when dismissed', () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="Dismiss domain suggestion"]');
      fireEvent.click(dismissButton!);

      expect(shipAnalyticsLog).toHaveBeenCalledWith('domain.suggestion.dismissed', {
        appId: 'app-123',
        suggestedDomain: 'testapp.com',
      });
    });

    it('should not render when previously dismissed in session', () => {
      sessionStorage.setItem('domainbar_dismissed', 'true');

      const { container } = renderWithProviders(<DomainBar />);

      const bar = container.querySelector('.bg-ai');
      expect(bar).not.toBeInTheDocument();
    });

    it('should render again after sessionStorage is cleared', () => {
      sessionStorage.setItem('domainbar_dismissed', 'true');

      let result = renderWithProviders(<DomainBar />);
      expect(result.container.querySelector('.bg-ai')).not.toBeInTheDocument();

      // Clear and re-render
      sessionStorage.clear();
      result.unmount();

      result = renderWithProviders(<DomainBar />);
      expect(result.container.querySelector('.bg-ai')).toBeInTheDocument();
    });
  });

});
