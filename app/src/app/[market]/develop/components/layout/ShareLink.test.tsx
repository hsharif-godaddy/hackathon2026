/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMutation } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(global as any).ResizeObserver = MockResizeObserver;

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));

const switchboardFlags = vi.hoisted(() => new Map<string, boolean | undefined>());
const mockUseSwitchboard = vi.hoisted(() => (flag: string) => switchboardFlags.get(flag));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
}));

const mockUseShareTokens = vi.hoisted(() =>
  vi.fn(() => ({ data: [], isLoading: false, isError: false, refetch: vi.fn().mockResolvedValue(undefined) }))
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
  ShareTokenError: class ShareTokenError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
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
  useTranslations: () => (key: string) => key,
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

vi.mock('@ux/field-frame', () => ({
  default: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@ux/text-entry', () => ({
  default: ({ value, id, readOnly, ...props }: any) => (
    <input id={id} value={value ?? ''} readOnly={readOnly} {...props} />
  ),
}));

vi.mock('@ux/button', () => ({
  default: ({ onClick, disabled, icon, children, text: buttonText, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {icon}
      {buttonText}
      {children}
    </button>
  ),
}));

vi.mock('@ux/spinner', () => ({
  default: (props: any) => <div data-testid="spinner" {...props} />,
}));

vi.mock('@ux/text', () => ({
  default: new Proxy({}, {
    get: (_target, tag) => {
      return ({ text: textContent, children, ...props }: any) => {
        const Tag = tag as any;
        return <Tag {...props}>{textContent ?? children}</Tag>;
      };
    },
  }),
}));

let segmentChangeHandler: ((value: string) => void) | null = null;

vi.mock('@airo-ux/pattern-library/_vendor/segmented-controller/styles', () => ({}));
vi.mock('@airo-ux/pattern-library/_vendor/segmented-controller', () => ({
  SegmentedController: ({ children, value, onSelectionChange, ...props }: any) => {
    segmentChangeHandler = onSelectionChange;
    return (
      <div role="tablist" data-value={value} {...props}>
        {children}
      </div>
    );
  },
  SegmentedControllerItem: ({ children, value, ...props }: any) => (
    <button
      role="tab"
      data-value={value}
      onClick={() => segmentChangeHandler?.(value)}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: any) => <svg data-testid={props['data-testid']} data-value={props.value} />,
}));

const mockWithPreviewParam = vi.hoisted(() => vi.fn((url: string) => `${url}?airoPreview=1`));
vi.mock('@/utils/previewUrl', () => ({
  withPreviewParam: mockWithPreviewParam,
}));

import ShareLink from './ShareLink';

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;
const mockWriteText = vi.fn().mockResolvedValue(undefined);

function setupStore(overrides: { site?: any; isMobile?: boolean } = {}) {
  const state = {
    site: overrides.site ?? {
      preview_url: 'https://preview.example.com',
      published_url: 'https://published.example.com',
    },
    isMobile: overrides.isMobile ?? false,
  };
  mockUseDevelopPageStore.mockImplementation((selector: (s: any) => any) => selector(state));
}

async function openPopover() {
  fireEvent.click(screen.getByTestId('share-link-button'));
  await waitFor(() => {
    expect(screen.getByTestId('share-link-popover')).toBeInTheDocument();
  });
}

function getShareInput() {
  return screen.getByTestId('share-link-input').querySelector('input') as HTMLInputElement;
}

function switchToSegment(value: string) {
  const tablist = screen.getByRole('tablist');
  const tab = tablist.querySelector(`[data-value="${value}"]`) as HTMLElement;
  if (tab) fireEvent.click(tab);
}

describe('ShareLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchboardFlags.clear();
    switchboardFlags.set('appbuilder-share-links', true);
    switchboardFlags.set('appbuilder-preview-header', false);
    mockHasBeenPublished.mockReturnValue(false);
    setupStore();
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
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: mockWriteText },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Trigger Button', () => {
    it('renders the trigger button', () => {
      renderWithProviders(<ShareLink />);
      expect(screen.getByTestId('share-link-button')).toBeInTheDocument();
    });

    it('disables button when no preview URL and not published', () => {
      setupStore({ site: { preview_url: null, published_url: null } });
      mockHasBeenPublished.mockReturnValue(false);

      renderWithProviders(<ShareLink />);
      expect(screen.getByTestId('share-link-button')).toBeDisabled();
    });

    it('enables button when preview URL exists', () => {
      renderWithProviders(<ShareLink />);
      expect(screen.getByTestId('share-link-button')).not.toBeDisabled();
    });

    it('enables button when published even without preview URL', () => {
      setupStore({ site: { preview_url: null, published_url: 'https://published.example.com' } });
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<ShareLink />);
      expect(screen.getByTestId('share-link-button')).not.toBeDisabled();
    });
  });

  describe('Popover', () => {
    it('opens popover on button click', async () => {
      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByTestId('share-link-popover')).toBeInTheDocument();
    });

    it('logs open analytics event', () => {
      renderWithProviders(<ShareLink />);
      fireEvent.click(screen.getByTestId('share-link-button'));

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.share_link.open',
        expect.anything()
      );
    });

    it('shows title text', async () => {
      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByText('builder_common_preview')).toBeInTheDocument();
    });
  });

  describe('Segmented Controller', () => {
    it('hides segmented controller when not published', async () => {
      mockHasBeenPublished.mockReturnValue(false);

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.queryByTestId('share-link-segment')).not.toBeInTheDocument();
    });

    it('shows segmented controller when published', async () => {
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByTestId('share-link-segment')).toBeInTheDocument();
    });

    it('defaults to published segment when published', async () => {
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByTestId('share-link-published-content')).toBeInTheDocument();
    });

    it('shows preview content when not published', async () => {
      mockHasBeenPublished.mockReturnValue(false);

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByTestId('share-link-preview-content')).toBeInTheDocument();
    });

    it('logs tab switch analytics event', async () => {
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<ShareLink />);
      await openPopover();

      switchToSegment('preview');

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.share_link.tab_switch',
        expect.objectContaining({ tab: 'preview' })
      );
    });
  });

  describe('Published Content', () => {
    beforeEach(() => {
      mockHasBeenPublished.mockReturnValue(true);
    });

    it('shows published URL', async () => {
      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(getShareInput()).toHaveValue('https://published.example.com');
    });

    it('shows sync status when up to date', async () => {
      mockUsePublishSyncState.mockReturnValue({
        isInSync: true,
        changesSincePublish: 0,
        isLoading: false,
        hasNeverBeenPublished: false,
        isError: false,
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByText('builder_share_link_published_in_sync')).toBeInTheDocument();
    });

    it('shows changes count when out of sync', async () => {
      mockUsePublishSyncState.mockReturnValue({
        isInSync: false,
        changesSincePublish: 3,
        isLoading: false,
        hasNeverBeenPublished: false,
        isError: false,
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByText('builder_share_link_published_stale')).toBeInTheDocument();
    });

    it('shows singular change text', async () => {
      mockUsePublishSyncState.mockReturnValue({
        isInSync: false,
        changesSincePublish: 1,
        isLoading: false,
        hasNeverBeenPublished: false,
        isError: false,
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByText('builder_share_link_published_stale')).toBeInTheDocument();
    });

    it('shows spinner while checking sync', async () => {
      mockUsePublishSyncState.mockReturnValue({
        isInSync: true,
        changesSincePublish: 0,
        isLoading: true,
        hasNeverBeenPublished: false,
        isError: false,
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByTestId('share-link-published-loading')).toBeInTheDocument();
    });

    it('shows unavailable text on sync error', async () => {
      mockUsePublishSyncState.mockReturnValue({
        isInSync: false,
        changesSincePublish: 0,
        isLoading: false,
        hasNeverBeenPublished: false,
        isError: true,
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByText('builder_share_link_published_last_version')).toBeInTheDocument();
    });

    it('opens published URL in new tab on open button click', async () => {
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await user.click(screen.getByTestId('share-link-open'));

      expect(mockOpen).toHaveBeenCalledWith(
        'https://published.example.com',
        '_blank',
        'noopener,noreferrer'
      );
      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.share_link.open_url',
        expect.objectContaining({ type: 'published' })
      );
      mockOpen.mockRestore();
    });

    it('shows QR code on desktop', async () => {
      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByTestId('share-link-qr')).toBeInTheDocument();
    });

    it('hides QR code on mobile', async () => {
      setupStore({ isMobile: true });
      mockHasBeenPublished.mockReturnValue(true);

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.queryByTestId('share-link-qr')).not.toBeInTheDocument();
    });
  });

  describe('Preview Content', () => {
    it('shows helper text when not published', async () => {
      mockHasBeenPublished.mockReturnValue(false);

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.getByText('builder_share_link_preview_latest')).toBeInTheDocument();
    });

    it('shows share URL when token exists', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/abc',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(getShareInput()).toHaveValue('https://share.example.com/abc');
      });
    });

    it('shows loading spinner when no active token yet', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: true,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-preview-loading')).toBeInTheDocument();
      });
    });

    it('shows loading spinner when token creation is pending', async () => {
      mockUseCreateShareToken.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
        isError: false,
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-preview-loading')).toBeInTheDocument();
      });
    });

    it('shows error state when token fetch fails', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-error-state')).toBeInTheDocument();
        expect(screen.getByText('builder_share_link_error_load')).toBeInTheDocument();
      });
    });

    it('shows error state when token creation fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Creation failed'));

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-error-state')).toBeInTheDocument();
        expect(screen.getByText('builder_share_link_error_create')).toBeInTheDocument();
      });
    });

    it('shows QR code on desktop when token is active', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/abc',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-qr')).toBeInTheDocument();
      });
    });

    it('hides QR code on mobile', async () => {
      setupStore({ isMobile: true });

      renderWithProviders(<ShareLink />);
      await openPopover();

      expect(screen.queryByTestId('share-link-qr')).not.toBeInTheDocument();
    });

    it('hides QR code during loading state', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: true,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.queryByTestId('share-link-qr')).not.toBeInTheDocument();
      });
    });

    it('hides QR code during error state', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.queryByTestId('share-link-qr')).not.toBeInTheDocument();
      });
    });
  });


  describe('Copy Functionality', () => {
    beforeEach(() => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/abc',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });
    });

    it('copies URL to clipboard on copy button click', async () => {
      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(getShareInput()).toHaveValue('https://share.example.com/abc');
      });

      await user.click(screen.getByTestId('share-link-copy'));

      await waitFor(() => {
        expect(screen.getByTestId('share-link-copy')).toHaveAttribute('aria-label', 'builder_share_link_copied');
      });
    });

    it('shows checkmark after successful copy', async () => {
      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-copy')).toHaveAttribute('aria-label', 'builder_share_link_copy');
      });

      await user.click(screen.getByTestId('share-link-copy'));

      await waitFor(() => {
        expect(screen.getByTestId('share-link-copy')).toHaveAttribute('aria-label', 'builder_share_link_copied');
      });
    });

    it('logs copy analytics event on successful copy', async () => {
      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(getShareInput()).toHaveValue('https://share.example.com/abc');
      });

      await user.click(screen.getByTestId('share-link-copy'));

      await waitFor(() => {
        expect(mockLogClickEvent).toHaveBeenCalledWith(
          'develop.share_link.copy',
          expect.objectContaining({ type: 'preview' })
        );
      });
    });
  });

  describe('Open Functionality', () => {
    it('opens URL in new tab on open button click', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/abc',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(getShareInput()).toHaveValue('https://share.example.com/abc');
      });

      await user.click(screen.getByTestId('share-link-open'));

      expect(mockOpen).toHaveBeenCalledWith(
        'https://share.example.com/abc',
        '_blank',
        'noopener,noreferrer'
      );
      mockOpen.mockRestore();
    });

    it('does nothing when displayUrl is empty on published segment', async () => {
      setupStore({ site: { preview_url: null, published_url: '' } });
      mockHasBeenPublished.mockReturnValue(true);
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-published-content')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('share-link-open'));

      expect(mockOpen).not.toHaveBeenCalled();
      mockOpen.mockRestore();
    });
  });

  describe('Token Auto-Creation', () => {
    it('creates token automatically when popover opens on preview segment', async () => {
      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({ appId: 'app-123', expiresInDays: 7 });
      });
    });

    it('does not create token when one already exists', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'existing-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/existing',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-preview-content')).toBeInTheDocument();
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('does not create token when share links are disabled', async () => {
      switchboardFlags.set('appbuilder-share-links', false);

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-preview-content')).toBeInTheDocument();
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('does not create token when viewing the published section', async () => {
      mockHasBeenPublished.mockReturnValue(true);
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-published-content')).toBeInTheDocument();
      });

      mockMutateAsync.mockClear();

      switchToSegment('published');

      await waitFor(() => {
        expect(screen.getByTestId('share-link-published-content')).toBeInTheDocument();
      });

      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('logs warning on creation failure', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Network error'));

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'share-link.publicPreview.createError',
          expect.objectContaining({ message: 'Network error', appId: 'app-123' })
        );
      });
    });

    it('does not loop the create POST on a persistent 401 (real useMutation)', async () => {
      // Genuine regression guard for the share-token request loop. The OTHER
      // tests here mock useCreateShareToken with a STATIC `isPending: false`, so
      // they cannot reproduce the production loop — which was driven by
      // `createToken.isPending` toggling false→true→false in the effect's
      // dependency array (re-running the effect mid-request, firing the cleanup's
      // `cancelled = true` before the rejection was caught, swallowing the error).
      //
      // This test instead drives a REAL @tanstack/react-query useMutation (the
      // provider tree from renderWithProviders supplies the QueryClient), so
      // `isPending` genuinely toggles. Against the pre-fix effect this loops
      // unbounded (the create POST re-fires on every 401 round-trip); against the
      // fix (mountedRef latch + isPending out of deps + MAX_AUTO_CREATE_ATTEMPTS
      // cap) the create is bounded and the error surfaces. So this DOES
      // distinguish fixed from broken, unlike a static-isPending mock.
      const { ShareTokenError } = await import('@/hooks/useShareTokens');
      let createCalls = 0;
      mockUseCreateShareToken.mockImplementation(() =>
        useMutation({
          mutationFn: async () => {
            createCalls += 1;
            throw new ShareTokenError('Unauthorized', 401);
          },
        })
      );

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-error-state')).toBeInTheDocument();
      });

      // Let any (buggy) re-fires flush — the pre-fix loop would keep climbing here.
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Bounded by MAX_AUTO_CREATE_ATTEMPTS; the pre-fix effect reaches 20+ here.
      expect(createCalls).toBeLessThanOrEqual(2);
      // The original bug left this spinner up forever; it must be gone now.
      expect(screen.queryByTestId('share-link-preview-loading')).not.toBeInTheDocument();
    });
  });

  describe('Preview Header URL Wrapping', () => {
    const shareUrl = 'https://share.example.com/abc';

    beforeEach(() => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'active-token',
          appId: 'app-123',
          shareUrl,
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });
    });

    it('appends airoPreview param when preview-header flag is enabled', async () => {
      switchboardFlags.set('appbuilder-preview-header', true);
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(getShareInput()).toHaveValue(shareUrl);
      });

      await user.click(screen.getByTestId('share-link-open'));

      expect(mockWithPreviewParam).toHaveBeenCalledWith(shareUrl);
      expect(mockOpen).toHaveBeenCalledWith(
        `${shareUrl}?airoPreview=1`,
        '_blank',
        'noopener,noreferrer'
      );
      mockOpen.mockRestore();
    });

    it('does not append airoPreview param when preview-header flag is disabled', async () => {
      switchboardFlags.set('appbuilder-preview-header', false);
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(getShareInput()).toHaveValue(shareUrl);
      });

      await user.click(screen.getByTestId('share-link-open'));

      expect(mockWithPreviewParam).not.toHaveBeenCalled();
      expect(mockOpen).toHaveBeenCalledWith(
        shareUrl,
        '_blank',
        'noopener,noreferrer'
      );
      mockOpen.mockRestore();
    });

    it('does not append airoPreview param on published section even when flag is enabled', async () => {
      switchboardFlags.set('appbuilder-preview-header', true);
      mockHasBeenPublished.mockReturnValue(true);
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      const publishedSection = screen.getByTestId('share-link-published-content');
      await user.click(within(publishedSection).getByTestId('share-link-open'));

      expect(mockWithPreviewParam).not.toHaveBeenCalled();
      expect(mockOpen).toHaveBeenCalledWith(
        'https://published.example.com',
        '_blank',
        'noopener,noreferrer'
      );
      mockOpen.mockRestore();
    });
  });

  describe('Token Expiry Label', () => {
    it('shows shareable link label with expiry when active token exists', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/abc',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-access-info')).toBeInTheDocument();
      });
    });

    it('triggers auto-create when expired token is discovered on switching to preview', async () => {
      const expiredAt = Date.now() - 1000;
      mockHasBeenPublished.mockReturnValue(true);
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'expired-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/expired',
          expiresAt: expiredAt,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      switchToSegment('preview');
      await waitFor(() => {
        expect(screen.getByTestId('share-link-preview-content')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({ appId: 'app-123', expiresInDays: 7 });
      });
    });
  });

  describe('resolveShareUrl Fallback', () => {
    it('falls back to origin-based URL when shareUrl is absent', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'fallback-token',
          appId: 'app-123',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(getShareInput().value).toContain('airoShareToken=fallback-token');
      });
    });
  });

  describe('Retry Flow', () => {
    it('retries token fetch when fetch errored', async () => {
      const mockRefetch = vi.fn().mockResolvedValue(undefined);
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: true,
        refetch: mockRefetch,
      });

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-error-state')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_common_try_again'));

      expect(mockRefetch).toHaveBeenCalled();
      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.share_link.retry',
        expect.anything()
      );
    });

    it('retries token creation when create errored', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Creation failed'));

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-error-state')).toBeInTheDocument();
      });

      mockMutateAsync.mockResolvedValue(undefined);
      await user.click(screen.getByText('builder_common_try_again'));

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.share_link.retry',
        expect.anything()
      );
    });
  });

  describe('409 Conflict Recovery', () => {
    it('refetches tokens on 409 instead of showing error', async () => {
      const { ShareTokenError } = await import('@/hooks/useShareTokens');
      const validToken = { token: 'recovered-token', expiresAt: Date.now() + 86_400_000, shareUrl: 'https://share.example.com/recovered' };
      const mockRefetch = vi.fn().mockResolvedValue({ data: [validToken] });
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: mockRefetch,
      });
      mockMutateAsync.mockRejectedValue(new ShareTokenError('Conflict', 409));

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled();
      });

      expect(screen.queryByTestId('share-link-error-state')).not.toBeInTheDocument();
    });

    it('shows error when 409 refetch returns no active token', async () => {
      const { ShareTokenError } = await import('@/hooks/useShareTokens');
      const mockRefetch = vi.fn().mockResolvedValue({ data: [] });
      mockUseShareTokens.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: mockRefetch,
      });
      mockMutateAsync.mockRejectedValue(new ShareTokenError('Conflict', 409));

      renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByTestId('share-link-error-state')).toBeInTheDocument();
      });
    });
  });

  describe('State Reset', () => {
    it('resets copied state when popover reopens', async () => {
      mockUseShareTokens.mockReturnValue({
        data: [{
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://share.example.com/abc',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      const { user } = renderWithProviders(<ShareLink />);
      await openPopover();

      await waitFor(() => {
        expect(screen.getByTestId('share-link-copy')).toHaveAttribute('aria-label', 'builder_share_link_copy');
      });

      await user.click(screen.getByTestId('share-link-copy'));

      await waitFor(() => {
        expect(screen.getByTestId('share-link-copy')).toHaveAttribute('aria-label', 'builder_share_link_copied');
      });

      fireEvent.click(screen.getByTestId('share-link-button'));
      fireEvent.click(screen.getByTestId('share-link-button'));

      await waitFor(() => {
        expect(screen.getByTestId('share-link-copy')).toHaveAttribute('aria-label', 'builder_share_link_copy');
      });
    });
  });
});
