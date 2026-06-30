'use client';

import { type ReactElement, useEffect, useRef, useState } from 'react';
import CheckmarkIcon from '@ux/icon/checkmark';
import CopyIcon from '@ux/icon/copy';
import HistoryIcon from '@ux/icon/history';
import InlineEditIcon from '@ux/icon/inline-edit';
import Tag from '@ux/tag';
import text from '@ux/text';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { generateClickEID } from '@/utils/instrumentation';

interface PublishedDomainCardProps {
  domain: string;
  lastPublishLabel?: string;
  isHistoryDisabled: boolean;
  onEdit: () => void;
  onViewHistory: () => void;
}

export default function PublishedDomainCard({
  domain,
  lastPublishLabel,
  isHistoryDisabled,
  onEdit,
  onViewHistory,
}: PublishedDomainCardProps): ReactElement {
  const t = useTranslations();
  const [copied, setCopied] = useState<boolean>(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(domain);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.warn('published-domain-card.copy.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div
      data-testid='publish-published-card'
      className='flex flex-col gap-2 rounded-xl border border-intents-ux-boxLowContrast-borderColor p-3'
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-col gap-1'>
          <Tag
            size='sm'
            className='self-start uppercase !bg-ai-light/50 !text-intents-ux-box-foregroundColor'
          >
            {t('builder_status_published')}
          </Tag>
          <div className='flex items-center gap-0'>
            <text.strong size={1} className='min-w-0 truncate text-intents-ux-box-foregroundColor'>
              {domain}
            </text.strong>
            <IconButton
              icon={copied ? <CheckmarkIcon className='size-2' /> : <CopyIcon className='size-2' />}
              label={copied ? t('builder_common_copied') : t('builder_common_copy_clipboard')}
              onClick={() => void handleCopy()}
              type='button'
              size='sm'
              ghost
              showLabelWhenActive={false}
              dataEid={generateClickEID('develop.publish.published_domain_copy')}
              data-testid='publish-published-copy'
            />
          </div>
        </div>
        <IconButton
          icon={<InlineEditIcon className='size-2.5' />}
          label={t('builder_common_edit')}
          onClick={onEdit}
          type='button'
          size='sm'
          showLabelWhenActive={false}
          className='!bg-intents-ux-boxLowContrast-backgroundColor p-2'
          dataEid={generateClickEID('develop.publish.published_domain_edit')}
          data-testid='publish-published-edit'
        />
      </div>

      {lastPublishLabel ? (
        <button
          type='button'
          onClick={onViewHistory}
          disabled={isHistoryDisabled}
          data-eid={generateClickEID('develop.publish.published_view_history')}
          data-testid='publish-published-history'
          className='flex items-center gap-1 text-left hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
        >
          <HistoryIcon className='size-2 !text-[#767676]' />
          <text.span size={-1} className='!text-[#767676]'>
            {t('builder_common_last_publish')} • <span className='underline'>{lastPublishLabel}</span>
          </text.span>
        </button>
      ) : null}
    </div>
  );
}
