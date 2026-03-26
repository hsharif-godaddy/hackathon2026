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

vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({ sendMessage: mockSendMessage }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: vi.fn(() => false),
  useIsLoading: vi.fn(() => false),
}));

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: vi.fn(() => ({ data: null, isError: false })),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(() => mockShipAnalyticsLog),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(() => true),
}));

vi.mock('@/utils/domain', () => ({
  isAiroSubdomain: vi.fn((fqdn: string) => fqdn?.includes('airoapp.ai')),
  resolveSiteFqdn: vi.fn((site: any) => site?.domains?.[0]?.fqdn || null),
}));

// Import mocked modules to control their behavior
import { useDomainSearch } from '@/hooks/useDomainSearch';
import { shipAnalyticsLog } from '@/lib/logging';

describe('DomainBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockDevelopStore.app = { name: 'Manoirs Lotbinière' };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'manoirslotbiniere' })
    );
  });

  it('should normalize mixed diacritics in domain query', () => {
    mockDevelopStore.app = { name: 'Café Résumé' };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'caferesume' })
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
