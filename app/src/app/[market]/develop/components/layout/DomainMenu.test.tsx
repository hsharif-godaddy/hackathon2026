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

// Mock UXCore Button to properly handle onClick in tests
vi.mock('@ux/button', () => ({
  default: ({ onClick, disabled, icon, children, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {icon}
      {children}
    </button>
  ),
}));

import DomainMenu, { getShareLabel, resolveShareUrl } from './DomainMenu';

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;
const PAST = Date.now() - 60 * 1000;

// Mock clipboard API at module scope
const mockWriteText = vi.fn().mockResolvedValue(undefined);

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
    mockLogClickEvent.mockImplementation(() => vi.fn());
    mockWriteText.mockClear();
    mockWriteText.mockResolvedValue(undefined);
    // Stub the clipboard API for each test
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: mockWriteText,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    it('opens preview URL with airoPreview param when preview header flag is on', async () => {
      mockUseSwitchboard.mockImplementation((flag: string) => flag === 'appbuilder-preview-header');

      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const previewRow = await screen.findByTestId('header-view-share-preview');
      fireEvent.click(previewRow);

      expect(mockOpen).toHaveBeenCalledWith(
        'https://preview.example.com?airoPreview=1',
        '_blank',
        'noopener,noreferrer'
      );
      mockOpen.mockRestore();
    });

    it('opens preview URL without airoPreview param when preview header flag is off', async () => {
      mockUseSwitchboard.mockImplementation((flag: string) => {
        if (flag === 'appbuilder-preview-header') {
          return false;
        }
        return true;
      });

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
    it('hides published row when not published', async () => {
      mockHasBeenPublished.mockReturnValue(false);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('header-view-share-published')).not.toBeInTheDocument();
      });
    });

    it('shows published row when published', async () => {
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      expect(publishedRow).toBeInTheDocument();
    });

    it('shows "No changes" when in sync', async () => {
      mockHasBeenPublished.mockReturnValue(true);
      mockUsePublishSyncState.mockReturnValue({
        changesSincePublish: 0,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      expect(publishedRow).toHaveTextContent('builder_view_share_published_no_changes');
    });

    it('shows changes count when out of sync', async () => {
      mockHasBeenPublished.mockReturnValue(true);
      mockUsePublishSyncState.mockReturnValue({
        changesSincePublish: 3,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const publishedRow = await screen.findByTestId('header-view-share-published');
      expect(publishedRow).toHaveTextContent('builder_view_share_published_stale');
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
      expect(screen.queryByTestId('header-view-share-input')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-view-share-copy')).not.toBeInTheDocument();
    });

    it('shows text input and copy button when feature flag is on', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-input')).toBeInTheDocument();
        expect(screen.getByTestId('header-view-share-copy')).toBeInTheDocument();
      });
    });

    it('shows cosmetic URL when no active token', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const input = await screen.findByTestId('header-view-share-input');
      expect(input).toHaveValue('https://preview.example.com/...');
    });

    it('shows real share URL when active token exists', async () => {
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

      const input = await screen.findByTestId('header-view-share-input');
      expect(input).toHaveValue('https://share.example.com/abc');
    });

    it('shows countdown label with days remaining when token exists', async () => {
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

      const countdown = await screen.findByTestId('header-view-share-countdown');
      // Should show days countdown (7 days from FUTURE)
      expect(countdown).toHaveTextContent('builder_view_share_link_label_days');
    });

    it('shows 7 days label when no token exists', async () => {
      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const countdown = await screen.findByTestId('header-view-share-countdown');
      expect(countdown).toHaveTextContent('builder_view_share_link_label_days');
    });

    it('filters out expired tokens and shows cosmetic URL', async () => {
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

      const input = await screen.findByTestId('header-view-share-input');
      expect(input).toHaveValue('https://preview.example.com/...');
    });

    it('creates token on copy click when no token exists (lazy creation)', async () => {
      const newToken = {
        token: 'new-token',
        appId: 'app-123',
        shareUrl: 'https://share.example.com/new',
        expiresAt: FUTURE,
        createdAt: new Date().toISOString(),
      };
      mockMutateAsync.mockResolvedValue(newToken);

      const { user } = renderWithProviders(<DomainMenu />);
      await user.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-copy')).toBeInTheDocument();
      });

      // Get the copy button and verify it's not disabled
      const copyButton = screen.getByTestId('header-view-share-copy');
      expect(copyButton).not.toBeDisabled();

      // Click the copy button
      await user.click(copyButton);

      // Wait for the create analytics event which is logged after mutateAsync completes
      await waitFor(() => {
        expect(mockLogClickEvent).toHaveBeenCalledWith('develop.header.view_share.create', expect.anything());
      });
      // Verify the copy event is also logged (happens after clipboard write)
      expect(mockLogClickEvent).toHaveBeenCalledWith('develop.header.view_share.copy', expect.anything());
    });

    it('copies to clipboard when token exists without creating new token', async () => {
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

      const { user } = renderWithProviders(<DomainMenu />);
      await user.click(screen.getByTestId('header-view-share-button'));

      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-copy')).toBeInTheDocument();
      });

      const copyButton = screen.getByTestId('header-view-share-copy');
      expect(copyButton).not.toBeDisabled();

      await user.click(copyButton);

      // Wait for the copy success - the copy analytics event gets logged after clipboard write
      await waitFor(() => {
        expect(mockLogClickEvent).toHaveBeenCalledWith('develop.header.view_share.copy', expect.anything());
      });
      // Should not create a new token
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('shows spinner when token creation is pending', async () => {
      mockUseCreateShareToken.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
        isError: false,
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const copyButton = await screen.findByTestId('header-view-share-copy');
      expect(copyButton).toBeDisabled();
    });

    it('shows error message when token fetch fails but keeps button enabled', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const copyButton = await screen.findByTestId('header-view-share-copy');
      // Button should still be enabled (error message is enough feedback)
      expect(copyButton).not.toBeDisabled();
      // Error message should be shown
      expect(screen.getByTestId('header-view-share-error')).toHaveTextContent('builder_view_share_error_load');
    });

    it('resets error state when popover reopens', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

      const { user } = renderWithProviders(<DomainMenu />);
      await user.click(screen.getByTestId('header-view-share-button'));

      // Error should be shown
      await waitFor(() => {
        expect(screen.getByTestId('header-view-share-error')).toBeInTheDocument();
      });

      // Close popover
      await user.keyboard('{Escape}');

      // Reopen - mock success this time
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      await user.click(screen.getByTestId('header-view-share-button'));

      // Error should be cleared
      await waitFor(() => {
        expect(screen.queryByTestId('header-view-share-error')).not.toBeInTheDocument();
      });
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

    it('logs create and copy events when token is created on copy click', async () => {
      mockMutateAsync.mockResolvedValue({
        token: 'new-token',
        appId: 'app-123',
        shareUrl: 'https://share.example.com/new',
        expiresAt: FUTURE,
        createdAt: new Date().toISOString(),
      });

      renderWithProviders(<DomainMenu />);
      fireEvent.click(screen.getByTestId('header-view-share-button'));

      const copyButton = await screen.findByTestId('header-view-share-copy');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(mockLogClickEvent).toHaveBeenCalledWith(
          'develop.header.view_share.create',
          expect.anything()
        );
        expect(mockLogClickEvent).toHaveBeenCalledWith(
          'develop.header.view_share.copy',
          expect.anything()
        );
      });
    });

    it('logs only copy event when token already exists', async () => {
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
        expect(mockLogClickEvent).toHaveBeenCalledWith(
          'develop.header.view_share.copy',
          expect.anything()
        );
      });
      // Should not log create event
      expect(mockLogClickEvent).not.toHaveBeenCalledWith(
        'develop.header.view_share.create',
        expect.anything()
      );
    });
  });
});

describe('getShareLabel', () => {
  const mockT = (key: string, values?: Record<string, unknown>) => {
    if (values) {
      return Object.entries(values).reduce(
        (str, [k, v]) => str.replace(`{${k}}`, String(v)),
        key
      );
    }
    return key;
  };

  it('returns 7 days label when no token', () => {
    expect(getShareLabel(undefined, mockT)).toBe('builder_view_share_link_label_days');
  });

  it('returns days label when more than 24 hours remaining', () => {
    const token = {
      token: 'test',
      appId: 'app-123',
      expiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000, // 3 days
      createdAt: new Date().toISOString(),
    };
    expect(getShareLabel(token, mockT)).toBe('builder_view_share_link_label_days');
  });

  it('returns singular day label when 1 day remaining', () => {
    const token = {
      token: 'test',
      appId: 'app-123',
      expiresAt: Date.now() + 1 * 24 * 60 * 60 * 1000, // Exactly 1 day
      createdAt: new Date().toISOString(),
    };
    expect(getShareLabel(token, mockT)).toBe('builder_view_share_link_label_day');
  });

  it('returns hours label when less than 24 hours but more than 1 hour', () => {
    const token = {
      token: 'test',
      appId: 'app-123',
      expiresAt: Date.now() + 12 * 60 * 60 * 1000, // 12 hours
      createdAt: new Date().toISOString(),
    };
    expect(getShareLabel(token, mockT)).toBe('builder_view_share_link_label_hours');
  });

  it('returns singular hour label when 1 hour remaining', () => {
    const token = {
      token: 'test',
      appId: 'app-123',
      expiresAt: Date.now() + 1 * 60 * 60 * 1000, // Exactly 1 hour
      createdAt: new Date().toISOString(),
    };
    expect(getShareLabel(token, mockT)).toBe('builder_view_share_link_label_hour');
  });

  it('returns minutes label when less than 1 hour', () => {
    const token = {
      token: 'test',
      appId: 'app-123',
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
      createdAt: new Date().toISOString(),
    };
    expect(getShareLabel(token, mockT)).toBe('builder_view_share_link_label_mins');
  });

  it('returns singular minute label when 1 minute remaining', () => {
    const token = {
      token: 'test',
      appId: 'app-123',
      expiresAt: Date.now() + 1 * 60 * 1000, // Exactly 1 minute
      createdAt: new Date().toISOString(),
    };
    expect(getShareLabel(token, mockT)).toBe('builder_view_share_link_label_min');
  });

  it('returns 0 minutes when token is expired', () => {
    const token = {
      token: 'test',
      appId: 'app-123',
      expiresAt: Date.now() - 1000, // Expired
      createdAt: new Date().toISOString(),
    };
    expect(getShareLabel(token, mockT)).toBe('builder_view_share_link_label_mins');
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
