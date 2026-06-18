'use client';

import Chip from '@ux/chip';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter';

const FILTERS: { id: InboxConversationStatusFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'builder_inbox_filter_all' },
  { id: 'unresolved', labelKey: 'builder_inbox_unresolved' },
  { id: 'pending', labelKey: 'builder_inbox_pending' },
  { id: 'resolved', labelKey: 'builder_inbox_resolved' },
];

interface InboxConversationStatusFiltersProps {
  value: InboxConversationStatusFilter;
  onChange: (value: InboxConversationStatusFilter) => void;
  disabled?: boolean;
}

export function InboxConversationStatusFilters({
  value,
  onChange,
  disabled = false,
}: InboxConversationStatusFiltersProps) {
  const t = useTranslations();
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-wrap gap-2',
        disabled && 'pointer-events-none opacity-60',
      )}
      role='group'
      aria-label={t('builder_inbox_filter_group_label')}
      aria-disabled={disabled || undefined}
    >
      {FILTERS.map((filter) => (
        <Chip
          key={filter.id}
          size='sm'
          label={t(filter.labelKey)}
          selected={value === filter.id}
          onSelect={disabled ? undefined : () => onChange(filter.id)}
          data-testid={`inbox-status-filter-${filter.id}`}
        />
      ))}
    </div>
  );
}
