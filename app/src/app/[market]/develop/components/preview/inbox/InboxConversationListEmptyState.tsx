'use client';

import Button from '@ux/button';

import { useTranslations } from '@/hooks/useTranslations';
import { type InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter';
import { InboxEmptyIllustration } from './InboxEmptyIllustration';
import { getInboxEmptyState, type InboxEmptyState } from './inboxEmptyState';
import { useInboxEmptyPrompt } from './useInboxEmptyPrompt';

const EMPTY_STATE_KEYS: Record<Exclude<InboxConversationStatusFilter, 'all'>, string> = {
  unresolved: 'builder_inbox_empty_unresolved',
  pending: 'builder_inbox_empty_pending',
  resolved: 'builder_inbox_empty_resolved',
};

interface InboxConversationListEmptyStateProps {
  statusFilter: InboxConversationStatusFilter;
  // Reamaze provisioning pointers driving the empty-state variations:
  // embeddableId → chat widget present; categoryId → contact form present.
  embeddableId: number | null;
  categoryId: number | string | null;
}

export function InboxConversationListEmptyState({
  statusFilter,
  embeddableId,
  categoryId,
}: InboxConversationListEmptyStateProps) {
  const t = useTranslations();
  const emptyState: InboxEmptyState = getInboxEmptyState(embeddableId, categoryId);
  const { handleCtaClick, isProcessing } = useInboxEmptyPrompt();

  if (statusFilter !== 'all') {
    return (
      <div className='flex items-center justify-center h-full px-4'>
        <div className='text-center text-ux-text-secondary'>
          {t(EMPTY_STATE_KEYS[statusFilter])}
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
      <InboxEmptyIllustration className='text-ux-text-tertiary' />
      <div className='text-md font-medium text-ux-text-primary'>{t(emptyState.titleKey)}</div>
      <p className='max-w-[400px] text-xs leading-snug text-ux-text-secondary'>
        {t(emptyState.bodyKey)}
      </p>
      {emptyState.ctas.length > 0 && (
        <div className='flex flex-wrap items-center justify-center gap-2'>
          {emptyState.ctas.map((cta) => (
            <Button
              key={cta.eid}
              design='secondary'
              size='sm'
              data-testid={cta.testId}
              disabled={isProcessing}
              onClick={() => handleCtaClick(cta)}
            >
              {t(cta.labelKey)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
