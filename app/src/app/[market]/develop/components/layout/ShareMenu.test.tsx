/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';

// Radix Popover (used inside ShareMenu) calls ResizeObserver.observe via
// @floating-ui; JSDOM doesn't ship one. Use a real class so the prototype is
// what @floating-ui's autoUpdate expects.
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
  vi.fn(() => ({ data: [], refetch: vi.fn().mockResolvedValue(undefined) })),
);
const mockMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUseCreateShareToken = vi.hoisted(() =>
  vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
  })),
);
vi.mock('@/hooks/useShareTokens', () => ({
  useShareTokens: mockUseShareTokens,
  useCreateShareToken: mockUseCreateShareToken,
}));

// logClickEvent is hoisted so per-test cases can override the
// implementation (e.g. to make it throw, exercising the click-log
// failure branch in handleCreate / handleCopy).
const mockLogClickEvent = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock('@/utils/instrumentation', () => ({
  ...mockInstrumentation(),
  logClickEvent: mockLogClickEvent,
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

import ShareMenu, { resolveShareUrl } from './ShareMenu';

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;
const PAST = Date.now() - 60 * 1000;

const mockClipboard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

describe('ShareMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue(true);
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
    // clearAllMocks above reset mockClipboard's resolved value; reapply.
    mockClipboard.mockResolvedValue(undefined);
    // Reset logClickEvent to the default no-op factory so individual
    // tests can override (e.g. to throw and exercise the catch branch).
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

  it('renders nothing when the appbuilder-share-links flag is off', () => {
    mockUseSwitchboard.mockReturnValue(false);
    renderWithProviders(<ShareMenu />);
    expect(screen.queryByTestId('header-share-button')).not.toBeInTheDocument();
  });

  it('renders nothing while the switchboard flag is still loading', () => {
    mockUseSwitchboard.mockReturnValue(undefined);
    renderWithProviders(<ShareMenu />);
    expect(screen.queryByTestId('header-share-button')).not.toBeInTheDocument();
  });

  it('renders the trigger button when the flag is on', () => {
    renderWithProviders(<ShareMenu />);
    expect(screen.getByTestId('header-share-button')).toBeInTheDocument();
  });

  it('shows the Create button in the popover when there is no active token', async () => {
    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    await waitFor(() => {
      expect(screen.getByTestId('header-share-create-button')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('header-share-copy-button')).not.toBeInTheDocument();
  });

  it('calls createToken.mutateAsync when Create is clicked', async () => {
    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    const createButton = await screen.findByTestId('header-share-create-button');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ appId: 'app-123', expiresInDays: 7 });
    });
  });

  it('logs warn when the PopoverTrigger logClickEvent throws on open', () => {
    // Force the OUTER call for share.open to throw. The PopoverTrigger
    // onClick must not let the throw propagate (which would suppress
    // Radix's popover-toggle wiring on this asChild trigger).
    mockLogClickEvent.mockImplementation((eid: string) => {
      if (eid === 'develop.header.share.open') {
        throw new Error('open instrumentation broken');
      }
      return vi.fn();
    });

    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.menu.open.clickLogFailure',
      expect.objectContaining({ message: 'open instrumentation broken' }),
    );
  });

  it('logs warn when logClickEvent throws after a successful create', async () => {
    // Force the OUTER call (logClickEvent(eid, ctx)) to throw — simulates an
    // instrumentation-layer breakage. The inner try/catch in handleCreate
    // should trap it and emit logger.warn rather than letting it bubble.
    mockLogClickEvent.mockImplementation((eid: string) => {
      if (eid === 'develop.header.share.create') {
        throw new Error('instrumentation broken');
      }
      return vi.fn();
    });

    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    const createButton = await screen.findByTestId('header-share-create-button');
    fireEvent.click(createButton);

    // Mutation still succeeds…
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });

    // …and the click-log failure surfaces as a structured warn, not a
    // silent catch.
    await waitFor(() => {
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.menu.create.clickLogFailure',
        expect.objectContaining({ message: 'instrumentation broken' }),
      );
    });
  });

  it('disables Create while the mutation is pending', async () => {
    mockUseCreateShareToken.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: true,
      isError: false,
    });
    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    const createButton = await screen.findByTestId('header-share-create-button');
    expect(createButton).toBeDisabled();
  });

  it('disables Create while the tokens list is still loading', async () => {
    // Until the query settles we can't tell whether an active token already
    // exists; clicking Create before then would race the server-side 409.
    mockUseShareTokens.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    const createButton = await screen.findByTestId('header-share-create-button');
    expect(createButton).toBeDisabled();
  });

  it('shows a tokens-fetch error message when useShareTokens returns isError', async () => {
    mockUseShareTokens.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    expect(
      await screen.findByTestId('header-share-tokens-error'),
    ).toBeInTheDocument();
  });

  it('disables Create when tokens-fetch errors (avoid 409 from blind retry)', async () => {
    // When the tokens list failed to load, hasActiveToken defaults to
    // false (empty data). If the user clicks Create and the server
    // already has an active token, agents returns 409 — a confusing
    // double-error sequence. Disable the button to make the recovery
    // path "wait, then refresh" rather than "click and discover".
    mockUseShareTokens.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    const createButton = await screen.findByTestId('header-share-create-button');
    expect(createButton).toBeDisabled();
  });

  it('filters out expired tokens (treats them as no active token)', async () => {
    mockUseShareTokens.mockReturnValue({
      data: [
        {
          token: 'expired-token',
          appId: 'app-123',
          shareUrl: 'https://airo-builder.test-godaddy.com/share/abc',
          expiresAt: PAST,
          createdAt: new Date().toISOString(),
        },
      ],
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    await waitFor(() => {
      expect(screen.getByTestId('header-share-create-button')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('header-share-copy-button')).not.toBeInTheDocument();
  });

  it('shows the Copy button when an active token exists', async () => {
    mockUseShareTokens.mockReturnValue({
      data: [
        {
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://airo-builder.test-godaddy.com/share/encoded',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        },
      ],
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    await waitFor(() => {
      expect(screen.getByTestId('header-share-copy-button')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('header-share-create-button')).not.toBeInTheDocument();
  });

  it('logs warn when logClickEvent throws during copy', async () => {
    // The logClickEvent call inside handleCopy is a synchronous try/catch —
    // independent of the clipboard.writeText Promise (which is flaky under
    // JSDOM through Radix's portal). Force the OUTER call for share.copy
    // to throw and assert the structured warn fires, mirroring the
    // share.menu.create.clickLogFailure and share.menu.open.clickLogFailure
    // tests above.
    mockUseShareTokens.mockReturnValue({
      data: [
        {
          token: 'active-token',
          appId: 'app-123',
          shareUrl: 'https://airo-builder.test-godaddy.com/share/encoded',
          expiresAt: FUTURE,
          createdAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    mockLogClickEvent.mockImplementation((eid: string) => {
      if (eid === 'develop.header.share.copy') {
        throw new Error('copy instrumentation broken');
      }
      return vi.fn();
    });

    renderWithProviders(<ShareMenu />);
    fireEvent.click(screen.getByTestId('header-share-button'));

    const copyButton = await screen.findByTestId('header-share-copy-button');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.menu.copy.clickLogFailure',
        expect.objectContaining({ message: 'copy instrumentation broken' }),
      );
    });
  });

  // Coverage note: the click→clipboard integration runs through Radix's
  // portaled PopoverContent. Under JSDOM the React event hand-off through
  // that portal is unreliable enough that asserting `mockClipboard` was
  // called after fireEvent/userEvent is flaky. The interesting logic —
  // building the URL we copy — is exercised by the `resolveShareUrl` unit
  // tests below. The click wiring itself is currently only manually
  // verified; a Playwright spec covering header-share-{button,copy,create}
  // -button against a real browser is a follow-up.
});

describe('resolveShareUrl', () => {
  it('uses the server-provided shareUrl when present (BFF redirect form)', () => {
    expect(
      resolveShareUrl({
        token: 'yPBorcyKvnYJ',
        shareUrl: 'https://airo-builder.test-godaddy.com/share/encoded',
      }),
    ).toBe('https://airo-builder.test-godaddy.com/share/encoded');
  });

  it('falls back to <origin>?airoShareToken=<token> when shareUrl is absent', () => {
    expect(
      resolveShareUrl({ token: 'yPBorcyKvnYJ' }, 'https://example.com'),
    ).toBe('https://example.com?airoShareToken=yPBorcyKvnYJ');
  });

  it('returns server shareUrl even when origin is provided', () => {
    expect(
      resolveShareUrl(
        { token: 'yPBorcyKvnYJ', shareUrl: 'https://bff.example/share/abc' },
        'https://different.example',
      ),
    ).toBe('https://bff.example/share/abc');
  });
});
