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

const instrumentation = vi.hoisted(() => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  logClickEvent: vi.fn(() => vi.fn()),
}));

const emptyPrompt = vi.hoisted(() => ({
  handleCtaClick: vi.fn(),
  isProcessing: false,
}));

vi.mock('./useInboxEmptyPrompt', () => ({
  useInboxEmptyPrompt: () => emptyPrompt,
}));

vi.mock('@/utils/instrumentation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/instrumentation')>();
  return {
    ...actual,
    logImpressionEvent: instrumentation.logImpressionEvent,
    logClickEvent: instrumentation.logClickEvent,
  };
});

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

vi.mock('@ux/button', () => ({
  default: ({
    children,
    onClick,
    disabled,
    'data-testid': dataTestid,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'data-testid'?: string;
  }) => (
    <button data-testid={dataTestid} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const brandId = '00000000-0000-0000-0000-000000000000';

describe('InboxConversationList', () => {
  beforeEach(() => {
    hoisted.result = {
      data: { conversations: [], pageCount: 1, droppedCount: 0 },
      isLoading: false,
      error: null,
    };
    emptyPrompt.handleCtaClick.mockReset();
    emptyPrompt.isProcessing = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty-state component in the empty branch', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    expect(screen.getByText('builder_inbox_empty_setup_title')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-row')).not.toBeInTheDocument();
  });

  it('disables the status filters when the inbox is empty on the "all" filter', () => {
    render(<InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />);

    expect(screen.getByTestId('stub-filters')).toHaveAttribute('data-disabled', 'true');
  });

  it('keeps the status filters enabled once a non-"all" filter is active', () => {
    render(<InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />);

    fireEvent.click(screen.getByText('unresolved'));

    expect(screen.getByTestId('stub-filters')).toHaveAttribute('data-disabled', 'false');
  });

  it('renders conversation rows instead of the empty state when conversations exist', () => {
    hoisted.result.data = {
      conversations: [{ id: '1' }, { id: '2' }],
      pageCount: 1,
      droppedCount: 0,
    };

    render(<InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />);

    expect(screen.getAllByTestId('stub-row')).toHaveLength(2);
    expect(screen.queryByText('builder_inbox_empty_setup_title')).not.toBeInTheDocument();
    expect(screen.getByTestId('stub-filters')).toHaveAttribute('data-disabled', 'false');
  });

  it('attaches the consumed entry ref to the list viewed impression', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => 'email'} />,
    );

    expect(instrumentation.logImpressionEvent).toHaveBeenCalledWith(
      'inbox.list.viewed',
      expect.objectContaining({ ref: 'email' }),
    );
  });

  it('omits ref from the list viewed impression when there is no entry ref', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    expect(instrumentation.logImpressionEvent).toHaveBeenCalledWith(
      'inbox.list.viewed',
      expect.not.objectContaining({ ref: expect.anything() }),
    );
  });
});
