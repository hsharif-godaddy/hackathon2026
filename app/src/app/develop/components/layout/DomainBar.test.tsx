import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainBar from './DomainBar';
import { SettingsSection } from '../types';

const mockDevelopStore = {
  site: {
    name: 'Test App',
    domains: [{ fqdn: 'testapp.com', domainType: 'custom' }],
  },
  app: { name: 'Test App' },
  deploymentInProgressId: null,
  setActiveChatTab: vi.fn(),
  getPublishState: vi.fn(() => ({
    deploymentInProgressId: null,
    isPollingActive: false,
  })),
};

const mockSendMessage = vi.fn();
const mockSetActiveSettingsSection = vi.fn();

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
  useStreamingState: vi.fn(() => 'idle'),
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveSettingsSection: mockSetActiveSettingsSection,
  }),
}));

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: vi.fn(() => ({ data: null, isError: false })),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(() => false),
}));

vi.mock('@/utils/domain', () => ({
  isAiroSubdomain: vi.fn((fqdn: string) => fqdn?.includes('airoapp.ai')),
  resolveSiteFqdn: vi.fn((site: any) => site?.domains?.[0]?.fqdn || site?.name || null),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: true,
    isAuthDisabled: false,
    isLoading: false,
  }),
}));

// Import mocked modules to control their behavior
import { useDomainSearch } from '@/hooks/useDomainSearch';
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';
import { hasBeenPublished } from '@/utils/site';

describe('DomainBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'testapp.com', domainType: 'custom' }],
    };
    mockDevelopStore.app = { name: 'Test App' };
  });

  it('should render without crashing', () => {
    renderWithProviders(<DomainBar />);

    expect(screen.getByText('testapp.com')).toBeInTheDocument();
  });

  it('should display custom domain when available', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'custom.example.com', domainType: 'custom' }],
    };

    renderWithProviders(<DomainBar />);

    expect(screen.getByText('custom.example.com')).toBeInTheDocument();
  });

  it('should display airo subdomain', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(screen.getByText('test.airoapp.ai')).toBeInTheDocument();
  });

  it('should show "Add Custom Domain" button for airo subdomain', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(screen.getByText('builder_custom_domain_button_add')).toBeInTheDocument();
  });

  it('should not show "Add Custom Domain" button for custom domain', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'custom.example.com', domainType: 'custom' }],
    };

    renderWithProviders(<DomainBar />);

    expect(screen.queryByText('builder_custom_domain_button_add')).not.toBeInTheDocument();
  });

  it('should call setActiveSettingsSection when "Add Custom Domain" is clicked', async () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    const { user } = renderWithProviders(<DomainBar />);

    const addDomainButton = screen.getByText('builder_custom_domain_button_add');
    await user.click(addDomainButton);

    expect(mockSetActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DOMAIN);
  });

  it('should display suggested domain when available', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };
    mockDevelopStore.app = { name: 'Test App' };

    vi.mocked(hasBeenPublished).mockReturnValue(true);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);

    renderWithProviders(<DomainBar />);

    // Should show the connect button
    expect(screen.getByText('builder_domain_button_connect')).toBeInTheDocument();
  });

  it('should display "Connect Domain" button for suggested domain', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    vi.mocked(hasBeenPublished).mockReturnValue(true);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);

    renderWithProviders(<DomainBar />);

    expect(screen.getByText('builder_domain_button_connect')).toBeInTheDocument();
  });

  it('should call sendMessage when "Connect Domain" is clicked', async () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    vi.mocked(hasBeenPublished).mockReturnValue(true);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);

    const { user } = renderWithProviders(<DomainBar />);

    const connectButton = screen.getByText('builder_domain_button_connect');
    await user.click(connectButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  it('should show busy growl when connecting domain while streaming', async () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    vi.mocked(hasBeenPublished).mockReturnValue(true);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);
    vi.mocked(useIsActivelyStreaming).mockReturnValue(true);

    const { user } = renderWithProviders(<DomainBar />);

    const connectButton = screen.getByText('builder_domain_button_connect');
    await user.click(connectButton);

    // Should not call sendMessage when streaming
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('should show busy growl when connecting domain while loading', async () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    vi.mocked(hasBeenPublished).mockReturnValue(true);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);
    vi.mocked(useIsLoading).mockReturnValue(true);

    const { user } = renderWithProviders(<DomainBar />);

    const connectButton = screen.getByText('builder_domain_button_connect');
    await user.click(connectButton);

    // Should not call sendMessage when loading
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('should not show suggested domain when site is not published', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    vi.mocked(hasBeenPublished).mockReturnValue(false);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);

    renderWithProviders(<DomainBar />);

    // Should show airo subdomain, not suggested domain
    expect(screen.getByText('test.airoapp.ai')).toBeInTheDocument();
    expect(screen.queryByText('testapp.com')).not.toBeInTheDocument();
  });

  it('should display site name when no domain is available', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [],
    };

    renderWithProviders(<DomainBar />);

    expect(screen.getByText('Test App')).toBeInTheDocument();
  });

  it('should handle domain search error gracefully', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    vi.mocked(hasBeenPublished).mockReturnValue(true);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: null,
      isError: true,
    } as any);

    renderWithProviders(<DomainBar />);

    // Should fall back to showing airo subdomain
    expect(screen.getByText('test.airoapp.ai')).toBeInTheDocument();
  });

  it('should have correct EID on "Add Custom Domain" button', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    const { container } = renderWithProviders(<DomainBar />);

    const addDomainButton = container.querySelector('[data-eid="develop.preview.buy_domain"]');
    expect(addDomainButton).toBeInTheDocument();
  });

  it('should have correct EID on "Connect Domain" button', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    vi.mocked(hasBeenPublished).mockReturnValue(true);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    const connectButton = container.querySelector('[data-eid="develop.preview.suggested_domain_connect"]');
    expect(connectButton).toBeInTheDocument();
  });
});
