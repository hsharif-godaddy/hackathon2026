'use client';

import ChevronLeftIcon from '@ux/icon/chevron-left';
import ChevronRightIcon from '@ux/icon/chevron-right';

import { useTranslations } from '@/hooks/useTranslations';
import { logClickEvent } from '@/utils/instrumentation';

interface InboxConversationListPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function InboxConversationListPagination({
  currentPage,
  totalPages,
  onPageChange,
}: InboxConversationListPaginationProps) {
  const t = useTranslations();
  const atStart: boolean = currentPage === 1;
  const atEnd: boolean = currentPage >= totalPages;

  function handlePreviousPage(): void {
    logClickEvent('inbox.list.previous_page')();
    onPageChange(currentPage - 1);
  }

  function handleNextPage(): void {
    logClickEvent('inbox.list.next_page')();
    onPageChange(currentPage + 1);
  }

  return (
    <nav
      className="flex shrink-0 items-center justify-center gap-0.5 border-t border-ux-border-subtle bg-ux-surface-base py-1"
      data-testid="conversation-list-pagination"
      aria-label={t('builder_inbox_pagination_label', undefined, 'Conversation list pagination')}
    >
      <button
        type="button"
        aria-label={t('builder_inbox_pagination_previous', undefined, 'Previous page')}
        disabled={atStart}
        onClick={handlePreviousPage}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ux-text-primary transition-colors hover:bg-ux-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeftIcon width={14} height={14} />
      </button>
      <span className="min-w-10 text-center text-xs tabular-nums text-ux-text-secondary">
        {currentPage}
        <span className="text-ux-text-tertiary"> / </span>
        {totalPages}
      </span>
      <button
        type="button"
        aria-label={t('builder_inbox_pagination_next', undefined, 'Next page')}
        disabled={atEnd}
        onClick={handleNextPage}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ux-text-primary transition-colors hover:bg-ux-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRightIcon width={14} height={14} />
      </button>
    </nav>
  );
}
