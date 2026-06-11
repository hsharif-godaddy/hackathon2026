'use client';

import Chip from '@ux/chip';

import { useTranslations } from '@/hooks/useTranslations';
import { InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter';

const FILTERS: { id: InboxConversationStatusFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'builder_inbox_filter_all' },
  { id: 'unresolved', labelKey: 'builder_inbox_unresolved' },
  { id: 'resolved', labelKey: 'builder_inbox_resolved' },
];

interface InboxConversationStatusFiltersProps {
  value: InboxConversationStatusFilter;
  onChange: (value: InboxConversationStatusFilter) => void;
}

export function InboxConversationStatusFilters({
  value,
  onChange,
}: InboxConversationStatusFiltersProps) {
  const t = useTranslations();
  return (
    <div
      className='flex min-w-0 flex-1 flex-wrap gap-2'
      role='group'
      aria-label={t('builder_inbox_filter_group_label')}
    >
      {FILTERS.map((filter) => (
        <Chip
          key={filter.id}
          size='sm'
          label={t(filter.labelKey)}
          selected={value === filter.id}
          onSelect={() => onChange(filter.id)}
          data-testid={`inbox-status-filter-${filter.id}`}
        />
      ))}
    </div>
  );
}
