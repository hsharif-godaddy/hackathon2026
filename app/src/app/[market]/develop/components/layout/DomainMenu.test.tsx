/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';

// Radix Popover calls ResizeObserver.observe via @floating-ui
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(global as any).ResizeObserver = MockResizeObserver;

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));

const mockUseSwitchboard = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
}));

const mockUseShareTokens = vi.hoisted(() =>
  vi.fn(() => ({ data: [], refetch: vi.fn().mockResolvedValue(undefined) }))
);
const mockMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUseCreateShareToken = vi.hoisted(() =>
  vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
  }))
);
vi.mock('@/hooks/useShareTokens', () => ({
  useShareTokens: mockUseShareTokens,
  useCreateShareToken: mockUseCreateShareToken,
}));

const mockUsePublishSyncState = vi.hoisted(() =>
  vi.fn(() => ({
    isInSync: true,
    changesSincePublish: 0,
    isLoading: false,
    hasNeverBeenPublished: false,
    isError: false,
  }))
);
vi.mock('@/hooks/usePublishSyncState', () => ({
  usePublishSyncState: mockUsePublishSyncState,
}));

const mockUseDevelopPageStore = vi.hoisted(() => vi.fn());
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: mockUseDevelopPageStore,
}));

const mockHasBeenPublished = vi.hoisted(() => vi.fn());
vi.mock('@/utils/site', () => ({
  hasBeenPublished: mockHasBeenPublished,
}));

const mockLogClickEvent = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock('@/utils/instrumentation', () => ({
  ...mockInstrumentation(),
  logClickEvent: mockLogClickEvent,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) {
      return Object.entries(values).reduce(
        (str, [k, v]) => str.replace(`{${k}}`, String(v)),
        key
      );
    }
    return key;
  },
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

import DomainMenu, { resolveShareUrl } from './DomainMenu';

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;
const PAST = Date.now() - 60 * 1000;

const mockClipboard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

describe('DomainMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue(true);
    mockHasBeenPublished.mockReturnValue(false);
    mockUseDevelopPageStore.mockImplementation((selector: (state: any) => any) => {
      const state = {
        site: {
          preview_url: 'https://preview.example.com',
          published_url: 'https://published.example.com',
        },
      };
      return selector(state);
    });
    mockUseShareTokens.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    mockUseCreateShareToken.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });
    mockUsePublishSyncState.mockReturnValue({
      isInSync: true,
      changesSincePublish: 0,
      isLoading: false,
      hasNeverBeenPublished: false,
      isError: false,
    });
    mockClipboard.mockResolvedValue(undefined);
    mockLogClickEvent.mockImplementation(() => vi.fn());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboard },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Icon Button', () => {
    it('renders the trigger button with correct test id', () => {
      renderWithProviders(<DomainMenu />);
      expect(screen.getByTestId('header-view-share-button')).toBeInTheDocument();
    });

    it('disables button when no preview URL and not published', () => {
      mockUseDevelopPageStore.mockImplementation((selector: (state: any) => any) => {
        const state = { site: { preview_url: null, published_url: null } };
        return selector(state);
      });
      mockHasBeenPublished.mockReturnValue(false);

      renderWithProviders(<DomainMenu />);
      expect(screen.getByTestId('header-view-share-button')).toBeDisabled();
    });

    it('enables button when preview URL exists', () => {
      mockHasBeenPublished.mockReturnValue(false);
      renderWithProviders(<DomainMenu />);
      expect(screen.getByTestId('header-view-share-button')).not.toBeDisabled();
    });

    it('enables button when published', () => {
      mockUseDevelopPageStore.mockImplementation((selector: (state: any) => any) => {
        const state = { site: { preview_url: null, published_url: 'https://published.example.com' } };
        return selector(state);
      });
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<DomainMenu />);
      expect(screen.getByTestId('header-view-share-button')).not.toBeDisabled();
    });
  });

  describe('Popover', () => {
    it('opens popover on button click', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-popover')).toBeInTheDocument();
      });
    });

    it('logs open analytics event', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.header.view_share.open',
        expect.anything()
      );
    });
  });

  describe('Preview Link', () => {
    it('shows preview row when preview URL exists', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-preview')).toBeInTheDocument();
      });
    });

    it('hides preview row when no preview URL', async () => {
      mockUseDevelopPageStore.mockImplementation((selector: (state: any) => any) => {
        const state = { site: { preview_url: null, published_url: 'https://published.example.com' } };
        return selector(state);
      });
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-popover')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('header-view-share-preview')).not.toBeInTheDocument();
    });

    it('opens preview URL in new tab on click', async () => {
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const previewRow = await screen.findByTestId('header-view-share-preview');
      fireEvent.click(previewRow);

      expect(mockOpen).toHaveBeenCalledWith(
        'https://preview.example.com',
        '_blank',
        'noopener,noreferrer'
      );
      mockOpen.mockRestore();
    });
  });

  describe('Published Link', () => {
    it('shows published row always (even when not published)', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-published')).toBeInTheDocument();
      });
    });

    it('shows published row as inactive when not published', async () => {
      mockHasBeenPublished.mockReturnValue(false);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      // When not published, the row is a div (not a button) with opacity-50
      expect(publishedRow.tagName).toBe('DIV');
      expect(publishedRow).toHaveClass('opacity-50');
    });

    it('enables published row when published', async () => {
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      expect(publishedRow).not.toBeDisabled();
    });

    it('shows "Up to date" when in sync', async () => {
      mockHasBeenPublished.mockReturnValue(true);
      mockUsePublishSyncState.mockReturnValue({
        isInSync: true,
        changesSincePublish: 0,
        isLoading: false,
        hasNeverBeenPublished: false,
        isError: false,
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      expect(publishedRow).toHaveTextContent('builder_view_share_published_sync');
    });

    it('shows changes count when out of sync', async () => {
      mockHasBeenPublished.mockReturnValue(true);
      mockUsePublishSyncState.mockReturnValue({
        isInSync: false,
        changesSincePublish: 3,
        isLoading: false,
        hasNeverBeenPublished: false,
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-published')).toBeInTheDocument();
      });
    });

    it('opens published URL in new tab on click', async () => {
      mockHasBeenPublished.mockReturnValue(true);
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      fireEvent.click(publishedRow);

      expect(mockOpen).toHaveBeenCalledWith(
        'https://published.example.com',
        '_blank',
        'noopener,noreferrer'
      );
      mockOpen.mockRestore();
    });
  });

  describe('Share Link Section', () => {
    it('hides share section when feature flag is off', async () => {
      mockUseSwitchboard.mockReturnValue(false);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-popover')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('header-view-share-create')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-view-share-copy')).not.toBeInTheDocument();
    });

    it('shows create share link row when no active token', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-create')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('header-view-share-copy')).not.toBeInTheDocument();
    });

    it('shows copy button when active token exists', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [
          {
            token: 'active-token',
            appId: 'app-123',
            shareUrl: 'https://share.example.com/abc',
            expiresAt: FUTURE,
            createdAt: new Date().toISOString(),
          },
        ],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-copy')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('header-view-share-create')).not.toBeInTheDocument();
    });

    it('shows expiration timestamp when active token exists', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [
          {
            token: 'active-token',
            appId: 'app-123',
            shareUrl: 'https://share.example.com/abc',
            expiresAt: FUTURE,
            createdAt: new Date().toISOString(),
          },
        ],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-expiry')).toBeInTheDocument();
      });
    });

    it('filters out expired tokens', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [
          {
            token: 'expired-token',
            appId: 'app-123',
            shareUrl: 'https://share.example.com/abc',
            expiresAt: PAST,
            createdAt: new Date().toISOString(),
          },
        ],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-create')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('header-view-share-copy')).not.toBeInTheDocument();
    });

    it('calls createToken.mutateAsync when create is clicked', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const createRow = await screen.findByTestId('header-view-share-create');
      fireEvent.click(createRow);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({ appId: 'app-123', expiresInDays: 7 });
      });
    });

    it('shows error message when tokens fetch fails', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-error')).toBeInTheDocument();
      });
    });

    it('shows loading state when tokens are initially loading', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: true,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const createButton = await screen.findByTestId('header-view-share-create');
      expect(createButton).toBeDisabled();
      expect(createButton).toHaveTextContent('builder_common_loading');
    });

    it('shows creating state when mutation is pending', async () => {
      mockUseCreateShareToken.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
        isError: false,
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const createButton = await screen.findByTestId('header-view-share-create');
      expect(createButton).toBeDisabled();
      expect(createButton).toHaveTextContent('builder_view_share_btn_creating');
    });

    it('shows Copied feedback after copy click', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [
          {
            token: 'active-token',
            appId: 'app-123',
            shareUrl: 'https://share.example.com/abc',
            expiresAt: FUTURE,
            createdAt: new Date().toISOString(),
          },
        ],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const copyButton = await screen.findByTestId('header-view-share-copy');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(copyButton).toHaveTextContent('builder_common_copied');
      });
      // Button remains clickable to allow re-copying
      expect(copyButton).not.toBeDisabled();
    });
  });

  describe('Analytics', () => {
    it('logs preview click event', async () => {
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const previewRow = await screen.findByTestId('header-view-share-preview');
      fireEvent.click(previewRow);

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.header.view_share.preview',
        expect.anything()
      );
      mockOpen.mockRestore();
    });

    it('logs published click event', async () => {
      mockHasBeenPublished.mockReturnValue(true);
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      fireEvent.click(publishedRow);

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.header.view_share.published',
        expect.anything()
      );
      mockOpen.mockRestore();
    });

    it('logs create share link event', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const createRow = await screen.findByTestId('header-view-share-create');
      fireEvent.click(createRow);

      await waitFor(() => {
        expect(mockLogClickEvent).toHaveBeenCalledWith(
          'develop.header.view_share.create',
          expect.anything()
        );
      });
    });
  });
});

describe('resolveShareUrl', () => {
  it('uses the server-provided shareUrl when present', () => {
    expect(
      resolveShareUrl({
        token: 'yPBorcyKvnYJ',
        shareUrl: 'https://share.example.com/encoded',
      })
    ).toBe('https://share.example.com/encoded');
  });

  it('falls back to <origin>?airoShareToken=<token> when shareUrl is absent', () => {
    expect(
      resolveShareUrl({ token: 'yPBorcyKvnYJ' }, 'https://example.com')
    ).toBe('https://example.com?airoShareToken=yPBorcyKvnYJ');
  });

  it('returns server shareUrl even when origin is provided', () => {
    expect(
      resolveShareUrl(
        { token: 'yPBorcyKvnYJ', shareUrl: 'https://bff.example/share/abc' },
        'https://different.example'
      )
    ).toBe('https://bff.example/share/abc');
  });
});
