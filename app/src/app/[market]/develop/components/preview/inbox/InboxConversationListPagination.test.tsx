/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InboxConversationListPagination } from './InboxConversationListPagination';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('InboxConversationListPagination', () => {
  it('renders current page and total', () => {
    render(
      <InboxConversationListPagination currentPage={2} totalPages={5} onPageChange={vi.fn()} />,
    );

    expect(screen.getByTestId('conversation-list-pagination')).toHaveTextContent('2 / 5');
  });

  it('disables previous button on first page', () => {
    render(
      <InboxConversationListPagination currentPage={1} totalPages={3} onPageChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('builder_inbox_pagination_previous')).toBeDisabled();
    expect(screen.getByLabelText('builder_inbox_pagination_next')).toBeEnabled();
  });

  it('disables next button on last page', () => {
    render(
      <InboxConversationListPagination currentPage={3} totalPages={3} onPageChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('builder_inbox_pagination_previous')).toBeEnabled();
    expect(screen.getByLabelText('builder_inbox_pagination_next')).toBeDisabled();
  });

  it('disables both buttons when there is only one page', () => {
    render(
      <InboxConversationListPagination currentPage={1} totalPages={1} onPageChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('builder_inbox_pagination_previous')).toBeDisabled();
    expect(screen.getByLabelText('builder_inbox_pagination_next')).toBeDisabled();
  });

  it('calls onPageChange with next page when clicking next', async () => {
    const onPageChange = vi.fn();
    render(
      <InboxConversationListPagination currentPage={2} totalPages={5} onPageChange={onPageChange} />,
    );

    await userEvent.click(screen.getByLabelText('builder_inbox_pagination_next'));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('calls onPageChange with previous page when clicking previous', async () => {
    const onPageChange = vi.fn();
    render(
      <InboxConversationListPagination currentPage={3} totalPages={5} onPageChange={onPageChange} />,
    );

    await userEvent.click(screen.getByLabelText('builder_inbox_pagination_previous'));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
