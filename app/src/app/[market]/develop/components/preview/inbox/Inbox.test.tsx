/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
  });

  it('renders the conversation list when there is no deep-linked conversation', () => {
    mockUseConversationId.mockReturnValue(null);

    render(<Inbox brandId='brand-1' />);

    const list = screen.getByTestId('stub-conversation-list');
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute('data-brand-id', 'brand-1');
    expect(screen.queryByTestId('stub-conversation-detail')).not.toBeInTheDocument();
  });

  it('renders the conversation detail seeded from the deep-linked conversation id', () => {
    mockUseConversationId.mockReturnValue('conv-abc');

    render(<Inbox brandId='brand-1' />);

    const detail = screen.getByTestId('stub-conversation-detail');
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveAttribute('data-conversation-id', 'conv-abc');
    expect(detail).toHaveAttribute('data-brand-id', 'brand-1');
    expect(screen.queryByTestId('stub-conversation-list')).not.toBeInTheDocument();
  });

  it('switches from list to detail when a conversation is clicked', () => {
    mockUseConversationId.mockReturnValue(null);

    render(<Inbox brandId='brand-1' />);

    fireEvent.click(screen.getByTestId('stub-conversation-list'));

    const detail = screen.getByTestId('stub-conversation-detail');
    expect(detail).toHaveAttribute('data-conversation-id', 'conv-from-list');
    expect(screen.queryByTestId('stub-conversation-list')).not.toBeInTheDocument();
  });

  it('returns to the list when the detail view requests going back', () => {
    mockUseConversationId.mockReturnValue('conv-abc');

    render(<Inbox brandId='brand-1' />);

    fireEvent.click(screen.getByTestId('stub-conversation-detail'));

    expect(screen.getByTestId('stub-conversation-list')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-conversation-detail')).not.toBeInTheDocument();
  });

});
