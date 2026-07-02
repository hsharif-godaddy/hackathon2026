/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-id'),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => true),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values: unknown, fallback?: string) => fallback ?? key,
}));

vi.mock('@/hooks/useInboxEntryRef', () => ({
  useInboxEntryRef: vi.fn(() => ({ consumeEntryRef: vi.fn(() => null) })),
}));

vi.mock('./useInboxEmptyPrompt', () => ({
  useInboxEmptyPrompt: vi.fn(() => ({ handleCtaClick: vi.fn(), isProcessing: false })),
}));

// Top-level mock ref so individual tests can override the return value.
const mockUseInboxAccount = vi.fn(() => ({
  brandId: 'brand-1' as string | null,
  embeddableId: 789 as number | null,
  categoryId: 'support' as number | string | null,
  accountId: null as string | null,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/useInboxAccount', () => ({
  useInboxAccount: (...args: unknown[]) => mockUseInboxAccount(...args),
}));

// Mirror the real hook's state ownership: a stateful stub seeded from a
// per-test initial value, so list<->detail transitions exercise Inbox's
// routing without coupling to the URL-sync internals (covered in the hook's
// own test).
const hoisted = vi.hoisted(() => ({ initialConversationId: null as string | null }));

vi.mock('@/hooks/useConversationId', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    useConversationId: () => {
      const [activeConversationId, setActiveConversationId] = react.useState<string | null>(
        hoisted.initialConversationId,
      );
      return { activeConversationId, setActiveConversationId };
    },
  };
});

// Stub the list/detail children so this suite exercises Inbox's routing and
// state transitions in isolation, without pulling in react-query/fetch.
vi.mock('./InboxConversationList', () => ({
  InboxConversationList: ({
    brandId,
    embeddableId,
    categoryId,
    onConversationClick,
  }: {
    brandId: string;
    embeddableId: number | null;
    categoryId: number | string | null;
    onConversationClick: (conversationId: string) => void;
  }) => (
    <button
      data-testid='stub-conversation-list'
      data-brand-id={brandId}
      data-embeddable-id={embeddableId ?? ''}
      data-category-id={categoryId ?? ''}
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
    hoisted.initialConversationId = null;
    vi.clearAllMocks();
    // Re-apply the default return value after clearAllMocks resets it.
    mockUseInboxAccount.mockReturnValue({
      brandId: 'brand-1',
      embeddableId: 789,
      categoryId: 'support',
      accountId: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('renders the conversation list when there is no deep-linked conversation', () => {
    hoisted.initialConversationId = null;

    render(<Inbox />);

    const list = screen.getByTestId('stub-conversation-list');
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute('data-brand-id', 'brand-1');
    // embeddableId/categoryId are forwarded to the list for the future empty-state variations.
    expect(list).toHaveAttribute('data-embeddable-id', '789');
    expect(list).toHaveAttribute('data-category-id', 'support');
    expect(screen.queryByTestId('stub-conversation-detail')).not.toBeInTheDocument();
  });

  it('renders the conversation detail seeded from the deep-linked conversation id', () => {
    hoisted.initialConversationId = 'conv-abc';

    render(<Inbox />);

    const detail = screen.getByTestId('stub-conversation-detail');
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveAttribute('data-conversation-id', 'conv-abc');
    expect(detail).toHaveAttribute('data-brand-id', 'brand-1');
    expect(screen.queryByTestId('stub-conversation-list')).not.toBeInTheDocument();
  });

  it('switches from list to detail when a conversation is clicked', () => {
    hoisted.initialConversationId = null;

    render(<Inbox />);

    fireEvent.click(screen.getByTestId('stub-conversation-list'));

    const detail = screen.getByTestId('stub-conversation-detail');
    expect(detail).toHaveAttribute('data-conversation-id', 'conv-from-list');
    expect(screen.queryByTestId('stub-conversation-list')).not.toBeInTheDocument();
  });

  it('returns to the list when the detail view requests going back', () => {
    hoisted.initialConversationId = 'conv-abc';

    render(<Inbox />);

    fireEvent.click(screen.getByTestId('stub-conversation-detail'));

    expect(screen.getByTestId('stub-conversation-list')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-conversation-detail')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton while useInboxAccount is loading', () => {
    mockUseInboxAccount.mockReturnValue({
      brandId: null,
      embeddableId: null,
      categoryId: null,
      accountId: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<Inbox />);

    expect(screen.getByTestId('inbox-loading')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-list-skeleton')).toBeInTheDocument();
  });

  it('shows an error state with a retry button when useInboxAccount errors', async () => {
    const mockRefetch = vi.fn();
    mockUseInboxAccount.mockReturnValue({
      brandId: null,
      embeddableId: null,
      categoryId: null,
      accountId: null,
      isLoading: false,
      error: new Error('fetch failed'),
      refetch: mockRefetch,
    });

    render(<Inbox />);

    expect(screen.getByTestId('inbox-error')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /try again/i });
    expect(retryButton).toBeInTheDocument();

    await userEvent.click(retryButton);

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty setup state when loaded but brandId is null', () => {
    mockUseInboxAccount.mockReturnValue({
      brandId: null,
      embeddableId: null,
      categoryId: null,
      accountId: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<Inbox />);

    // The empty state is the InboxConversationListEmptyState component.
    // The inbox-loading and inbox-error testIds must NOT appear.
    expect(screen.queryByTestId('inbox-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inbox-error')).not.toBeInTheDocument();
    // Positively assert the empty state title is rendered (translation mock returns the key itself).
    expect(screen.getByText('builder_inbox_empty_setup_title')).toBeInTheDocument();
  });
});
