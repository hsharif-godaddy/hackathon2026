/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { InboxConversationList } from './InboxConversationList';

interface HookResult {
  data: { conversations: Array<{ id: string }>; pageCount: number; droppedCount: number } | null;
  isLoading: boolean;
  error: Error | null;
}

const hoisted = vi.hoisted(() => ({
  result: {
    data: { conversations: [], pageCount: 1, droppedCount: 0 },
    isLoading: false,
    error: null,
  } as HookResult,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@ux/growl', () => ({
  default: { addGrowlMessage: vi.fn() },
}));

vi.mock('../../../hooks/useInbox', () => ({
  useInboxConversations: () => hoisted.result,
}));

// Stub heavy/data-fetching children so this suite exercises only the list's
// own empty-state and rendering branches.
vi.mock('./InboxConversationStatusFilters', () => ({
  InboxConversationStatusFilters: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <div data-testid='stub-filters' data-value={value} data-disabled={String(Boolean(disabled))}>
      <button onClick={() => onChange('unresolved')}>unresolved</button>
      <button onClick={() => onChange('all')}>all</button>
    </div>
  ),
}));

vi.mock('./InboxNotificationSettings', () => ({
  InboxNotificationSettings: () => <div data-testid='stub-notification-settings' />,
}));

vi.mock('./InboxConversationListPagination', () => ({
  InboxConversationListPagination: () => <div data-testid='stub-pagination' />,
}));

vi.mock('./InboxConversationRow', () => ({
  InboxConversationRow: ({ conversation }: { conversation: { id: string } }) => (
    <div data-testid='stub-row' data-id={conversation.id} />
  ),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}));

const brandId = '00000000-0000-0000-0000-000000000000';

describe('InboxConversationList', () => {
  beforeEach(() => {
    hoisted.result = {
      data: { conversations: [], pageCount: 1, droppedCount: 0 },
      isLoading: false,
      error: null,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the rich empty state with illustration for the "all" filter', () => {
    const { container } = render(
      <InboxConversationList brandId={brandId} onConversationClick={vi.fn()} />,
    );

    expect(screen.getByText('builder_inbox_empty_all_title')).toBeInTheDocument();
    expect(screen.getByText('builder_inbox_empty_all_body')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows the single-line message for a non-"all" filter', () => {
    render(<InboxConversationList brandId={brandId} onConversationClick={vi.fn()} />);

    fireEvent.click(screen.getByText('unresolved'));

    expect(screen.getByText('builder_inbox_empty_unresolved')).toBeInTheDocument();
    expect(screen.queryByText('builder_inbox_empty_all_title')).not.toBeInTheDocument();
  });

  it('disables the status filters when the inbox is empty on the "all" filter', () => {
    render(<InboxConversationList brandId={brandId} onConversationClick={vi.fn()} />);

    expect(screen.getByTestId('stub-filters')).toHaveAttribute('data-disabled', 'true');
  });

  it('keeps the status filters enabled once a non-"all" filter is active', () => {
    render(<InboxConversationList brandId={brandId} onConversationClick={vi.fn()} />);

    fireEvent.click(screen.getByText('unresolved'));

    expect(screen.getByTestId('stub-filters')).toHaveAttribute('data-disabled', 'false');
  });

  it('renders conversation rows instead of the empty state when conversations exist', () => {
    hoisted.result.data = {
      conversations: [{ id: '1' }, { id: '2' }],
      pageCount: 1,
      droppedCount: 0,
    };

    render(<InboxConversationList brandId={brandId} onConversationClick={vi.fn()} />);

    expect(screen.getAllByTestId('stub-row')).toHaveLength(2);
    expect(screen.queryByText('builder_inbox_empty_all_title')).not.toBeInTheDocument();
    expect(screen.getByTestId('stub-filters')).toHaveAttribute('data-disabled', 'false');
  });
});
