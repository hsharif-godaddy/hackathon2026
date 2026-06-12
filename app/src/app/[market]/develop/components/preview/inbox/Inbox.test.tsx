/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import Inbox from './Inbox';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => {
      delete rest.initial;
      delete rest.animate;
      delete rest.exit;
      delete rest.transition;
      delete rest.custom;
      return <div {...rest}>{children}</div>;
    },
  },
}));

const mockUsePusher = vi.fn();
vi.mock('@/hooks/usePusher', () => ({
  usePusher: (options: unknown) => mockUsePusher(options),
}));

const invalidateQueriesSpy = vi.fn();
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesSpy }),
  };
});

const mockUseConversationId = vi.fn();
vi.mock('@/hooks/useConversationId', () => ({
  useConversationId: () => mockUseConversationId(),
}));

// Stub the list/detail children so this suite exercises Inbox's routing and
// state transitions in isolation, without pulling in react-query/fetch.
vi.mock('./InboxConversationList', () => ({
  InboxConversationList: ({
    brandId,
    onConversationClick,
  }: {
    brandId: string;
    onConversationClick: (conversationId: string) => void;
  }) => (
    <button
      data-testid='stub-conversation-list'
      data-brand-id={brandId}
      onClick={() => onConversationClick('conv-from-list')}
    >
      list
    </button>
  ),
}));

vi.mock('./InboxConversationDetail', () => ({
  InboxConversationDetail: ({
    conversationId,
    brandId,
    onBack,
  }: {
    conversationId: string;
    brandId: string;
    onBack: () => void;
  }) => (
    <button
      data-testid='stub-conversation-detail'
      data-conversation-id={conversationId}
      data-brand-id={brandId}
      onClick={onBack}
    >
      detail
    </button>
  ),
}));

describe('Inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePusher.mockReturnValue({ isConnected: false, isAuthenticating: false, error: null });
  });

  it('renders the conversation list when there is no deep-linked conversation', () => {
    mockUseConversationId.mockReturnValue(null);

    render(<Inbox brandId='brand-1' accountId='acct-1' />);

    const list = screen.getByTestId('stub-conversation-list');
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute('data-brand-id', 'brand-1');
    expect(screen.queryByTestId('stub-conversation-detail')).not.toBeInTheDocument();
  });

  it('renders the conversation detail seeded from the deep-linked conversation id', () => {
    mockUseConversationId.mockReturnValue('conv-abc');

    render(<Inbox brandId='brand-1' accountId='acct-1' />);

    const detail = screen.getByTestId('stub-conversation-detail');
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveAttribute('data-conversation-id', 'conv-abc');
    expect(detail).toHaveAttribute('data-brand-id', 'brand-1');
    expect(screen.queryByTestId('stub-conversation-list')).not.toBeInTheDocument();
  });

  it('switches from list to detail when a conversation is clicked', () => {
    mockUseConversationId.mockReturnValue(null);

    render(<Inbox brandId='brand-1' accountId='acct-1' />);

    fireEvent.click(screen.getByTestId('stub-conversation-list'));

    const detail = screen.getByTestId('stub-conversation-detail');
    expect(detail).toHaveAttribute('data-conversation-id', 'conv-from-list');
    expect(screen.queryByTestId('stub-conversation-list')).not.toBeInTheDocument();
  });

  it('returns to the list when the detail view requests going back', () => {
    mockUseConversationId.mockReturnValue('conv-abc');

    render(<Inbox brandId='brand-1' accountId='acct-1' />);

    fireEvent.click(screen.getByTestId('stub-conversation-detail'));

    expect(screen.getByTestId('stub-conversation-list')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-conversation-detail')).not.toBeInTheDocument();
  });

  it('debounces a burst of autoupdate_version events into a single invalidation, resetting the timer on each event', () => {
    vi.useFakeTimers();
    try {
      mockUseConversationId.mockReturnValue(null);

      render(<Inbox brandId='brand-1' accountId='acct-1' />);

      // Grab the onAutoupdate callback Inbox passed to usePusher.
      const options = mockUsePusher.mock.calls[0][0] as {
        onAutoupdate?: (data: { autoupdate_version: number }) => void;
      };
      expect(typeof options.onAutoupdate).toBe('function');

      // Interleave events with timer advances so each one re-enters the
      // clearTimeout branch — this proves a sliding window (timer reset per
      // event), which a synchronous burst could not distinguish from a fixed one.
      act(() => {
        options.onAutoupdate?.({ autoupdate_version: 1 });
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // 200ms after event 1 — still within the window, nothing yet.
      expect(invalidateQueriesSpy).not.toHaveBeenCalled();

      act(() => {
        options.onAutoupdate?.({ autoupdate_version: 2 });
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // 400ms after event 1 but only 200ms after event 2. A fixed window from
      // event 1 would have fired by now; a sliding window has not.
      expect(invalidateQueriesSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      // 400ms after the last event — exactly one collapsed invalidation.
      expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1);
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['reamaze'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not invalidate when unmounted before the debounce window elapses', () => {
    vi.useFakeTimers();
    try {
      mockUseConversationId.mockReturnValue(null);

      const { unmount } = render(<Inbox brandId='brand-1' accountId='acct-1' />);

      const options = mockUsePusher.mock.calls[0][0] as {
        onAutoupdate?: (data: { autoupdate_version: number }) => void;
      };

      act(() => {
        options.onAutoupdate?.({ autoupdate_version: 1 });
      });

      // Unmount mid-debounce — the cleanup effect must clear the pending timer.
      unmount();

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(invalidateQueriesSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
