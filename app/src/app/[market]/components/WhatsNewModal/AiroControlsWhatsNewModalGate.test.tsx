// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { logger } from '@/lib/request-context';
import AiroControlsWhatsNewModalGate from './AiroControlsWhatsNewModalGate';

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('./AiroControlsWhatsNewModal', () => ({
  default: ({
    open,
    onClose,
    onComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onComplete?: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="What is new">
        <button type="button" onClick={onClose}>
          Close
        </button>
        <button type="button" onClick={onComplete}>
          Complete
        </button>
      </div>
    ) : null,
}));

interface FetchResponseStub {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createFetchResponse(
  state: unknown,
  ok: boolean = true,
  status?: number
): FetchResponseStub {
  return {
    ok,
    status,
    json: async (): Promise<unknown> => state,
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: (value: T) => void = (): void => undefined;
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void): void => {
    resolveDeferred = resolve;
  });

  return { promise, resolve: resolveDeferred };
}

function mockFetchSequence(state: unknown): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockResolvedValueOnce(createFetchResponse(state))
    .mockResolvedValue(createFetchResponse({}));
}

describe('AiroControlsWhatsNewModalGate', () => {
  beforeEach((): void => {
    vi.clearAllMocks();
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('records a desktop view and opens when the user is eligible', async () => {
    const fetchMock: ReturnType<typeof mockFetchSequence> = mockFetchSequence({
      desktop: { viewCount: 0 },
      mobile: { viewCount: 0 },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AiroControlsWhatsNewModalGate enabled />);

    expect(await screen.findByRole('dialog', { name: 'What is new' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/whats-new/airo-controls', {
      credentials: 'include',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/whats-new/airo-controls', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: 'desktop', action: 'viewed' }),
    });
  });

  it('uses mobile state independently', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const fetchMock: ReturnType<typeof mockFetchSequence> = mockFetchSequence({
      desktop: { viewCount: 2 },
      mobile: { viewCount: 1 },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AiroControlsWhatsNewModalGate enabled />);

    expect(await screen.findByRole('dialog', { name: 'What is new' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/whats-new/airo-controls', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: 'mobile', action: 'viewed' }),
    });
  });

  it('opens and logs when recording a view fails', async () => {
    const fetchMock: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse({ desktop: { viewCount: 0 } }))
      .mockResolvedValueOnce(createFetchResponse({}, false, 500));
    vi.stubGlobal('fetch', fetchMock);

    render(<AiroControlsWhatsNewModalGate enabled />);

    expect(await screen.findByRole('dialog', { name: 'What is new' })).toBeInTheDocument();
    expect(logger.warn).toHaveBeenCalledWith('whats-new.airo-controls.viewed.update.failed', {
      device: 'desktop',
      error: 'Failed to update what is new modal state (500)',
    });
  });

  it('does not record stale device when device changes while loading state', async () => {
    const desktopState: Deferred<FetchResponseStub> = createDeferred<FetchResponseStub>();
    const fetchMock: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockReturnValueOnce(desktopState.promise)
      .mockResolvedValueOnce(createFetchResponse({ mobile: { viewCount: 0 } }))
      .mockResolvedValue(createFetchResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<AiroControlsWhatsNewModalGate enabled />);

    vi.mocked(useIsMobile).mockReturnValue(true);
    rerender(<AiroControlsWhatsNewModalGate enabled />);
    desktopState.resolve(createFetchResponse({ desktop: { viewCount: 0 } }));

    expect(await screen.findByRole('dialog', { name: 'What is new' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/whats-new/airo-controls', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: 'desktop', action: 'viewed' }),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/whats-new/airo-controls', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: 'mobile', action: 'viewed' }),
    });
  });

  it('does not open after two views', async () => {
    const fetchMock: ReturnType<typeof mockFetchSequence> = mockFetchSequence({
      desktop: { viewCount: 2 },
      mobile: { viewCount: 0 },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AiroControlsWhatsNewModalGate enabled />);

    await waitFor((): void => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('records completion from the final modal action', async () => {
    const fetchMock: ReturnType<typeof mockFetchSequence> = mockFetchSequence({
      desktop: { viewCount: 1 },
      mobile: { viewCount: 0 },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AiroControlsWhatsNewModalGate enabled />);

    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/whats-new/airo-controls', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: 'desktop', action: 'completed' }),
    });
  });

  it('logs when completion cannot be recorded', async () => {
    const fetchMock: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse({ desktop: { viewCount: 1 } }))
      .mockResolvedValueOnce(createFetchResponse({}))
      .mockResolvedValueOnce(createFetchResponse({}, false, 503));
    vi.stubGlobal('fetch', fetchMock);

    render(<AiroControlsWhatsNewModalGate enabled />);

    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor((): void => {
      expect(logger.warn).toHaveBeenCalledWith('whats-new.airo-controls.completed.update.failed', {
        device: 'desktop',
        error: 'Failed to update what is new modal state (503)',
      });
    });
  });
});
